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
  value = module.rds.proxy_endpoint
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

output "alb_dns_name" {
  value = module.alb.dns_name
}

output "alb_arn_suffix" {
  value = module.alb.arn_suffix
}

output "api_endpoint" {
  description = "Direct API Gateway address. Use the CloudFront /api path in practice."
  value       = module.api_gateway.api_endpoint
}

output "issuer" {
  value = local.issuer
}

output "service_names" {
  value = {
    auth        = module.auth.service_name
    platform    = module.platform.service_name
    docbeam_api = module.docbeam_api.service_name
  }
}

output "task_definition_families" {
  value = {
    auth        = module.auth.task_definition_families
    platform    = module.platform.task_definition_families
    docbeam_api = module.docbeam_api.task_definition_families
  }
}

output "service_security_group_ids" {
  value = {
    auth        = module.auth.security_group_id
    platform    = module.platform.security_group_id
    docbeam_api = module.docbeam_api.security_group_id
  }
}

output "lambda_function_names" {
  description = "Read by scripts/deploy-lambda.sh and the worker workflow."
  value = {
    upload_events = module.upload_events.function_name
    fanout        = module.fanout.function_name
    delivery      = module.delivery.function_name
    dlq           = module.dlq_consumer.function_name
    sweeper       = module.sweeper.function_name
    ws            = module.ws.function_name
  }
}

output "ws_url" {
  description = "The WebSocket address the web app connects to. scripts/deploy-web.sh passes it to the build as VITE_WS_URL."
  value       = module.websocket_api.ws_url
}

output "queue_urls" {
  value = module.sqs.queue_urls
}

output "alarm_topic_arn" {
  value = module.alarms.topic_arn
}
