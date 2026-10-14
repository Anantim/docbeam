variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "admin_user_names" {
  description = "IAM users that may delete objects in the Object Store."
  type        = list(string)
  default     = ["anantim-admin", "docbeam-github-deploy"]
}
