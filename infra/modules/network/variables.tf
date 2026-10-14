variable "name" {
  description = "Name prefix, for example docbeam-dev."
  type        = string
}

variable "cidr_block" {
  description = "CIDR of the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "Zones to use. The first two are used."
  type        = list(string)
}

variable "nat_gateway_count" {
  description = "1 in dev (shared), 2 in prod (one per zone)."
  type        = number

  validation {
    condition     = contains([1, 2], var.nat_gateway_count)
    error_message = "nat_gateway_count must be 1 or 2."
  }
}
