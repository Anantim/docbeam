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
  # Three databases on one instance, each with an owner role (NOLOGIN) and an app role (LOGIN) (ADR-009, D-G8).
  # Only the app roles have secrets here: the owner roles cannot log in.
  databases = {
    auth     = { app_role = "auth_app", database = "auth_db" }
    platform = { app_role = "platform_app", database = "platform_db" }
    docbeam  = { app_role = "docbeam_app", database = "docbeam_db" }
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db"
  subnet_ids = var.private_subnet_ids

  tags = { Name = "${var.name}-db" }
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "PostgreSQL for DocBeam: reachable from inside the VPC only"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name}-db" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_vpc" {
  security_group_id = aws_security_group.db.id
  description       = "PostgreSQL from the VPC"
  cidr_ipv4         = var.vpc_cidr_block
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
}

# A fixed max_connections, so the connection budget in D-M0-6 is a known number and not a guess.
# Without a value the instance keeps the default for its size.
resource "aws_db_parameter_group" "this" {
  count = var.max_connections != null ? 1 : 0

  name_prefix = "${var.name}-pg16-"
  family      = "postgres16"
  description = "DocBeam PostgreSQL 16 settings"

  parameter {
    name         = "max_connections"
    value        = tostring(var.max_connections)
    apply_method = "pending-reboot"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name}-postgres"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true # KMS, AWS-managed key

  # RDS creates and rotates the master password in Secrets Manager. It is never typed in or in state output.
  username                    = "docbeam_admin"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = one(aws_db_parameter_group.this[*].name)
  publicly_accessible    = false
  multi_az               = var.multi_az

  backup_retention_period    = var.backup_retention_days
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.name}-postgres-final"
  apply_immediately         = var.apply_immediately

  tags = { Name = "${var.name}-postgres" }
}

# --- Passwords and secrets for the app roles --------------------------------

resource "random_password" "app" {
  for_each = local.databases

  length  = 40
  special = false # keeps the value safe inside a connection URL
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.databases

  name                    = "${var.name}/db/${each.value.app_role}"
  description             = "Login for the ${each.value.app_role} database role. Used by ${each.key} at run time."
  recovery_window_in_days = var.secret_recovery_window_days
}

# RDS Proxy reads username and password from this secret. The host is not stored here: the proxy
# needs the secret to exist first, so a service gets the proxy address from its own environment.
resource "aws_secretsmanager_secret_version" "app" {
  for_each = local.databases

  secret_id = aws_secretsmanager_secret.app[each.key].id
  secret_string = jsonencode({
    username = each.value.app_role
    password = random_password.app[each.key].result
    engine   = "postgres"
    port     = 5432
    dbname   = each.value.database
  })
}

# --- RDS Proxy (ADR-011): every Lambda reaches PostgreSQL through it ---------
# The Free plan blocks RDS Proxy (D-M0-6), so dev runs without it (enable_rds_proxy = false) and its Lambdas
# connect to the instance directly. No code depends on this: only the database host in config differs.

resource "aws_security_group" "proxy" {
  count = var.enable_rds_proxy ? 1 : 0

  name        = "${var.name}-db-proxy"
  description = "RDS Proxy for DocBeam: reachable from inside the VPC only"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name}-db-proxy" }
}

resource "aws_vpc_security_group_ingress_rule" "proxy_from_vpc" {
  count = var.enable_rds_proxy ? 1 : 0

  security_group_id = aws_security_group.proxy[0].id
  description       = "PostgreSQL from the VPC"
  cidr_ipv4         = var.vpc_cidr_block
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "proxy_to_db" {
  count = var.enable_rds_proxy ? 1 : 0

  security_group_id            = aws_security_group.proxy[0].id
  description                  = "PostgreSQL to the database"
  referenced_security_group_id = aws_security_group.db.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "db_from_proxy" {
  count = var.enable_rds_proxy ? 1 : 0

  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from the proxy"
  referenced_security_group_id = aws_security_group.proxy[0].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

data "aws_iam_policy_document" "proxy_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proxy" {
  count = var.enable_rds_proxy ? 1 : 0

  name               = "${var.name}-rds-proxy"
  assume_role_policy = data.aws_iam_policy_document.proxy_assume.json
}

data "aws_iam_policy_document" "proxy_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [for s in aws_secretsmanager_secret.app : s.arn]
  }
}

resource "aws_iam_role_policy" "proxy_secrets" {
  count = var.enable_rds_proxy ? 1 : 0

  name   = "read-app-role-secrets"
  role   = aws_iam_role.proxy[0].id
  policy = data.aws_iam_policy_document.proxy_secrets.json
}

resource "aws_db_proxy" "this" {
  count      = var.enable_rds_proxy ? 1 : 0
  depends_on = [aws_secretsmanager_secret_version.app]

  name                   = "${var.name}-proxy"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy[0].arn
  vpc_subnet_ids         = var.private_subnet_ids
  vpc_security_group_ids = [aws_security_group.proxy[0].id]
  require_tls            = true
  idle_client_timeout    = 1800
  debug_logging          = false

  dynamic "auth" {
    for_each = aws_secretsmanager_secret.app

    content {
      auth_scheme               = "SECRETS"
      client_password_auth_type = "POSTGRES_SCRAM_SHA_256"
      iam_auth                  = "DISABLED"
      secret_arn                = auth.value.arn
    }
  }

  tags = { Name = "${var.name}-proxy" }
}

resource "aws_db_proxy_default_target_group" "this" {
  count = var.enable_rds_proxy ? 1 : 0

  db_proxy_name = aws_db_proxy.this[0].name

  connection_pool_config {
    max_connections_percent      = 90
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 30
  }
}

resource "aws_db_proxy_target" "this" {
  count = var.enable_rds_proxy ? 1 : 0

  db_proxy_name          = aws_db_proxy.this[0].name
  target_group_name      = aws_db_proxy_default_target_group.this[0].name
  db_instance_identifier = aws_db_instance.this.identifier
}
