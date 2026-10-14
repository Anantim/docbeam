output "dns_name" {
  description = "Internal address. Services call each other at http://<dns_name>:<port>."
  value       = aws_lb.this.dns_name
}

output "arn_suffix" {
  description = "For CloudWatch metrics such as RequestCount."
  value       = aws_lb.this.arn_suffix
}

output "security_group_id" {
  value = aws_security_group.alb.id
}

output "vpc_link_security_group_id" {
  value = aws_security_group.vpc_link.id
}

output "listener_arns" {
  value = { for k, l in aws_lb_listener.service : k => l.arn }
}

output "target_group_arns" {
  description = "Waits for the listeners, because an ECS service cannot register with a target group that has no listener yet."
  value       = { for k, t in aws_lb_target_group.service : k => t.arn }
  depends_on  = [aws_lb_listener.service]
}
