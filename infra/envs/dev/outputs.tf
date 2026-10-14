output "app_url" {
  value = "https://${module.cloudfront.domain_name}"
}

output "cloudfront_distribution_id" {
  value = module.cloudfront.distribution_id
}

output "web_bucket" {
  value = module.s3.web_bucket
}

output "object_store_bucket" {
  value = module.s3.object_store_bucket
}

output "platform_files_bucket" {
  value = module.s3.platform_files_bucket
}

output "ecs_cluster_name" {
  value = module.ecs_cluster.cluster_name
}

output "db_bootstrap_task_definition" {
  value = module.ecs_cluster.db_bootstrap_task_definition
}

output "db_bootstrap_log_group" {
  value = module.ecs_cluster.db_bootstrap_log_group
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "one_off_task_security_group_id" {
  value = module.ecs_cluster.one_off_task_security_group_id
}

output "ecr_repository_urls" {
  value = module.ecr.repository_urls
}

output "db_proxy_endpoint" {
  description = "null while the proxy is off"
  value       = module.rds.proxy_endpoint
}

output "lambda_db_host" {
  description = "The database host the Lambdas get in their config"
  value       = module.rds.lambda_db_host
}

output "db_endpoint" {
  value = module.rds.endpoint
}

output "db_instance_id" {
  value = module.rds.instance_id
}
