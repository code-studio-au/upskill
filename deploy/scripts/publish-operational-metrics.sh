#!/usr/bin/env bash
set -euo pipefail

set -a
source /opt/upskill/shared/upskill-web.env
set +a
ready=0
worker=0
if curl --fail --silent --max-time 10 http://127.0.0.1/api/ready >/dev/null; then ready=1; fi
if systemctl is-active --quiet upskill-worker; then worker=1; fi
cd /opt/upskill/current
exec /usr/local/bin/node scripts/report-operational-metrics.mjs "$ready" "$worker"
