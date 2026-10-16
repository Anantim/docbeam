# The WebSocket API of ADR-007: browsers connect here for live task updates. It holds raw connections only;
# the WS Handlers Lambda keeps the ws_connections table right ($connect, subscribe, $disconnect).
# The browser puts its token in the query string, so the Lambda checks it ($connect has no authorizer here).

data "aws_region" "current" {}

resource "aws_apigatewayv2_api" "this" {
  name                       = "${var.name}-ws"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

resource "aws_apigatewayv2_integration" "handlers" {
  api_id             = aws_apigatewayv2_api.this.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = var.lambda_invoke_arn
}

# Three routes, no $default: a message with another action is refused by the API, not passed on.
resource "aws_apigatewayv2_route" "this" {
  for_each = toset(["$connect", "subscribe", "$disconnect"])

  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.handlers.id}"
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}-ws"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "this" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = var.stage_name
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.throttle_rate
    throttling_burst_limit = var.throttle_burst
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId    = "$context.requestId"
      routeKey     = "$context.routeKey"
      eventType    = "$context.eventType"
      status       = "$context.status"
      connectionId = "$context.connectionId"
      error        = "$context.error.message"
    })
  }

  depends_on = [aws_apigatewayv2_route.this]
}

resource "aws_lambda_permission" "invoke" {
  statement_id  = "AllowWebSocketApi"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
