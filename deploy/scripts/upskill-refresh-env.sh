#!/usr/bin/env bash
set -euo pipefail

environment_file=/opt/upskill/shared/upskill-deploy.env
if [[ ! -f "$environment_file" ]]; then
  echo "Existing deployment environment is required to refresh host configuration" >&2
  exit 1
fi

set -a
source "$environment_file"
set +a
refresh_environment=${APP_ENV:?APP_ENV is required to refresh host configuration}
refresh_region=${AWS_REGION:?AWS_REGION is required to refresh host configuration}
case "$refresh_environment" in
  staging | production) ;;
  *)
    echo "Unsupported deployed environment: $refresh_environment" >&2
    exit 1
    ;;
esac
if [[ ! "$refresh_region" =~ ^[a-z0-9-]+$ ]]; then
  echo "AWS_REGION is invalid" >&2
  exit 1
fi

secret_prefix="upskill/${refresh_environment}"
application_json=$(aws secretsmanager get-secret-value --region "$refresh_region" --secret-id "${secret_prefix}/application" --query SecretString --output text)
livekit_json=$(aws secretsmanager get-secret-value --region "$refresh_region" --secret-id "${secret_prefix}/livekit" --query SecretString --output text)
database_json=$(aws secretsmanager get-secret-value --region "$refresh_region" --secret-id "${secret_prefix}/database" --query SecretString --output text)
web_database_json=$(aws secretsmanager get-secret-value --region "$refresh_region" --secret-id "${secret_prefix}/database/web" --query SecretString --output text)
worker_database_json=$(aws secretsmanager get-secret-value --region "$refresh_region" --secret-id "${secret_prefix}/database/worker" --query SecretString --output text)
access_code_encryption_key=$(aws secretsmanager get-secret-value --region "$refresh_region" --secret-id "${secret_prefix}/access-code/v1" --query SecretString --output text)
base_environment_tmp=$(mktemp)
web_environment_tmp=$(mktemp)
worker_environment_tmp=$(mktemp)
deploy_environment_tmp=$(mktemp)
trap 'rm -f -- "$base_environment_tmp" "$web_environment_tmp" "$worker_environment_tmp" "$deploy_environment_tmp"' EXIT
jq -r 'to_entries[] | "\(.key)=\(.value|tostring|@json)"' <<< "$application_json" > "$base_environment_tmp"
jq -r 'to_entries[] | select(.key == "LIVEKIT_ENABLED" or .key == "LIVEKIT_PROJECT_ENVIRONMENT" or .key == "LIVEKIT_URL" or .key == "LIVEKIT_API_KEY" or .key == "LIVEKIT_API_SECRET" or .key == "LIVEKIT_APPROVED_MAX_PARTICIPANTS" or .key == "LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS") | "\(.key)=\(.value|tostring|@json)"' <<< "$livekit_json" >> "$base_environment_tmp"
database_host=$(jq -r '.host' <<< "$database_json")
database_port=$(jq -r '.port' <<< "$database_json")
database_name=$(jq -r '.dbname' <<< "$database_json")
database_tls='sslmode=verify-full&sslrootcert=%2Fetc%2Fupskill%2Frds-global-bundle.pem'
migration_database_url=$(jq -rn --argjson credentials "$database_json" --arg host "$database_host" --arg port "$database_port" --arg name "$database_name" --arg tls "$database_tls" '"postgresql://\($credentials.username|@uri):\($credentials.password|@uri)@\($host):\($port)/\($name)?\($tls)"')
web_database_url=$(jq -rn --argjson credentials "$web_database_json" --arg host "$database_host" --arg port "$database_port" --arg name "$database_name" --arg tls "$database_tls" '"postgresql://\($credentials.username|@uri):\($credentials.password|@uri)@\($host):\($port)/\($name)?\($tls)"')
worker_database_url=$(jq -rn --argjson credentials "$worker_database_json" --arg host "$database_host" --arg port "$database_port" --arg name "$database_name" --arg tls "$database_tls" '"postgresql://\($credentials.username|@uri):\($credentials.password|@uri)@\($host):\($port)/\($name)?\($tls)"')
cp "$base_environment_tmp" "$web_environment_tmp"
cp "$base_environment_tmp" "$worker_environment_tmp"
cp "$base_environment_tmp" "$deploy_environment_tmp"
jq -rn --arg value "$web_database_url" '"DATABASE_URL=\($value|@json)"' >> "$web_environment_tmp"
jq -rn --arg value "$worker_database_url" '"DATABASE_URL=\($value|@json)"' >> "$worker_environment_tmp"
jq -rn --arg value "$web_database_url" '"DATABASE_URL=\($value|@json)"' >> "$deploy_environment_tmp"
jq -rn --arg value "$worker_database_url" '"WORKER_DATABASE_URL=\($value|@json)"' >> "$deploy_environment_tmp"
jq -rn --arg value "$migration_database_url" '"MIGRATION_DATABASE_URL=\($value|@json)"' >> "$deploy_environment_tmp"
for target in "$web_environment_tmp" "$worker_environment_tmp" "$deploy_environment_tmp"; do
  jq -rn --arg value "$access_code_encryption_key" '"ACCESS_CODE_ENCRYPTION_KEY=\($value|@json)"' >> "$target"
done
install -o root -g root -m 0600 "$web_environment_tmp" /opt/upskill/shared/upskill-web.env
install -o root -g root -m 0600 "$worker_environment_tmp" /opt/upskill/shared/upskill-worker.env
install -o root -g root -m 0600 "$deploy_environment_tmp" /opt/upskill/shared/upskill-deploy.env
rm -f -- "$base_environment_tmp" "$web_environment_tmp" "$worker_environment_tmp" "$deploy_environment_tmp"
trap - EXIT
