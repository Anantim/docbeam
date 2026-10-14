variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "admin_user_names" {
  description = "IAM users that may delete objects, so destroy can empty buckets."
  type        = list(string)
  default     = ["anantim-admin", "docbeam-github-deploy"]
}
