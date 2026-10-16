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
  type = map(object({
    port = number
    # How long the target group keeps serving requests already running on a task that is being replaced.
    # The platform gets 120 s so a stream of a large file is not cut by a deploy (D-M2-17).
    deregistration_delay = optional(number, 30)
  }))
}

variable "clients" {
  description = "Callers inside the VPC (the services and their one-off tasks), keyed by name. Services call each other through this ALB: JWKS, the seed script and the destination check. `services` lists the listeners a caller may reach; null means every listener."
  type = map(object({
    security_group_id = string
    services          = optional(list(string))
  }))
  default = {}

  validation {
    condition = alltrue(flatten([
      for c in values(var.clients) : [for s in coalesce(c.services, []) : contains(keys(var.services), s)]
    ]))
    error_message = "Every name in a client's services must be a service of the ALB."
  }
}
