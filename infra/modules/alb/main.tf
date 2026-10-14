terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# The internal ALB behind the API Gateway VPC Link (ADR-001). Plain HTTP inside the private network: security
# groups limit who can reach it, and internal TLS is left for later (accepted risk, D-M1-2).
# One listener per service on the service's own port, so the gateway's route list is the only path list.

# Traffic leaves API Gateway through the VPC Link's network interfaces, which carry this group.
resource "aws_security_group" "vpc_link" {
  name        = "${var.name}-vpc-link"
  description = "API Gateway VPC Link: outbound to the internal ALB only"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name}-vpc-link" }
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Internal ALB: inbound from the VPC Link only"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_link" {
  for_each = var.services

  security_group_id            = aws_security_group.alb.id
  description                  = "${each.key} listener from the VPC Link"
  referenced_security_group_id = aws_security_group.vpc_link.id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

locals {
  client_rules = {
    for pair in setproduct(keys(var.client_security_group_ids), keys(var.services)) :
    "${pair[0]}-${pair[1]}" => {
      security_group_id = var.client_security_group_ids[pair[0]]
      port              = var.services[pair[1]].port
    }
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_clients" {
  for_each = local.client_rules

  security_group_id            = aws_security_group.alb.id
  description                  = "Internal call: ${each.key}"
  referenced_security_group_id = each.value.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

resource "aws_vpc_security_group_egress_rule" "alb_to_services" {
  for_each = var.services

  security_group_id = aws_security_group.alb.id
  description       = "${each.key} tasks and health checks"
  cidr_ipv4         = var.vpc_cidr_block
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
}

resource "aws_vpc_security_group_egress_rule" "link_to_alb" {
  for_each = var.services

  security_group_id            = aws_security_group.vpc_link.id
  description                  = "${each.key} listener on the ALB"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

resource "aws_lb" "this" {
  name               = "${var.name}-internal"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.private_subnet_ids

  # Dev is destroyed often (D-M0-4). Prod sets this in its own module call if it needs it.
  enable_deletion_protection = false
}

resource "aws_lb_target_group" "service" {
  for_each = var.services

  name        = "${var.name}-${each.key}"
  port        = each.value.port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  deregistration_delay = each.value.deregistration_delay

  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "service" {
  for_each = var.services

  load_balancer_arn = aws_lb.this.arn
  port              = each.value.port
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[each.key].arn
  }
}
