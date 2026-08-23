#!/usr/bin/env bash
set -euo pipefail

artifact_path=${1:?artifact path required}
release_sha=${2:?release SHA required}
expected_sha256=${3:?artifact SHA-256 required}
release_root=/opt/upskill/releases
release_path=${release_root}/${release_sha}
staging_path=""
previous_release=""

cleanup() {
  if [[ -n "$staging_path" && -d "$staging_path" ]]; then
    case "$staging_path" in
      "$release_root"/."$release_sha".staging.*) rm -rf -- "$staging_path" ;;
      *) echo "Refusing to clean unexpected staging path: $staging_path" >&2 ;;
    esac
  fi
}
trap cleanup EXIT

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
    echo "Release is already active"
    exit 0
  fi
  rm -rf -- "$release_path"
fi
mv "$staging_path" "$release_path"
staging_path=""

/usr/local/bin/upskill-refresh-env
for environment_file in upskill-web.env upskill-worker.env upskill-deploy.env; do
  printf 'DEPLOYMENT_ID="%s"\n' "$release_sha" >> "/opt/upskill/shared/$environment_file"
done
(
  set -a
  source /opt/upskill/shared/upskill-deploy.env
  set +a
  cd "$release_path"
  sudo -u ec2-user --preserve-env /usr/local/bin/node src/server/db/migrate.ts
  sudo -u ec2-user --preserve-env /usr/local/bin/node src/server/db/provision-runtime-roles.ts
)

if [[ -L /opt/upskill/current ]]; then
  previous_release=$(readlink -f /opt/upskill/current || true)
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

if ! curl --fail --silent --show-error --retry 20 --retry-delay 2 "http://127.0.0.1/api/ready?deploymentId=${release_sha}" >/dev/null || ! systemctl is-active --quiet upskill-worker; then
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -sfn "$previous_release" /opt/upskill/current
    systemctl restart upskill-web upskill-worker
  fi
  echo "Release failed readiness checks and was rolled back" >&2
  exit 1
fi

find "$release_root" -mindepth 1 -maxdepth 1 -type d -not -path "$release_path" -not -path "$previous_release" -mtime +14 -exec rm -rf -- {} +
