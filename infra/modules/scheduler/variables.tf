variable "name" {
  description = "Environment prefix, for example docbeam-dev."
  type        = string
}

variable "function_arn" {
  description = "The Sweeper Lambda."
  type        = string
}
