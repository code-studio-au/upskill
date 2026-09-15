#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "LiveKit spend observations must be recorded as root" >&2
  exit 1
fi
if [[ $# -ne 2 ]]; then
  echo "Usage: $0 YYYY-MM MONTH_TO_DATE_SPEND_AUD" >&2
  exit 1
fi

billing_month=$1
monthly_spend_aud=$2
if [[ ! "$billing_month" =~ ^[0-9]{4}-(0[1-9]|1[0-2])$ ]]; then
  echo "Billing month must use YYYY-MM" >&2
  exit 1
fi
if [[ ! "$monthly_spend_aud" =~ ^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$ ]]; then
  echo "Month-to-date spend must be a non-negative AUD amount" >&2
  exit 1
fi
current_month=$(date -u +%Y-%m)
if [[ "$billing_month" != "$current_month" ]]; then
  echo "Billing month must match the current UTC month ($current_month)" >&2
  exit 1
fi

observation_path=/opt/upskill/shared/livekit-spend-observation.json
temporary_path=$(mktemp /opt/upskill/shared/.livekit-spend-observation.XXXXXX)
trap 'rm -f -- "$temporary_path"' EXIT
jq -n \
  --arg billingMonth "$billing_month" \
  --argjson monthlySpendAud "$monthly_spend_aud" \
  --arg observedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{billingMonth: $billingMonth, monthlySpendAud: $monthlySpendAud, observedAt: $observedAt}' \
  > "$temporary_path"
install -o root -g root -m 0600 "$temporary_path" "$observation_path"
rm -f -- "$temporary_path"
trap - EXIT
systemctl start upskill-monitor.service
echo "Recorded current LiveKit spend observation and requested an immediate metric refresh"
