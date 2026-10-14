# The three ECS services, the internal ALB and the public edge (M1). Resource blocks live in the modules.

variable "image_tag" {
  description = "Tag of the service images in ECR, normally the git SHA that scripts/push-image.sh pushed."
  type        = string
}

locals {
  # Names follow what scripts/deploy-service.sh expects: <name>-<service> and <name>-<service>-migrate.
  ports       = { auth = 3001, platform = 3002, "docbeam-api" = 3003 }
  database    = { auth = "auth_db", platform = "platform_db", "docbeam-api" = "docbeam_db" }
  app_secret  = { auth = "auth", platform = "platform", "docbeam-api" = "docbeam" }
  owner_role  = { auth = "auth_owner", platform = "platform_owner", "docbeam-api" = "docbeam_owner" }
  issuer      = "https://${module.cloudfront.domain_name}/api"
  alb_url     = "http://${module.alb.dns_name}"
  jwks_url    = "${local.alb_url}:3001/.well-known/jwks.json"
  master_user = "${module.rds.master_secret_arn}:username::"
  master_pass = "${module.rds.master_secret_arn}:password::"

  # Every public route, listed one by one with no catch-all (ADR-001). /auth/token, /internal/* and the
  # platform's service routes are not here, so they cannot be reached from outside.
  public_routes = {
    "POST /auth/register"                   = { service = "auth", public = true }
    "POST /auth/login"                      = { service = "auth", public = true }
    "POST /auth/refresh"                    = { service = "auth", public = true }
    "POST /auth/logout"                     = { service = "auth", public = true }
    "GET /.well-known/jwks.json"            = { service = "auth", public = true }
    "GET /.well-known/openid-configuration" = { service = "auth", public = true }
    "GET /teams"                            = { service = "platform", public = false }
    "GET /teams/{teamId}/binders"           = { service = "platform", public = false }
    "GET /binders/{binderId}/contents"      = { service = "platform", public = false }
    "GET /folders/{folderId}/contents"      = { service = "platform", public = false }
  }

  common_env = { for s, p in local.ports : s => {
    PORT       = tostring(p)
    LOG_LEVEL  = "info"
    JWT_ISSUER = local.issuer
    JWKS_URL   = local.jwks_url
    DB_HOST    = module.rds.endpoint
    DB_NAME    = local.database[s]
  } }
  db_secrets = { for s in keys(local.ports) : s => {
    DB_USER     = "${module.rds.app_secret_arns[local.app_secret[s]]}:username::"
    DB_PASSWORD = "${module.rds.app_secret_arns[local.app_secret[s]]}:password::"
  } }
  migrate_env = { for s in keys(local.ports) : s => {
    DB_HOST    = module.rds.endpoint
    DB_NAME    = local.database[s]
    OWNER_ROLE = local.owner_role[s]
  } }
  migrate_secrets = {
    MIGRATION_DB_USER     = local.master_user
    MIGRATION_DB_PASSWORD = local.master_pass
  }
  image = { for s in keys(local.ports) : s => "${module.ecr.repository_urls[s]}:${var.image_tag}" }
}

module "alb" {
  source = "../../modules/alb"

  name               = local.name
  vpc_id             = module.network.vpc_id
  vpc_cidr_block     = module.network.vpc_cidr_block
  private_subnet_ids = module.network.private_subnet_ids
  services           = { for s, p in local.ports : s => { port = p } }

  # Services and their one-off tasks (same group) call each other through the ALB.
  client_security_group_ids = {
    auth        = module.auth.security_group_id
    platform    = module.platform.security_group_id
    docbeam-api = module.docbeam_api.security_group_id
  }
}

module "api_gateway" {
  source = "../../modules/api-gateway"

  name                       = local.name
  subnet_ids                 = module.network.private_subnet_ids
  vpc_link_security_group_id = module.alb.vpc_link_security_group_id
  listener_arns              = module.alb.listener_arns
  issuer                     = local.issuer
  cors_allowed_origins       = var.cors_allowed_origins
  routes                     = local.public_routes
}

module "auth" {
  source = "../../modules/ecs-service"

  name                  = local.name
  service               = "auth"
  cluster_arn           = module.ecs_cluster.cluster_arn
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  image                 = local.image["auth"]
  port                  = local.ports["auth"]
  desired_count         = var.service_desired_count
  alb_security_group_id = module.alb.security_group_id
  target_group_arn      = module.alb.target_group_arns["auth"]

  environment = local.common_env["auth"]
  secrets = merge(local.db_secrets["auth"], {
    # The whole secret value is the PEM, written by the signing-key task.
    JWT_PRIVATE_KEY = module.secrets.signing_key_secret_arn
  })

  migrate_environment = local.migrate_env["auth"]
  migrate_secrets = merge(local.migrate_secrets, {
    for c, arn in module.secrets.client_secret_arns :
    "CLIENT_SECRET_${upper(replace(c, "-", "_"))}" => "${arn}:client_secret::"
  })

  one_off_tasks = {
    "signing-key" = {
      command     = ["node", "dist/bootstrap-signing-key.js"]
      environment = { SIGNING_KEY_SECRET_ID = module.secrets.signing_key_secret_arn }
      secrets     = {}
      policy_json = jsonencode({
        Version = "2012-10-17"
        Statement = [{
          Effect   = "Allow"
          Action   = ["secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue"]
          Resource = module.secrets.signing_key_secret_arn
        }]
      })
    }
  }

}

module "platform" {
  source = "../../modules/ecs-service"

  name                  = local.name
  service               = "platform"
  cluster_arn           = module.ecs_cluster.cluster_arn
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  image                 = local.image["platform"]
  port                  = local.ports["platform"]
  desired_count         = var.service_desired_count
  alb_security_group_id = module.alb.security_group_id
  target_group_arn      = module.alb.target_group_arns["platform"]

  environment = merge(local.common_env["platform"], {
    PLATFORM_FILES_BUCKET = module.s3.platform_files_bucket
    AWS_REGION            = var.region
  })
  secrets = local.db_secrets["platform"]

  task_policy_json = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
      Resource = "${module.s3.platform_files_arn}/*"
    }]
  })

  migrate_environment = local.migrate_env["platform"]
  migrate_secrets     = local.migrate_secrets

  # Runs after the migrations in every environment, and is safe to repeat (Step 1.2).
  one_off_tasks = {
    seed = {
      command = ["node", "dist/seed-run.js"]
      environment = {
        DB_HOST           = module.rds.endpoint
        DB_NAME           = "platform_db"
        AUTH_URL          = "${local.alb_url}:3001"
        SEED_FILES        = var.seed_files
        SEED_CREATE_USERS = var.seed_create_users ? "true" : "false"
      }
      secrets = merge(local.db_secrets["platform"], {
        CLIENT_SECRET_SEED_SCRIPT = "${module.secrets.client_secret_arns["seed-script"]}:client_secret::"
      }, var.seed_create_users ? { SEED_USER_PASSWORD = module.secrets.seed_user_secret_arn } : {})
      policy_json = ""
    }
  }

}

module "docbeam_api" {
  source = "../../modules/ecs-service"

  name                  = local.name
  service               = "docbeam-api"
  cluster_arn           = module.ecs_cluster.cluster_arn
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  image                 = local.image["docbeam-api"]
  port                  = local.ports["docbeam-api"]
  desired_count         = var.service_desired_count
  alb_security_group_id = module.alb.security_group_id
  target_group_arn      = module.alb.target_group_arns["docbeam-api"]

  environment = local.common_env["docbeam-api"]
  secrets     = local.db_secrets["docbeam-api"]

  migrate_environment = local.migrate_env["docbeam-api"]
  migrate_secrets     = local.migrate_secrets

}
