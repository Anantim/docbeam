output "api_id" {
  value = aws_apigatewayv2_api.this.id
}

output "ws_url" {
  description = "wss://<id>.execute-api.<region>.amazonaws.com/<stage>. The web app connects here (VITE_WS_URL)."
  value       = "${aws_apigatewayv2_api.this.api_endpoint}/${aws_apigatewayv2_stage.this.name}"
}

output "management_endpoint" {
  description = "https address Delivery, the DLQ Consumer and the DocBeam API post pushes to (PostToConnection)."
  value       = "https://${aws_apigatewayv2_api.this.id}.execute-api.${data.aws_region.current.region}.amazonaws.com/${aws_apigatewayv2_stage.this.name}"
}

output "manage_connections_arn" {
  description = "The resource for execute-api:ManageConnections."
  value       = "${aws_apigatewayv2_api.this.execution_arn}/${aws_apigatewayv2_stage.this.name}/POST/@connections/*"
}
