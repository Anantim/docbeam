output "distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.web.arn
}

output "domain_name" {
  description = "The address of the app, for example d111111abcdef8.cloudfront.net."
  value       = aws_cloudfront_distribution.web.domain_name
}
