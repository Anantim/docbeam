terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# Three buckets: the Object Store (staged uploads), the Platform File Store (delivered documents) and
# the web app bucket. The web bucket policy lives in the cloudfront module, next to its origin access control.

locals {
  object_store   = "${var.name}-object-store-${var.account_id}"
  platform_files = "${var.name}-platform-files-${var.account_id}"
  web            = "${var.name}-web-${var.account_id}"

  # Actions that read or write object data. Bucket-level actions (for Terraform) are not listed.
  data_actions   = ["s3:GetObject", "s3:PutObject", "s3:GetObjectTagging", "s3:PutObjectTagging", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"]
  delete_actions = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
}

# ============================ Object Store ====================================

resource "aws_s3_bucket" "object_store" {
  bucket        = local.object_store
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "object_store" {
  bucket                  = aws_s3_bucket.object_store.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "object_store" {
  bucket = aws_s3_bucket.object_store.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# SSE-KMS with the AWS-managed key and Bucket Keys (ADR-003).
resource "aws_s3_bucket_server_side_encryption_configuration" "object_store" {
  bucket = aws_s3_bucket.object_store.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "object_store" {
  bucket = aws_s3_bucket.object_store.id

  # 33 days from upload keeps every file at least 30 days after its last delivery (Launch plan, Retention).
  rule {
    id     = "expire-after-33-days"
    status = "Enabled"
    filter {}
    expiration {
      days = 33
    }
  }

  rule {
    id     = "abort-abandoned-multipart-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# The browser uploads and previews straight from the Object Store, and reads the ETag of each part.
resource "aws_s3_bucket_cors_configuration" "object_store" {
  bucket = aws_s3_bucket.object_store.id

  cors_rule {
    allowed_origins = var.cors_allowed_origins
    allowed_methods = ["GET", "POST", "PUT"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

data "aws_iam_policy_document" "object_store" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.object_store.arn, "${aws_s3_bucket.object_store.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  # Only the DocBeam API, Delivery, Sweeper and Upload Events roles may read or write objects.
  # With an empty list (M0, before those roles exist) nobody may.
  statement {
    sid       = "DenyObjectDataToOtherPrincipals"
    effect    = "Deny"
    actions   = local.data_actions
    resources = ["${aws_s3_bucket.object_store.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    dynamic "condition" {
      for_each = length(var.object_store_role_arns) > 0 ? [1] : []
      content {
        test     = "ArnNotEquals"
        variable = "aws:PrincipalArn"
        values   = var.object_store_role_arns
      }
    }
  }

  # Deleting is limited the same way, plus the admin and deploy users, so `terraform destroy` can empty the bucket.
  statement {
    sid       = "DenyDeleteToOtherPrincipals"
    effect    = "Deny"
    actions   = local.delete_actions
    resources = ["${aws_s3_bucket.object_store.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = concat(var.object_store_role_arns, var.admin_principal_arns)
    }
  }

  # Nothing unscanned can be handed out: every role except Upload Events needs the clean tag (ADR-016).
  statement {
    sid       = "DenyReadUnlessScannedClean"
    effect    = "Deny"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.object_store.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEquals"
      variable = "s3:ExistingObjectTag/scan-status"
      values   = ["clean"]
    }
    dynamic "condition" {
      for_each = var.upload_events_enabled ? [1] : []
      content {
        test     = "ArnNotEquals"
        variable = "aws:PrincipalArn"
        values   = [var.upload_events_role_arn]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "object_store" {
  bucket     = aws_s3_bucket.object_store.id
  policy     = data.aws_iam_policy_document.object_store.json
  depends_on = [aws_s3_bucket_public_access_block.object_store]
}

# Every new object under staging/ goes to the Upload Events Queue (ADR-016). The queue arrives in Step 2.1.
resource "aws_s3_bucket_notification" "object_store" {
  # A flag, not a test on the ARN: the ARN is not known until apply, and `count` must be.
  count  = var.upload_events_enabled ? 1 : 0
  bucket = aws_s3_bucket.object_store.id

  queue {
    queue_arn     = var.upload_events_queue_arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "staging/"
  }
}

# ========================= Platform File Store ================================

resource "aws_s3_bucket" "platform_files" {
  bucket        = local.platform_files
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "platform_files" {
  bucket                  = aws_s3_bucket.platform_files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "platform_files" {
  bucket = aws_s3_bucket.platform_files.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "platform_files" {
  bucket = aws_s3_bucket.platform_files.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

# Versioning keeps the earlier version of an overwrite or delete for 90 days. There is no expiry for current files.
resource "aws_s3_bucket_versioning" "platform_files" {
  bucket = aws_s3_bucket.platform_files.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "platform_files" {
  bucket     = aws_s3_bucket.platform_files.id
  depends_on = [aws_s3_bucket_versioning.platform_files]

  rule {
    id     = "expire-old-versions-after-90-days"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  rule {
    id     = "abort-abandoned-multipart-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "platform_files" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.platform_files.arn, "${aws_s3_bucket.platform_files.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  # Only the Document Platform's task role may use the store.
  statement {
    sid       = "DenyObjectDataToOtherPrincipals"
    effect    = "Deny"
    actions   = local.data_actions
    resources = ["${aws_s3_bucket.platform_files.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    dynamic "condition" {
      for_each = length(var.platform_files_role_arns) > 0 ? [1] : []
      content {
        test     = "ArnNotEquals"
        variable = "aws:PrincipalArn"
        values   = var.platform_files_role_arns
      }
    }
  }

  # No role can remove a stored version directly. In dev this is off, so `terraform destroy` can empty the
  # bucket (D-M0-4). Prod keeps it on.
  dynamic "statement" {
    for_each = var.deny_delete_object_version ? [1] : []
    content {
      sid       = "DenyDeleteObjectVersion"
      effect    = "Deny"
      actions   = ["s3:DeleteObjectVersion"]
      resources = ["${aws_s3_bucket.platform_files.arn}/*"]
      principals {
        type        = "*"
        identifiers = ["*"]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "platform_files" {
  bucket     = aws_s3_bucket.platform_files.id
  policy     = data.aws_iam_policy_document.platform_files.json
  depends_on = [aws_s3_bucket_public_access_block.platform_files]
}

# ============================== Web app =======================================

resource "aws_s3_bucket" "web" {
  bucket        = local.web
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# SSE-S3, not KMS: CloudFront's origin access control cannot use the AWS-managed S3 key.
resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
