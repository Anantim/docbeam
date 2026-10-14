variable "name" {
  description = "Name prefix, for example docbeam-dev."
  type        = string
}

variable "repositories" {
  description = "Repository names. Each becomes <name>/<repository>."
  type        = list(string)
  default     = ["auth", "platform", "docbeam-api", "upload-events", "db-bootstrap"]
}

variable "mutable_repositories" {
  description = "Repositories whose tags may move. All others are immutable."
  type        = list(string)
  default     = ["db-bootstrap"]
}

variable "keep_images" {
  type    = number
  default = 20
}

variable "force_delete" {
  description = "true in dev so destroy works with images inside, false in prod (D-M0-4)."
  type        = bool
}
