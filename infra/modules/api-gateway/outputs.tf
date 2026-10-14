output "api_id" {
  value = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  description = "https://<id>.execute-api.<region>.amazonaws.com. CloudFront's /api/* origin."
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "log_group" {
  value = aws_cloudwatch_log_group.access.name
}
