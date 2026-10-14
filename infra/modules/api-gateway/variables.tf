variable "name" {
  type = string
}

variable "subnet_ids" {
  description = "Private subnets for the VPC Link."
  type        = list(string)
}

variable "vpc_link_security_group_id" {
  type = string
}

variable "listener_arns" {
  description = "ALB listener ARN of each service."
  type        = map(string)
}

variable "issuer" {
  description = "Token issuer, https://<cloudfront domain>/api (D-G5). The authorizer reads <issuer>/.well-known/openid-configuration."
  type        = string
}

variable "audience" {
  type    = string
  default = "docbeam"
}

variable "cors_allowed_origins" {
  description = "Origins for CORS with credentials. See D-M1-12 for why CloudFront's own address cannot be named here."
  type        = list(string)
}

variable "routes" {
  description = "Every public route, listed one by one. No catch-all (ADR-001)."
  type = map(object({
    service = string
    public  = bool
  }))
}

variable "default_rate_limit" {
  type    = number
  default = 50
}

variable "default_burst_limit" {
  type    = number
  default = 100
}

variable "tight_routes" {
  description = "Route keys with their own tight throttle (D-G19)."
  type        = list(string)
  default     = ["POST /auth/login", "POST /auth/refresh"]
}

variable "tight_rate_limit" {
  type    = number
  default = 5
}

variable "tight_burst_limit" {
  type    = number
  default = 10
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "jwt_authorizer_enabled" {
  description = "API Gateway fetches <issuer>/.well-known/openid-configuration when it creates the authorizer, so the Auth Service must already answer through CloudFront. Set false only for the first bring-up: the protected routes are then not created (they answer 404), never open (D-M1-13)."
  type        = bool
  default     = true
}
