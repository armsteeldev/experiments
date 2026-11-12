# Deployment

Armsteel Experiments is served as static Vite output by the existing Caddy instance on the Ubuntu host. It has its own HTTPS virtual host and document root at `/var/www/armsteel-experiments`; it does not share TOWP, Echo Archives, or another site's files or process. No Node or Vite server runs after publication.

## Existing server and DNS

The host uses the system Caddy service and `/etc/caddy/Caddyfile`. TOWP is a separate `open.armsteel.dev` site, served from its own release tree; this deployment adds one independent site block and reloads only Caddy. It does not restart application services.

The authoritative DNS servers for `armsteel.dev` are Name.com. The existing `experiments.armsteel.dev` CNAME points to `mpmc.ddns.net`, which resolves to the same public server as `open.armsteel.dev`. A random sibling hostname returned NXDOMAIN, so there is no wildcard record. The requested DNS record is already present; no DNS mutation is needed. The apex domain and its existing hosting records are untouched.

## First deployment

Run these from this checkout on the Ubuntu host:

```sh
npm ci
npm run publish
sudo bash deploy/configure-caddy.sh
```

`publish` runs the TypeScript and Vite production build as the normal user, then uses `sudo` only to copy the generated `dist/` tree into a new versioned release under `/var/www/armsteel-experiments/releases/`. It makes an atomic `current` symlink switch. Release files are owned by `root:caddy`, readable by Caddy, and separate from the source checkout. Previous releases are kept for rollback.

`configure-caddy.sh` appends the checked-in site block to the existing Caddyfile only after validating the complete candidate config. It makes a timestamped backup, atomically installs the candidate, validates the installed file, and reloads Caddy (no service restart). Caddy obtains and renews HTTPS certificates automatically for the new hostname. If validation or reload fails, the script restores the saved Caddyfile.

The Caddy route serves `/assets/*` directly and falls back to `/index.html` for other paths. That fallback lets React Router handle `/exhibits/:id` when a visitor opens or refreshes a study URL. Hashed Vite assets receive immutable caching.

## Verify the public site

After the first Caddy reload, check the gallery, direct exhibit routes, and a generated asset over public HTTPS:

```sh
curl -fsSI https://experiments.armsteel.dev/
for id in mandelbrot fluid boids attractors reaction lsystem; do
  curl -fsSI "https://experiments.armsteel.dev/exhibits/$id"
done
grep -oE '/assets/[^" ]+' dist/index.html | while IFS= read -r asset; do
  curl -fsSI "https://experiments.armsteel.dev${asset}"
done
```

The asset filename includes a content hash and changes with a new build. A failed certificate request can be diagnosed with `sudo journalctl -u caddy -n 100 --no-pager`; confirm the CNAME still resolves to this server and that inbound ports 80/443 reach Caddy.

## Publish an update

After changing the source, run:

```sh
npm run publish
```

This rebuilds and publishes an immutable static release. Caddy configuration and other services do not need to be reloaded for content-only updates. Keep the preceding release until the public site is verified. To roll back, atomically repoint `current` to the previous release, for example:

```sh
sudo ln -s /var/www/armsteel-experiments/releases/PREVIOUS_RELEASE /var/www/armsteel-experiments/.current-rollback
sudo mv -Tf /var/www/armsteel-experiments/.current-rollback /var/www/armsteel-experiments/current
```
