#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Staging reset and seed must run as root" >&2
  exit 1
fi
if [[ $# -ne 0 ]]; then
  echo "Staging reset and seed accepts no arguments" >&2
  exit 1
fi

release_path=$(readlink -f /opt/upskill/current 2>/dev/null || true)
if [[ ! "$release_path" =~ ^/opt/upskill/releases/([a-f0-9]{40})$ || ! -d "$release_path" ]]; then
  echo "No verified Upskill release is active" >&2
  exit 1
fi
release_sha=${BASH_REMATCH[1]}
manifest_sha=$(jq -er '.gitSha' "$release_path/.upskill-release.json" 2>/dev/null || true)
if [[ "$manifest_sha" != "$release_sha" ]]; then
  echo "The active release manifest does not match its directory" >&2
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

exec 9>/opt/upskill/shared/deploy.lock
if ! flock -n 9; then
  echo "Another deployment or database operation is already in progress" >&2
  exit 1
fi

set -a
source "$deploy_environment"
set +a
deployed_app_environment=${APP_ENV:-}
if [[ "$deployed_app_environment" != "staging" ]]; then
  echo "Staging reset is prohibited unless APP_ENV=staging" >&2
  exit 1
fi
if [[ ${DEPLOYMENT_ID:-} != "$release_sha" ]]; then
  echo "The deployed environment identity does not match the active release" >&2
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
    ALLOW_STAGING_RESET | ALLOW_STAGING_SEED | SEED_ASSET_DIRECTORY | SEED_LEARNER_PASSWORD | SEED_SMS_TEST_PHONE | SEED_SMS_TEST_USER_EMAIL | STAGING_RESET_DATABASE_TARGET)
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
if [[ ${ALLOW_STAGING_SEED:-} != "I_UNDERSTAND_THIS_ADDS_FIXTURE_DATA" ]]; then
  echo "Staging seed requires the exact additive confirmation" >&2
  exit 1
fi
if [[ ! -d ${SEED_ASSET_DIRECTORY:-} ]]; then
  echo "SEED_ASSET_DIRECTORY must identify the extracted protected asset bundle" >&2
  exit 1
fi

cd "$release_path"
sudo -u ec2-user --preserve-env /usr/local/bin/node \
  scripts/reset-staging-database.ts --validate-only
sudo -u ec2-user --preserve-env /usr/local/bin/node \
  scripts/validate-runtime-environment.ts

services_stopped=false
completed=false
on_exit() {
  if [[ "$services_stopped" == true && "$completed" != true ]]; then
    echo "Staging reset did not complete. Web and worker services remain stopped to protect the partially rebuilt database." >&2
  fi
}
trap on_exit EXIT

systemctl stop upskill-web upskill-worker
services_stopped=true

sudo -u ec2-user --preserve-env /usr/local/bin/node \
  scripts/reset-staging-database.ts
sudo -u ec2-user --preserve-env /usr/local/bin/node \
  src/server/db/migrate.ts
sudo -u ec2-user --preserve-env /usr/local/bin/node \
  src/server/db/provision-runtime-roles.ts
DATABASE_URL=$MIGRATION_DATABASE_URL
export DATABASE_URL
sudo -u ec2-user --preserve-env /usr/local/bin/node --import tsx \
  scripts/seed-current-snapshot.ts

systemctl restart upskill-web upskill-worker
curl --fail --silent --show-error --retry 30 --retry-delay 2 \
  --retry-connrefused \
  "http://127.0.0.1:3000/api/ready?deploymentId=${release_sha}" \
  >/dev/null
systemctl is-active --quiet upskill-worker

completed=true
echo "Reset, migrated and seeded staging for release $release_sha"
