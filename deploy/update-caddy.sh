#!/usr/bin/env bash
set -Eeuo pipefail

fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || fail 'run this update script with sudo'

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
caddyfile=/etc/caddy/Caddyfile
snippet=$repo_dir/deploy/Caddyfile.experiments
site_root=/var/www/armsteel-experiments
marker=$site_root/.managed-by-armsteel-experiments

[[ -r $caddyfile ]] || fail "cannot read $caddyfile"
[[ -r $snippet ]] || fail "cannot read $snippet"
[[ -f $marker ]] || fail 'the static root is missing the Experiments ownership marker'
[[ -f $site_root/current/index.html ]] || fail 'the published static site is missing'
command -v caddy >/dev/null || fail 'caddy is not installed'
command -v systemctl >/dev/null || fail 'systemctl is not available'
command -v awk >/dev/null || fail 'awk is not available'

backup="$caddyfile.backup.armsteel-experiments.$(date -u +%Y%m%dT%H%M%SZ)"
candidate=$(mktemp /etc/caddy/.Caddyfile.experiments.XXXXXX)
restore_candidate=
cleanup() {
  [[ -z ${candidate:-} ]] || rm -f -- "$candidate"
  [[ -z ${restore_candidate:-} ]] || rm -f -- "$restore_candidate"
}
trap cleanup EXIT

source_hash=$(sha256sum "$caddyfile" | awk '{print $1}')
if ! awk -v snippet="$snippet" '
  BEGIN {
    while ((getline line < snippet) > 0) replacement = replacement line ORS
    close(snippet)
  }
  function delta(line, opens, closes) {
    opens = gsub(/\{/, "{", line)
    closes = gsub(/\}/, "}", line)
    return opens - closes
  }
  /^[[:space:]]*experiments\.armsteel\.dev[[:space:]]*\{/ && !inside {
    if (found) { error = "more than one Experiments site block"; exit 1 }
    found = 1
    inside = 1
    depth = delta($0)
    if (depth <= 0) { error = "invalid Experiments site block"; exit 1 }
    if (depth == 0) { printf "%s", replacement; inside = 0 }
    next
  }
  inside {
    depth += delta($0)
    if (depth < 0) { error = "unbalanced Experiments site block"; exit 1 }
    if (depth == 0) { printf "%s", replacement; inside = 0 }
    next
  }
  { print }
  END {
    if (error != "") { print error > "/dev/stderr"; exit 1 }
    if (inside) { print "unterminated Experiments site block" > "/dev/stderr"; exit 1 }
    if (!found) { print "Experiments site block was not found" > "/dev/stderr"; exit 1 }
  }
' "$caddyfile" > "$candidate"; then
  fail 'could not safely replace the Experiments site block; no configuration was changed'
fi

chown --reference="$caddyfile" "$candidate"
chmod --reference="$caddyfile" "$candidate"
printf 'Validating the complete candidate Caddy configuration...\n'
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
systemctl is-active --quiet caddy || fail 'Caddy is not active after reload; inspect systemctl status caddy'
printf 'Caddy updated with the Experiments headers and static-route behavior. Previous config saved as %s\n' "$backup"
