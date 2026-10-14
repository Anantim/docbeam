terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

resource "aws_ecr_repository" "this" {
  for_each = toset(var.repositories)

  name         = "${var.name}/${each.value}"
  force_delete = var.force_delete

  # Tags are git SHAs, so a tag never changes meaning. The one-off bootstrap tool is the exception:
  # its task definition runs the fixed tag `bootstrap`, which each push moves.
  image_tag_mutability = contains(var.mutable_repositories, each.value) ? "MUTABLE" : "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each = aws_ecr_repository.this

  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last ${lookup(var.keep_images_by_repository, each.key, var.keep_images)} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = lookup(var.keep_images_by_repository, each.key, var.keep_images)
      }
      action = { type = "expire" }
    }]
  })
}
