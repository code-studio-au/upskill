#!/usr/bin/env bash
set -euo pipefail

artifact_path=${1:?artifact path required}
release_sha=${2:?release SHA required}
expected_sha256=${3:?artifact SHA-256 required}
release_root=/opt/upskill/releases
release_path=${release_root}/${release_sha}
staging_path=""
previous_release=""
previous_sha=""
environment_backup=""

write_deployment_id() {
  local deployment_id=$1
  if [[ ! "$deployment_id" =~ ^[a-f0-9]{40}$ ]]; then
    echo "Deployment identity must be a full lowercase Git commit" >&2
    return 1
  fi
  for environment_file in upskill-web.env upskill-worker.env upskill-deploy.env; do
    if [[ ! -f "/opt/upskill/shared/$environment_file" ]]; then
      echo "Missing runtime environment file: $environment_file" >&2
      return 1
    fi
    printf 'DEPLOYMENT_ID="%s"\n' "$deployment_id" >> "/opt/upskill/shared/$environment_file"
  done
}

cleanup() {
  if [[ -n "$staging_path" && -d "$staging_path" ]]; then
    case "$staging_path" in
      "$release_root"/."$release_sha".staging.*) rm -rf -- "$staging_path" ;;
      *) echo "Refusing to clean unexpected staging path: $staging_path" >&2 ;;
    esac
  fi
  if [[ -n "$environment_backup" && -d "$environment_backup" ]]; then
    case "$environment_backup" in
      /opt/upskill/shared/.environment-backup.*)
        rm -rf -- "$environment_backup"
        ;;
      *)
        echo "Refusing to clean unexpected environment backup: $environment_backup" >&2
        ;;
    esac
  fi
}
trap cleanup EXIT

restore_environment_backup() {
  local environment_file
  for environment_file in upskill-web.env upskill-worker.env upskill-deploy.env; do
    install -o root -g root -m 0600 \
      "$environment_backup/$environment_file" \
      "/opt/upskill/shared/$environment_file"
  done
}

restore_active_environment() {
  restore_environment_backup
  if systemctl restart upskill-web upskill-worker && \
    active_release_is_ready; then
    echo "Restored previous configuration after active-release refresh failure" >&2
    return 0
  fi
  echo "Previous configuration restore failed readiness" >&2
  return 1
}

validate_active_environment() {
  (
    set -a
    source /opt/upskill/shared/upskill-deploy.env
    set +a
    cd "$release_path"
    sudo -u ec2-user --preserve-env /usr/local/bin/node \
      scripts/validate-runtime-environment.ts
  )
}

active_release_is_ready() {
  curl --fail --silent --show-error --retry 20 --retry-delay 2 \
    --retry-connrefused \
    "http://127.0.0.1:3000/api/ready?deploymentId=${release_sha}" \
    >/dev/null && systemctl is-active --quiet upskill-worker
}

if [[ ! "$release_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Release SHA must be a full lowercase Git commit" >&2
  exit 1
fi

actual_sha256=$(sha256sum "$artifact_path" | awk '{print $1}')
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "Artifact checksum mismatch" >&2
  exit 1
fi

install -d -o ec2-user -g ec2-user "$release_root"
install -d -o root -g root -m 0755 /opt/upskill/shared
exec 9>/opt/upskill/shared/deploy.lock
if ! flock -n 9; then
  echo "Another deployment is already in progress" >&2
  exit 1
fi

archive_list=$(mktemp)
trap 'rm -f -- "$archive_list"; cleanup' EXIT
tar -tzf "$artifact_path" > "$archive_list"
while IFS= read -r entry; do
  case "$entry" in
    /* | .. | ../* | */.. | */../*)
      echo "Release contains an unsafe archive path: $entry" >&2
      exit 1
      ;;
  esac
done < "$archive_list"

staging_path=$(mktemp -d "$release_root/.${release_sha}.staging.XXXXXX")
tar --no-same-owner --no-same-permissions -xzf "$artifact_path" -C "$staging_path"
manifest_sha=$(jq -er '.gitSha' "$staging_path/.upskill-release.json")
if [[ "$manifest_sha" != "$release_sha" ]]; then
  echo "Release manifest does not match requested Git SHA" >&2
  exit 1
fi
chown -R ec2-user:ec2-user "$staging_path"
sudo -u ec2-user env CI=true /usr/local/bin/pnpm --dir "$staging_path" --filter upskill install --prod --frozen-lockfile --ignore-scripts

if [[ -e "$release_path" || -L "$release_path" ]]; then
  if [[ -L "$release_path" || ! -d "$release_path" ]]; then
    echo "Existing release path is unsafe: $release_path" >&2
    exit 1
  fi
  active_path=$(readlink -f /opt/upskill/current 2>/dev/null || true)
  if [[ "$active_path" == "$release_path" ]]; then
    environment_backup=$(mktemp -d \
      /opt/upskill/shared/.environment-backup.XXXXXX)
    chmod 0700 "$environment_backup"
    for environment_file in \
      upskill-web.env upskill-worker.env upskill-deploy.env; do
      cp -p "/opt/upskill/shared/$environment_file" \
        "$environment_backup/$environment_file"
    done
    if ! /usr/local/bin/upskill-refresh-env || \
      ! write_deployment_id "$release_sha" || \
      ! validate_active_environment; then
      restore_active_environment || true
      echo "Active-release configuration refresh failed validation" >&2
      exit 1
    fi
    if ! systemctl restart upskill-web upskill-worker || \
      ! active_release_is_ready; then
      restore_active_environment || true
      echo "Active-release configuration refresh failed readiness" >&2
      exit 1
    fi
    rm -rf -- "$environment_backup"
    environment_backup=""
    echo "Refreshed configuration for active release $release_sha"
    exit 0
  fi
  rm -rf -- "$release_path"
fi
mv "$staging_path" "$release_path"
staging_path=""

/usr/local/bin/upskill-refresh-env
write_deployment_id "$release_sha"
(
  set -a
  source /opt/upskill/shared/upskill-deploy.env
  set +a
  cd "$release_path"
  sudo -u ec2-user --preserve-env /usr/local/bin/node scripts/validate-runtime-environment.ts
  sudo -u ec2-user --preserve-env /usr/local/bin/node src/server/db/migrate.ts
  sudo -u ec2-user --preserve-env /usr/local/bin/node src/server/db/provision-runtime-roles.ts
)

if [[ -L /opt/upskill/current ]]; then
  previous_release=$(readlink -f /opt/upskill/current || true)
  previous_sha=${previous_release#"$release_root"/}
  if [[ ! "$previous_sha" =~ ^[a-f0-9]{40}$ || "$previous_release" != "$release_root/$previous_sha" || ! -d "$previous_release" ]]; then
    echo "The current release does not have a verifiable rollback identity" >&2
    previous_release=""
    previous_sha=""
  elif [[ -f "$previous_release/.upskill-release.json" ]]; then
    previous_manifest_sha=$(jq -er '.gitSha' "$previous_release/.upskill-release.json" 2>/dev/null || true)
    if [[ "$previous_manifest_sha" != "$previous_sha" ]]; then
      echo "The current release manifest does not match its rollback identity" >&2
      previous_release=""
      previous_sha=""
    fi
  fi
fi
ln -sfn "$release_path" /opt/upskill/current
if [[ -n "$previous_release" && -d "$previous_release" ]]; then
  ln -sfn "$previous_release" /opt/upskill/previous
fi
install -m 0644 "$release_path/deploy/systemd/upskill-web.service" /etc/systemd/system/upskill-web.service
install -m 0644 "$release_path/deploy/systemd/upskill-worker.service" /etc/systemd/system/upskill-worker.service
install -m 0644 "$release_path/deploy/systemd/upskill-monitor.service" /etc/systemd/system/upskill-monitor.service
install -m 0644 "$release_path/deploy/systemd/upskill-monitor.timer" /etc/systemd/system/upskill-monitor.timer
install -d -m 0755 /etc/upskill /var/www/certbot/.well-known/acme-challenge
install -m 0644 "$release_path/deploy/nginx/upskill.https.conf.template" /etc/upskill/upskill.https.conf.template
install -m 0755 "$release_path/deploy/scripts/provision-letsencrypt-cert.sh" /usr/local/bin/upskill-provision-letsencrypt-cert
install -o root -g root -m 0750 "$release_path/deploy/scripts/bootstrap-platform-admin.sh" /usr/local/sbin/upskill-bootstrap-platform-admin
install -o root -g root -m 0750 "$release_path/deploy/scripts/invite-platform-admin.sh" /usr/local/sbin/upskill-invite-platform-admin
install -o root -g root -m 0750 "$release_path/deploy/scripts/seed-staging.sh" /usr/local/sbin/upskill-seed-staging
install -o root -g root -m 0750 "$release_path/deploy/scripts/reset-and-seed-staging.sh" /usr/local/sbin/upskill-reset-and-seed-staging
install -m 0755 "$release_path/deploy/scripts/publish-operational-metrics.sh" /usr/local/bin/upskill-publish-operational-metrics
if [[ ! -f /etc/nginx/conf.d/upskill.conf ]]; then
  install -m 0644 "$release_path/deploy/nginx/upskill.conf" /etc/nginx/conf.d/upskill.conf
fi
nginx -t
systemctl daemon-reload
systemctl enable upskill-web upskill-worker upskill-monitor.timer nginx
systemctl start upskill-monitor.timer
systemctl restart upskill-web upskill-worker
systemctl reload nginx

if ! curl --fail --silent --show-error --retry 20 --retry-delay 2 --retry-connrefused "http://127.0.0.1:3000/api/ready?deploymentId=${release_sha}" >/dev/null || ! systemctl is-active --quiet upskill-worker; then
  if [[ -n "$previous_release" && -n "$previous_sha" ]]; then
    if /usr/local/bin/upskill-refresh-env && write_deployment_id "$previous_sha"; then
      ln -sfn "$previous_release" /opt/upskill/current
      if systemctl restart upskill-web upskill-worker && curl --fail --silent --show-error --retry 20 --retry-delay 2 --retry-connrefused "http://127.0.0.1:3000/api/ready?deploymentId=${previous_sha}" >/dev/null && systemctl is-active --quiet upskill-worker; then
        echo "Restored previous release $previous_sha" >&2
      else
        echo "Previous release rollback failed readiness checks" >&2
      fi
    else
      echo "Previous release rollback could not restore its environment" >&2
    fi
  fi
  echo "Release failed readiness checks and was rolled back" >&2
  exit 1
fi

find "$release_root" -mindepth 1 -maxdepth 1 -type d -not -path "$release_path" -not -path "$previous_release" -mtime +14 -exec rm -rf -- {} +
