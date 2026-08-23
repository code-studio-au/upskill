#!/usr/bin/env bash
set -euo pipefail

template_path=/etc/upskill/upskill.https.conf.template
nginx_path=/etc/nginx/conf.d/upskill.conf
webroot=/var/www/certbot

fail() { echo "$*" >&2; exit 1; }
validate_domain() {
  (( ${#1} <= 253 )) &&
    [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || fail "Invalid DNS domain: $1"
}

[[ ${EUID} -eq 0 ]] || fail "Run this script as root"
[[ $# -eq 3 ]] || fail "Usage: $0 <app-domain> <learning-domain> <contact-email>"
[[ -f "$template_path" ]] || fail "Missing TLS template: $template_path"
app_domain=$1
learning_domain=$2
letsencrypt_email=$3
validate_domain "$app_domain"
validate_domain "$learning_domain"
[[ "$app_domain" != "$learning_domain" ]] || fail "Application and learning domains must be distinct"
[[ "$letsencrypt_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail "Invalid contact email"

if ! command -v certbot >/dev/null 2>&1; then
  dnf install -y certbot || yum install -y certbot
fi
install -d -m 0755 "$webroot/.well-known/acme-challenge"
nginx -t
systemctl reload nginx
certbot certonly --non-interactive --agree-tos --email "$letsencrypt_email" \
  --webroot --webroot-path "$webroot" --keep-until-expiring \
  -d "$app_domain" -d "$learning_domain"
http2_listen_suffix=" http2"
http2_directive=""
nginx_version=$(nginx -v 2>&1 || true)
if [[ "$nginx_version" =~ nginx/([0-9]+)\.([0-9]+)\.([0-9]+) ]] &&
  (( BASH_REMATCH[1] > 1 ||
    (BASH_REMATCH[1] == 1 &&
      (BASH_REMATCH[2] > 25 ||
        (BASH_REMATCH[2] == 25 && BASH_REMATCH[3] >= 1))) )); then
  http2_listen_suffix=""
  http2_directive="http2 on;"
fi
sed -e "s/__APP_DOMAIN__/${app_domain}/g" \
  -e "s/__LEARNING_DOMAIN__/${learning_domain}/g" \
  -e "s/__HTTP2_LISTEN_SUFFIX__/${http2_listen_suffix}/g" \
  -e "s/__HTTP2_DIRECTIVE__/${http2_directive}/g" \
  "$template_path" > "$nginx_path"
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'nginx -t' 'systemctl reload nginx' > /etc/letsencrypt/renewal-hooks/deploy/upskill-nginx-reload.sh
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/upskill-nginx-reload.sh
nginx -t
systemctl reload nginx
for timer in certbot-renew.timer certbot.timer; do
  if systemctl cat "$timer" >/dev/null 2>&1; then
    systemctl enable --now "$timer"
    exit 0
  fi
done
fail "Certbot installed without a supported renewal timer"
