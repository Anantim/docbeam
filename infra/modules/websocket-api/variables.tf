variable "name" {
  description = "Environment prefix, for example docbeam-dev."
  type        = string
}

variable "lambda_function_name" {
  description = "The WS Handlers function. API Gateway is allowed to invoke it."
  type        = string
}

variable "lambda_invoke_arn" {
  description = "The WS Handlers function's invoke ARN."
  type        = string
}

variable "stage_name" {
  type    = string
  default = "v1"
}

variable "throttle_rate" {
  description = "Requests a second for the stage. About 200 users each open a connection and one subscribe per job."
  type        = number
  default     = 50
}

variable "throttle_burst" {
  type    = number
  default = 100
}

variable "log_retention_days" {
  type    = number
  default = 30
}
