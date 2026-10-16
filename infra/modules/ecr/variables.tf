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

variable "keep_images_by_repository" {
  description = "Images to keep in a repository, where it differs from keep_images. upload-events keeps 3: each image is about 1 GB and one is built every day (D-M2-13)."
  type        = map(number)
  default     = {}
}

variable "force_delete" {
  description = "true in dev so destroy works with images inside, false in prod (D-M0-4)."
  type        = bool
}
