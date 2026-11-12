#!/usr/bin/env bash
set -Eeuo pipefail

fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

[[ $EUID -ne 0 ]] || fail 'run as the normal deployment user; sudo is used only for the static release copy'
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$repo_dir"

npm run build
[[ -f dist/index.html ]] || fail 'Vite build did not produce dist/index.html'
[[ -z $(find dist -type l -print -quit) ]] || fail 'dist contains a symbolic link; refusing to copy it into the public document root'
getent group caddy >/dev/null || fail 'the Caddy service group does not exist on this host'
sudo -v || fail 'sudo authentication is required to install a static release'

build_digest=$(find dist -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12)
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$build_digest"
site_root=/var/www/armsteel-experiments
release_root=$site_root/releases
release_path=$release_root/$release_id
stage_path=$release_root/.staging-$release_id-$$
next_link=$site_root/.current-$release_id-$$
marker=$site_root/.managed-by-armsteel-experiments

if sudo test -e "$site_root" || sudo test -L "$site_root"; then
  sudo test -f "$marker" || fail "$site_root already exists without the Experiments ownership marker; inspect it before publishing"
fi

if sudo test -e "$release_path" || sudo test -L "$release_path"; then
  fail "release already exists: $release_path"
fi
if sudo test -L "$site_root/current"; then
  previous=$(sudo readlink -f -- "$site_root/current") || fail 'cannot resolve the current site release'
  case "$previous" in
    "$release_root"/*) ;;
    *) fail "current points outside the Experiments release directory: $previous" ;;
  esac
elif sudo test -e "$site_root/current"; then
  fail 'current exists and is not a symbolic link; inspect it before publishing'
fi

sudo install -d -o root -g caddy -m 0750 "$site_root"
sudo install -d -o root -g caddy -m 0750 "$release_root"
if ! sudo test -f "$marker"; then
  sudo install -o root -g caddy -m 0640 /dev/null "$marker"
fi
sudo install -d -o root -g caddy -m 0750 "$stage_path"
sudo cp -a --no-preserve=ownership -- dist/. "$stage_path/"
sudo chown -R root:caddy -- "$stage_path"
sudo find "$stage_path" -type d -exec chmod 0750 {} +
sudo find "$stage_path" -type f -exec chmod 0640 {} +
sudo mv -T -- "$stage_path" "$release_path"

sudo ln -s -- "$release_path" "$next_link"
sudo mv -Tf -- "$next_link" "$site_root/current"

printf 'Published static release: %s\n' "$release_id"
printf 'Caddy document root: %s/current\n' "$site_root"
