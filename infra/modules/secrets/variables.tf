variable "name" {
  description = "Name prefix, for example docbeam-dev."
  type        = string
}

variable "secret_recovery_window_days" {
  description = "0 in dev (names free up at once), 30 in prod (D-M0-4)."
  type        = number
}

variable "create_seed_password" {
  description = "true in dev only. Prod seeds wait for the client's hierarchy (G18)."
  type        = bool
  default     = false
}
