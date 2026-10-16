variable "name" {
  description = "Environment prefix, for example docbeam-dev."
  type        = string
}

variable "alarm_email" {
  description = "Where alarm emails go. From the repository variable ALARM_EMAIL (CI passes TF_VAR_alarm_email). The person confirms the subscription once."
  type        = string
}

variable "dlq_names" {
  description = "Dead-letter queue names, keyed job, task and upload-events."
  type        = map(string)
}

variable "delivery_function_name" {
  type = string
}
