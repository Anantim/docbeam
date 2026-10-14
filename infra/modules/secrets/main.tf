terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

locals {
  # The four internal clients (TDD Auth DB, service_clients). Their secrets are generated here and never typed in.
  clients = ["delivery-worker", "docbeam-api", "ws-handlers", "seed-script"]
}

resource "random_password" "client" {
  for_each = toset(local.clients)

  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "client" {
  for_each = toset(local.clients)

  name                    = "${var.name}/service-client/${each.value}"
  description             = "Client secret of the ${each.value} service client. The Auth Service stores only its SHA-256 (D-G10)."
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "client" {
  for_each = toset(local.clients)

  secret_id = aws_secretsmanager_secret.client[each.value].id
  secret_string = jsonencode({
    client_id     = each.value
    client_secret = random_password.client[each.value].result
  })
}

# The RS256 signing key. Terraform creates the secret empty and never manages its value, so the private key
# never lands in Terraform state. The signing-key bootstrap task writes it in M1 (D-M0-1).
resource "aws_secretsmanager_secret" "signing_key" {
  name                    = "${var.name}/auth/signing-key"
  description             = "RS256 private key of the Auth Service. Written by the bootstrap task, not by Terraform."
  recovery_window_in_days = var.secret_recovery_window_days
}

# The one seed password for the demo users in dev (G18). Not created in prod.
resource "random_password" "seed_user" {
  count = var.create_seed_password ? 1 : 0

  length           = 24
  special          = true
  override_special = "-_.!"
}

resource "aws_secretsmanager_secret" "seed_user" {
  count = var.create_seed_password ? 1 : 0

  name                    = "${var.name}/seed/user-password"
  description             = "Password of the demo seed users. Dev only."
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "seed_user" {
  count = var.create_seed_password ? 1 : 0

  secret_id     = aws_secretsmanager_secret.seed_user[0].id
  secret_string = random_password.seed_user[0].result
}
