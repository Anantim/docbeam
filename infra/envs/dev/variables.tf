variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "admin_user_names" {
  description = "IAM users that may delete objects, so destroy can empty buckets."
  type        = list(string)
  default     = ["anantim-admin", "docbeam-github-deploy"]
}

variable "service_desired_count" {
  description = "Tasks per ECS service: 1 in dev, 2 across zones in prod (Step 1.1)."
  type        = number
  default     = 1
}

variable "db_multi_az" {
  description = "true only for the M5 failover drill (check 5.8). Apply it back to false straight after (D-M5-3, D-M5-6)."
  type        = bool
  default     = false
}

variable "seed_create_users" {
  description = "Create the seed users through POST /auth/register. Dev only (G18)."
  type        = bool
  default     = true
}

variable "seed_files" {
  description = "Seed files to load, comma separated. Empty in prod until the client's hierarchy exists (G18)."
  type        = string
  default     = "demo.json,dev-load.json"
}

variable "cors_allowed_origins" {
  description = "Origins for the gateway's CORS. The web app and the API share one site through CloudFront, so no other origin calls it (D-M1-12)."
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "jwt_authorizer_enabled" {
  description = "false only for the first bring-up of a new environment, until the Auth Service answers through CloudFront (D-M1-13). Apply again with true."
  type        = bool
  default     = true
}
