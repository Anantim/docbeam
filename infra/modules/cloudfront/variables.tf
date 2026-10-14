variable "name" {
  description = "Name prefix, for example docbeam-dev."
  type        = string
}

variable "web_bucket" {
  description = "Name of the web app bucket."
  type        = string
}

variable "web_bucket_arn" {
  type = string
}

variable "web_bucket_regional_domain_name" {
  type = string
}

variable "api_origin_domain" {
  description = "Host of the HTTP API (without https://). When set, /api/* is forwarded there with the prefix stripped (D-G5)."
  type        = string
  default     = null
}
