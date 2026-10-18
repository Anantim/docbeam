terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# The public edge (ADR-001): an HTTP API with the built-in JWT authorizer and a VPC Link to the internal ALB.
# CloudFront forwards /api/* here and a CloudFront Function strips the prefix (D-G5).

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name}-api"
  protocol_type = "HTTP"

  dynamic "cors_configuration" {
    for_each = length(var.cors_allowed_origins) > 0 ? [1] : []

    content {
      allow_origins     = var.cors_allowed_origins
      allow_credentials = true
      allow_methods     = ["GET", "POST", "OPTIONS"]
      allow_headers     = ["authorization", "content-type", "idempotency-key"]
      max_age           = 600
    }
  }
}

resource "aws_apigatewayv2_vpc_link" "this" {
  name               = "${var.name}-link"
  subnet_ids         = var.subnet_ids
  security_group_ids = [var.vpc_link_security_group_id]
}

resource "aws_apigatewayv2_integration" "service" {
  for_each = var.listener_arns

  api_id             = aws_apigatewayv2_api.this.id
  integration_type   = "HTTP_PROXY"
  integration_method = "ANY"
  integration_uri    = each.value
  connection_type    = "VPC_LINK"
  connection_id      = aws_apigatewayv2_vpc_link.this.id
  # A private integration takes payload format 1.0.
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  count = var.jwt_authorizer_enabled ? 1 : 0

  api_id           = aws_apigatewayv2_api.this.id
  name             = "docbeam-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.issuer
    audience = [var.audience]
  }
}

resource "aws_apigatewayv2_route" "this" {
  # Without the authorizer only the public routes exist. A protected route is never created without it.
  # POST /auth/register is left out when public registration is switched off (D-M5-20).
  for_each = {
    for k, r in var.routes : k => r
    if(r.public || var.jwt_authorizer_enabled) && (var.public_registration_enabled || k != "POST /auth/register")
  }

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.service[each.value.service].id}"
  authorization_type = each.value.public ? "NONE" : "JWT"
  authorizer_id      = each.value.public ? null : one(aws_apigatewayv2_authorizer.jwt[*].id)
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/docbeam/${var.name}/api-gateway"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.default_rate_limit
    throttling_burst_limit = var.default_burst_limit
  }

  dynamic "route_settings" {
    # Only routes that exist: a protected route is absent until the authorizer is on (D-M1-13).
    for_each = toset([for k in var.tight_routes : k if contains(keys(aws_apigatewayv2_route.this), k)])

    content {
      route_key              = route_settings.value
      throttling_rate_limit  = var.tight_rate_limit
      throttling_burst_limit = var.tight_burst_limit
    }
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    # status and the two latencies are numbers (no quotes), so Logs Insights can take percentiles of them (M5, check 5.1).
    format = "{\"requestId\":\"$context.requestId\",\"routeKey\":\"$context.routeKey\",\"status\":$context.status,\"authError\":\"$context.authorizer.error\",\"integError\":\"$context.integrationErrorMessage\",\"latency\":$context.responseLatency,\"integrationLatency\":\"$context.integrationLatency\"}"
  }

  depends_on = [aws_apigatewayv2_route.this]
}
