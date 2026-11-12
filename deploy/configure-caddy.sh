#!/usr/bin/env bash
set -Eeuo pipefail

fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || fail 'run this setup script with sudo'

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
caddyfile=/etc/caddy/Caddyfile
snippet=$repo_dir/deploy/Caddyfile.experiments
site_root=/var/www/armsteel-experiments
marker=$site_root/.managed-by-armsteel-experiments

[[ -r $caddyfile ]] || fail "cannot read $caddyfile"
[[ -r $snippet ]] || fail "cannot read $snippet"
[[ -f $marker ]] || fail 'the static root is missing the Experiments ownership marker; run npm run publish first'
[[ -f $site_root/current/index.html ]] || fail 'publish the static build first; current/index.html is missing'
command -v caddy >/dev/null || fail 'caddy is not installed'
command -v systemctl >/dev/null || fail 'systemctl is not available'

if grep -Eq '^[[:space:]]*experiments\.armsteel\.dev[[:space:]]*\{' "$caddyfile"; then
  fail "experiments.armsteel.dev already has a site block in $caddyfile; inspect it instead of appending a duplicate"
fi

backup="$caddyfile.backup.armsteel-experiments.$(date -u +%Y%m%dT%H%M%SZ)"
candidate=$(mktemp /etc/caddy/.Caddyfile.experiments.XXXXXX)
restore_candidate=
cleanup() {
  [[ -z ${candidate:-} ]] || rm -f -- "$candidate"
  [[ -z ${restore_candidate:-} ]] || rm -f -- "$restore_candidate"
}
trap cleanup EXIT

source_hash=$(sha256sum "$caddyfile" | awk '{print $1}')
cat -- "$caddyfile" > "$candidate"
printf '\n' >> "$candidate"
cat -- "$snippet" >> "$candidate"
chown --reference="$caddyfile" "$candidate"
chmod --reference="$caddyfile" "$candidate"

printf 'Validating complete candidate Caddy configuration...\n'
caddy validate --config "$candidate" --adapter caddyfile
[[ $(sha256sum "$caddyfile" | awk '{print $1}') == "$source_hash" ]] || fail "$caddyfile changed while validating; no installation was made"
[[ ! -e $backup ]] || fail "backup path already exists: $backup"
cp -a -- "$caddyfile" "$backup"
mv -f -- "$candidate" "$caddyfile"
candidate=

restore_original() {
  restore_candidate=$(mktemp /etc/caddy/.Caddyfile.restore.XXXXXX)
  cp -a -- "$backup" "$restore_candidate"
  mv -f -- "$restore_candidate" "$caddyfile"
  restore_candidate=
}

if ! caddy validate --config "$caddyfile" --adapter caddyfile; then
  restore_original
  fail "installed configuration did not validate; restored $backup"
fi

if ! systemctl reload caddy; then
  restore_original
  fail "Caddy reload failed; restored $backup. The running service was not restarted."
fi

systemctl is-active --quiet caddy || fail 'Caddy is not active after the reload; inspect systemctl status caddy'
printf 'Caddy reloaded with the Experiments host. Previous config saved as %s\n' "$backup"
