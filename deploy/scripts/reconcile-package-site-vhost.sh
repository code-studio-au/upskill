#!/usr/bin/env bash
set -euo pipefail

package_nginx_path=/etc/nginx/conf.d/upskill-package-site.conf
package_site_state_path=/etc/upskill/offline-scorm-package-site-suffix
desired_suffix=${1:-}
release_supports_package_host=${2:-true}

fail() { echo "$*" >&2; exit 1; }
is_domain() {
  (( ${#1} <= 253 )) &&
    [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]
}

[[ ${EUID} -eq 0 ]] || fail "Run this script as root"
[[ $# -le 2 ]] || fail "Usage: $0 [desired-package-site-suffix] [release-supports-package-host]"
case "$release_supports_package_host" in
  true | false) ;;
  *) fail "release-supports-package-host must be true or false" ;;
esac

invalid_suffix=false
if [[ -n "$desired_suffix" ]] && ! is_domain "$desired_suffix"; then
  echo "Invalid provisioned package-site suffix; disabling the package vhost" >&2
  desired_suffix=""
  invalid_suffix=true
fi
if [[ "$release_supports_package_host" == false ]]; then
  desired_suffix=""
fi

configured_suffix=""
if [[ -f "$package_site_state_path" ]]; then
  configured_suffix=$(<"$package_site_state_path")
fi
vhost_matches_desired=false
if [[ -n "$desired_suffix" ]] &&
  grep -Fq "server_name *.${desired_suffix};" "$package_nginx_path" 2>/dev/null; then
  vhost_matches_desired=true
fi

if [[ -f "$package_nginx_path" ]] &&
  { [[ -z "$desired_suffix" ]] ||
    [[ "$configured_suffix" != "$desired_suffix" ]] ||
    [[ "$vhost_matches_desired" != true ]]; }; then
  disabled_path=$(mktemp /etc/nginx/conf.d/.upskill-package-site.disabled.XXXXXX)
  rm -f -- "$disabled_path"
  mv -- "$package_nginx_path" "$disabled_path"
  if ! nginx -t; then
    mv -- "$disabled_path" "$package_nginx_path"
    fail "Refusing to disable the package vhost because nginx validation failed"
  fi
  if ! systemctl reload nginx; then
    mv -- "$disabled_path" "$package_nginx_path"
    nginx -t >/dev/null 2>&1 || true
    systemctl reload nginx >/dev/null 2>&1 || true
    fail "Failed to reload nginx after disabling the package vhost"
  fi
  rm -f -- "$disabled_path"
  echo "Disabled stale offline SCORM package vhost" >&2
fi

if [[ ! -f "$package_nginx_path" ]]; then
  rm -f -- "$package_site_state_path"
fi

if [[ "$invalid_suffix" == true ]]; then
  exit 1
fi
