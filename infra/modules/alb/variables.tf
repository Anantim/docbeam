variable "name" {
  description = "Name prefix, for example docbeam-dev."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr_block" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "services" {
  description = "Services behind the ALB: one listener and one target group each, on the service's own port (D-M1-2)."
  type        = map(object({ port = number }))
}

variable "client_security_group_ids" {
  description = "Security groups of the callers inside the VPC (the services and their one-off tasks), keyed by name. Services call each other through this ALB: JWKS, the seed script and the destination check."
  type        = map(string)
  default     = {}
}
