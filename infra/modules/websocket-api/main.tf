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

resource "aws_apigatewayv2_stage" "this" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = var.stage_name
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.throttle_rate
    throttling_burst_limit = var.throttle_burst
  }

  # No access log: a WebSocket stage can only log once the account has an API Gateway CloudWatch role
  # (an account-wide setting, D-M3-15). The ws Lambda logs every event instead.
  depends_on = [aws_apigatewayv2_route.this]
}

resource "aws_lambda_permission" "invoke" {
  statement_id  = "AllowWebSocketApi"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
