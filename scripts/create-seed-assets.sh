#!/usr/bin/env bash
set -euo pipefail

source_directory=${SEED_ASSET_DIRECTORY:-.local/current-seed-assets}
output_directory=${SEED_ARTIFACT_DIRECTORY:-artifacts}
output_path=${output_directory}/current-development-seed-assets.tar.gz

for required_path in private scorm-source; do
  if [[ ! -d "$source_directory/$required_path" ]]; then
    echo "Missing seed asset directory: $source_directory/$required_path" >&2
    exit 1
  fi
done

mkdir -p "$output_directory"
tar -czf "$output_path" -C "$source_directory" private scorm-source
sha256sum "$output_path" > "$output_path.sha256"
printf '%s\n' "$output_path"
