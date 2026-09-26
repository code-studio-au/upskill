#!/usr/bin/env bash
set -euo pipefail

template_path=/etc/upskill/upskill.https.conf.template
package_template_path=/etc/upskill/upskill.package-site.https.conf.template
nginx_path=/etc/nginx/conf.d/upskill.conf
package_nginx_path=/etc/nginx/conf.d/upskill-package-site.conf
deployed_environment_path=/opt/upskill/shared/upskill-deploy.env
webroot=/var/www/certbot

fail() { echo "$*" >&2; exit 1; }
validate_domain() {
  (( ${#1} <= 253 )) &&
    [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || fail "Invalid DNS domain: $1"
}

[[ ${EUID} -eq 0 ]] || fail "Run this script as root"
[[ $# -eq 3 || $# -eq 4 ]] || fail "Usage: $0 <app-domain> <learning-domain> <contact-email> [package-site-suffix]"
[[ -f "$template_path" ]] || fail "Missing TLS template: $template_path"
app_domain=$1
learning_domain=$2
letsencrypt_email=$3
package_site_suffix=${4:-}
validate_domain "$app_domain"
validate_domain "$learning_domain"
[[ "$app_domain" != "$learning_domain" ]] || fail "Application and learning domains must be distinct"
[[ "$letsencrypt_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail "Invalid contact email"
if [[ -n "$package_site_suffix" ]]; then
  validate_domain "$package_site_suffix"
  [[ -f "$package_template_path" ]] || fail "Missing package-site TLS template: $package_template_path"
  [[ -f "$deployed_environment_path" ]] || fail "Missing deployed environment: $deployed_environment_path"
  provisioned_package_site_suffix=$(
    set -a
    source "$deployed_environment_path"
    printf '%s' "${OFFLINE_SCORM_PACKAGE_HOST_SUFFIX:-}"
  )
  [[ -n "$provisioned_package_site_suffix" ]] || fail "Offline SCORM package host is not provisioned"
  [[ "$package_site_suffix" == "$provisioned_package_site_suffix" ]] || fail "Package-site suffix does not match the provisioned host"
elif [[ -f "$package_nginx_path" ]]; then
  fail "Package-site TLS is already configured; provide its suffix to avoid removing wildcard coverage"
fi

if ! command -v certbot >/dev/null 2>&1; then
  dnf install -y certbot || yum install -y certbot
fi
install -d -m 0755 "$webroot/.well-known/acme-challenge"
nginx -t
systemctl reload nginx
certbot certonly --non-interactive --agree-tos --email "$letsencrypt_email" \
  --cert-name "$app_domain" --webroot --webroot-path "$webroot" \
  --keep-until-expiring -d "$app_domain" -d "$learning_domain"
if [[ -n "$package_site_suffix" ]]; then
  if ! certbot plugins 2>/dev/null | grep -q -- 'dns-route53'; then
    dnf install -y python3-certbot-dns-route53 || yum install -y python3-certbot-dns-route53
  fi
  package_cert_name="upskill-package-${package_site_suffix}"
  certbot certonly --non-interactive --agree-tos --email "$letsencrypt_email" \
    --cert-name "$package_cert_name" --dns-route53 --keep-until-expiring \
    -d "*.${package_site_suffix}"
fi
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
if [[ -n "$package_site_suffix" ]]; then
  sed -e "s/__APP_DOMAIN__/${app_domain}/g" \
    -e "s/__PACKAGE_SITE_SUFFIX__/${package_site_suffix}/g" \
    -e "s/__PACKAGE_CERT_NAME__/${package_cert_name}/g" \
    -e "s/__HTTP2_LISTEN_SUFFIX__/${http2_listen_suffix}/g" \
    -e "s/__HTTP2_DIRECTIVE__/${http2_directive}/g" \
    "$package_template_path" > "$package_nginx_path"
fi
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
