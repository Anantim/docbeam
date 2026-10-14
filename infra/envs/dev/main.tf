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

  # The bucket comes from -backend-config (see README), so no account id is in git.
  backend "s3" {
    key          = "envs/dev/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "docbeam"
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name       = "docbeam-dev"
  account_id = data.aws_caller_identity.current.account_id
  admin_principal_arns = [
    for user in var.admin_user_names : "arn:aws:iam::${local.account_id}:user/${user}"
  ]
}

module "network" {
  source = "../../modules/network"

  name               = local.name
  availability_zones = data.aws_availability_zones.available.names
  nat_gateway_count  = 1 # one shared NAT gateway in dev to save credits
}

module "rds" {
  source = "../../modules/rds"

  name               = local.name
  vpc_id             = module.network.vpc_id
  vpc_cidr_block     = module.network.vpc_cidr_block
  private_subnet_ids = module.network.private_subnet_ids

  instance_class        = "db.t4g.micro"
  multi_az              = false
  backup_retention_days = 1
  apply_immediately     = true

  # The Free plan blocks RDS Proxy, so dev Lambdas connect to the instance directly (D-M0-6).
  # max_connections is fixed so the connection budget in D-M0-6 is a known number. M5 runs with the proxy on.
  enable_rds_proxy = false
  max_connections  = 100

  # Dev is destroyed and re-created often (D-M0-4).
  deletion_protection         = false
  skip_final_snapshot         = true
  secret_recovery_window_days = 0
}

module "secrets" {
  source = "../../modules/secrets"

  name                        = local.name
  secret_recovery_window_days = 0
  create_seed_password        = true
}

module "ecr" {
  source = "../../modules/ecr"

  name         = local.name
  force_delete = true

  # Each Upload Events image is about 1 GB and one is built every day (D-M2-13).
  keep_images_by_repository = { "upload-events" = 3 }
}

module "s3" {
  source = "../../modules/s3"

  name       = local.name
  account_id = local.account_id

  force_destroy              = true
  deny_delete_object_version = false
  admin_principal_arns       = local.admin_principal_arns
  platform_files_role_arns   = [module.platform.task_role_arn]
  cors_allowed_origins       = ["https://${module.cloudfront.domain_name}", "http://localhost:5173"]

  # The only roles that may touch staged objects, and the one that may read before the clean tag (ADR-003, ADR-016).
  object_store_role_arns = [
    module.docbeam_api.task_role_arn,
    module.upload_events.role_arn,
    module.delivery.role_arn,
    module.sweeper.role_arn,
  ]
  upload_events_enabled   = true
  upload_events_role_arn  = module.upload_events.role_arn
  upload_events_queue_arn = module.sqs.upload_events_queue_arn
}

module "cloudfront" {
  source = "../../modules/cloudfront"

  name                            = local.name
  web_bucket                      = module.s3.web_bucket
  web_bucket_arn                  = module.s3.web_bucket_arn
  web_bucket_regional_domain_name = module.s3.web_bucket_regional_domain_name
  api_origin_domain               = replace(module.api_gateway.api_endpoint, "https://", "")
}

module "ecs_cluster" {
  source = "../../modules/ecs-cluster"

  name   = local.name
  vpc_id = module.network.vpc_id

  db_host           = module.rds.endpoint
  master_secret_arn = module.rds.master_secret_arn
  app_secret_arns   = module.rds.app_secret_arns

  db_bootstrap_image_repository_url = module.ecr.repository_urls["db-bootstrap"]
}
