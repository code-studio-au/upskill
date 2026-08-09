#!/usr/bin/env bash
set -euo pipefail

artifact_path=${1:?artifact path required}
release_sha=${2:?release SHA required}
expected_sha256=${3:?artifact SHA-256 required}
release_root=/opt/upskill/releases
release_path=${release_root}/${release_sha}

if [[ ! "$release_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Release SHA must be a full lowercase Git commit" >&2
  exit 1
fi

actual_sha256=$(sha256sum "$artifact_path" | awk '{print $1}')
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "Artifact checksum mismatch" >&2
  exit 1
fi

install -d -o ec2-user -g ec2-user "$release_path"
tar -xzf "$artifact_path" -C "$release_path"
ln -sfn "$release_path" /opt/upskill/current

/usr/local/bin/upskill-refresh-env
printf 'DEPLOYMENT_ID="%s"\n' "$release_sha" >> /opt/upskill/shared/upskill.env
install -m 0644 "$release_path/deploy/systemd/upskill-web.service" /etc/systemd/system/upskill-web.service
install -m 0644 "$release_path/deploy/systemd/upskill-worker.service" /etc/systemd/system/upskill-worker.service
install -m 0644 "$release_path/deploy/nginx/upskill.conf" /etc/nginx/conf.d/upskill.conf
nginx -t
systemctl daemon-reload
systemctl enable upskill-web upskill-worker nginx
systemctl restart upskill-web upskill-worker nginx

curl --fail --silent --show-error --retry 12 --retry-delay 2 http://127.0.0.1/api/health >/dev/null
systemctl is-active --quiet upskill-worker
