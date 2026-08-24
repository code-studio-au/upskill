#!/usr/bin/env bash
set -euo pipefail

artifact_directory=${ARTIFACT_DIRECTORY:-artifacts}
release_sha=${GITHUB_SHA:-$(git rev-parse HEAD)}
artifact_name="upskill-${release_sha}.tar.gz"
artifact_path="${artifact_directory}/${artifact_name}"
manifest_directory=""

cleanup() {
  if [[ -n "$manifest_directory" && -d "$manifest_directory" ]]; then
    rm -rf -- "$manifest_directory"
  fi
}
trap cleanup EXIT

if [[ ! "$release_sha" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Release SHA must be a full lowercase Git commit" >&2
  exit 1
fi
for required_path in dist/server/server.js dist/client dist/worker/scorm-worker.js src/server/db/migrate.ts src/server/db/provision-runtime-roles.ts src/server/db/migrations package.json pnpm-lock.yaml pnpm-workspace.yaml scripts/start-server.mjs scripts/bootstrap-platform-admin.mjs deploy/scripts/install-release.sh deploy/scripts/bootstrap-platform-admin.sh; do
  if [[ ! -e "$required_path" ]]; then
    echo "Missing release input: $required_path" >&2
    exit 1
  fi
done

mkdir -p "$artifact_directory"
manifest_directory=$(mktemp -d)
printf '{"schemaVersion":1,"gitSha":"%s"}\n' "$release_sha" > "$manifest_directory/.upskill-release.json"

tar -czf "$artifact_path" \
  dist \
  src/server/db/migrate.ts \
  src/server/db/provision-runtime-roles.ts \
  src/server/db/migrations \
  scripts/start-server.mjs \
  scripts/bootstrap-platform-admin.mjs \
  scripts/http-compression.mjs \
  scripts/report-operational-metrics.mjs \
  package.json \
  pnpm-lock.yaml \
  pnpm-workspace.yaml \
  deploy/scripts/install-release.sh \
  deploy/scripts/bootstrap-platform-admin.sh \
  deploy/scripts/provision-letsencrypt-cert.sh \
  deploy/scripts/publish-operational-metrics.sh \
  deploy/systemd \
  deploy/nginx \
  -C "$manifest_directory" .upskill-release.json

sha256sum "$artifact_path" > "${artifact_path}.sha256"
printf '%s\n' "$artifact_path"
