variable "name" {
  description = "Name prefix, for example docbeam-dev."
  type        = string
}

variable "account_id" {
  type = string
}

variable "object_store_bucket_arn" {
  description = "ARN of the Object Store, built from its name so this module does not depend on the bucket's notification (which depends on this queue)."
  type        = string
}
