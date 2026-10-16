variable "name" {
  description = "Name prefix, for example docbeam-dev."
  type        = string
}

variable "account_id" {
  description = "AWS account id, so bucket names are globally unique."
  type        = string
}

variable "force_destroy" {
  description = "true in dev so destroy works with objects inside, false in prod (D-M0-4)."
  type        = bool
}

variable "cors_allowed_origins" {
  description = "Origins of the web app, for upload and preview from the browser."
  type        = list(string)
}

variable "object_store_role_arns" {
  description = "Roles allowed to read and write the Object Store: DocBeam API, Delivery, Sweeper, Upload Events. Empty until they exist."
  type        = list(string)
  default     = []
}

variable "upload_events_enabled" {
  description = "true once the Upload Events queue and role exist (M2). Switches on the bucket notification and the clean-tag rule. A separate flag because the ARNs are unknown until apply."
  type        = bool
  default     = false
}

variable "upload_events_role_arn" {
  description = "The only role that may read an object before it is tagged clean. Null until Step 2.1."
  type        = string
  default     = null
}

variable "upload_events_queue_arn" {
  description = "Queue that receives events for new objects under staging/. Null until Step 2.1."
  type        = string
  default     = null
}

variable "platform_files_role_arns" {
  description = "The Document Platform's task role. Empty until M1."
  type        = list(string)
  default     = []
}

variable "admin_principal_arns" {
  description = "Admin and deploy users, allowed to delete objects so destroy can empty the buckets."
  type        = list(string)
}

variable "deny_delete_object_version" {
  description = "true in prod: no role can delete a stored version. false in dev, so destroy works (D-M0-4)."
  type        = bool
}
