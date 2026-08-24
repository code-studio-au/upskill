#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 || $# -ne 2 ]]; then
  echo "Usage: sudo /usr/local/sbin/upskill-invite-platform-admin <name> <email>" >&2
  exit 1
fi
release_path=$(readlink -f /opt/upskill/current 2>/dev/null || true)
if [[ ! "$release_path" =~ ^/opt/upskill/releases/[a-f0-9]{40}$ || ! -d "$release_path" ]]; then
  echo "No verified Upskill release is active" >&2
  exit 1
fi
if [[ ! -f /opt/upskill/shared/upskill-deploy.env ]]; then
  echo "The deployment environment is unavailable" >&2
  exit 1
fi
set -a
source /opt/upskill/shared/upskill-deploy.env
set +a
cd "$release_path"
exec sudo -u ec2-user --preserve-env /usr/local/bin/node \
  scripts/invite-platform-admin.mjs --name "$1" --email "$2"
