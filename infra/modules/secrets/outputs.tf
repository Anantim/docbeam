output "client_secret_arns" {
  description = "Secret ARN of each service client, keyed by client id."
  value       = { for k, s in aws_secretsmanager_secret.client : k => s.arn }
}

output "signing_key_secret_arn" {
  value = aws_secretsmanager_secret.signing_key.arn
}

output "seed_user_secret_arn" {
  value = one(aws_secretsmanager_secret.seed_user[*].arn)
}
