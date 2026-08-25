#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Staging seed must run as root" >&2
  exit 1
fi

release_path=$(readlink -f /opt/upskill/current 2>/dev/null || true)
if [[ ! "$release_path" =~ ^/opt/upskill/releases/[a-f0-9]{40}$ || ! -d "$release_path" ]]; then
  echo "No verified Upskill release is active" >&2
  exit 1
fi

deploy_environment=/opt/upskill/shared/upskill-deploy.env
seed_environment=/opt/upskill/shared/upskill-seed.env
if [[ ! -f "$deploy_environment" || ! -f "$seed_environment" ]]; then
  echo "Protected deploy and seed environment files are required" >&2
  exit 1
fi
if [[ $(stat -c '%U:%G:%a' "$seed_environment") != "root:root:600" ]]; then
  echo "upskill-seed.env must be owned by root:root with mode 0600" >&2
  exit 1
fi

set -a
source "$deploy_environment"
set +a

deployed_app_environment=${APP_ENV:-}
if [[ "$deployed_app_environment" != "staging" ]]; then
  echo "Staging seed is prohibited unless APP_ENV=staging" >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  line=${line%$'\r'}
  if [[ -z "$line" || "$line" == \#* ]]; then
    continue
  fi
  if [[ "$line" != *=* ]]; then
    echo "upskill-seed.env contains an invalid line" >&2
    exit 1
  fi
  key=${line%%=*}
  value=${line#*=}
  case "$key" in
    ALLOW_STAGING_SEED | SEED_ASSET_DIRECTORY | SEED_LEARNER_PASSWORD | SEED_SMS_TEST_PHONE | SEED_SMS_TEST_USER_EMAIL)
      printf -v "$key" '%s' "$value"
      export "$key"
      ;;
    *)
      echo "upskill-seed.env contains a prohibited key: $key" >&2
      exit 1
      ;;
  esac
done < "$seed_environment"

APP_ENV=$deployed_app_environment
export APP_ENV
DATABASE_URL=${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}
export DATABASE_URL
if [[ ! -d ${SEED_ASSET_DIRECTORY:-} ]]; then
  echo "SEED_ASSET_DIRECTORY must identify the extracted protected asset bundle" >&2
  exit 1
fi

cd "$release_path"
sudo -u ec2-user --preserve-env \
  /usr/local/bin/node --import tsx scripts/seed-current-snapshot.ts
