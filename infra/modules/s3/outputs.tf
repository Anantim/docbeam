output "object_store_bucket" {
  value = aws_s3_bucket.object_store.id
}

output "object_store_arn" {
  value = aws_s3_bucket.object_store.arn
}

output "platform_files_bucket" {
  value = aws_s3_bucket.platform_files.id
}

output "platform_files_arn" {
  value = aws_s3_bucket.platform_files.arn
}

output "web_bucket" {
  value = aws_s3_bucket.web.id
}

output "web_bucket_arn" {
  value = aws_s3_bucket.web.arn
}

output "web_bucket_regional_domain_name" {
  value = aws_s3_bucket.web.bucket_regional_domain_name
}
