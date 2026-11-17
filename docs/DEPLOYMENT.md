# Deployment

The Shape of Motion is published as static Vite output by the existing Caddy service on the Ubuntu host. Its document root is **/var/www/armsteel-experiments/current**; versioned files live under **/var/www/armsteel-experiments/releases/**. The site does not run a Node process after publication. A GitHub push does not deploy.

## First installation

From the project checkout on the host:

~~~sh
npm ci
npm run publish
sudo bash deploy/configure-caddy.sh
~~~

**npm run publish** runs **npm run verify**, then uses sudo only to copy **dist/** into a new immutable release and atomically switch the **current** symlink. It leaves previous releases available for rollback. The first-install script checks that the site root is owned by this project, appends the checked-in Caddy site block, validates the complete candidate configuration, makes a backup, validates the installed file, and reloads Caddy. It does not restart the service.

## Publish an approved update

~~~sh
npm ci
npm run publish
sudo bash deploy/update-caddy.sh
~~~

Publish the static files first. The existing Caddy site can continue serving them while its routing and security policy are updated. **update-caddy.sh** replaces only the **experiments.armsteel.dev** site block in **/etc/caddy/Caddyfile**; it leaves every other site block untouched. The script validates the full candidate, saves a timestamped backup, installs it atomically, validates again, and reloads Caddy. If validation or reload fails, it restores the saved configuration.

The production build generates **/**, nineteen **/exhibits/{id}** entries, **/privacy**, **/404.html**, **/robots.txt**, and **/sitemap.xml**. Each route has static metadata and page copy for direct requests and crawlers. The sitemap contains 21 canonical URLs: the homepage, nineteen works, and the privacy page. Caddy serves the built routes, avoids falling back to the homepage for unknown paths, and serves the branded 404 page with an HTTP 404 status.

The Caddy policy adds HTTPS-only transport, MIME sniffing and framing protections, a no-referrer policy, a scoped Permissions Policy, and a Content Security Policy. The policy permits same-origin scripts and connections, inline styles used by React and the exhibit controls, same-origin/blob workers, and the local data/blob images used by previews. WebGL and WebGPU shaders are created through their browser APIs; they do not require external script sources. Hashed **/assets/** files are cached as immutable for one year. HTML and generated site files use revalidation.

## Verify the published site

Run these after an approved release and Caddy update:

~~~sh
curl -fsSI https://experiments.armsteel.dev/
curl -fsSI https://experiments.armsteel.dev/privacy
curl -fsSI https://experiments.armsteel.dev/robots.txt
curl -fsSI https://experiments.armsteel.dev/sitemap.xml
for id in mandelbrot fluid boids attractors reaction lsystem gravity machine neural logic forces automata adder waves optics sound garden network lensing; do
  curl -fsSI "https://experiments.armsteel.dev/exhibits/$id"
done
curl -sSI https://experiments.armsteel.dev/not-a-real-route
~~~

Check that the sitemap and robots file return XML and plain-text content types respectively, and that the last command reports 404 while including the site’s branded not-found page. Asset names include content hashes. Confirm the HTTPS certificate and public pages in a browser after publication.

## Rollback and limits

To restore the previous static release, atomically repoint **current** to the preceding release:

~~~sh
sudo ln -s /var/www/armsteel-experiments/releases/PREVIOUS_RELEASE /var/www/armsteel-experiments/.current-rollback
sudo mv -Tf /var/www/armsteel-experiments/.current-rollback /var/www/armsteel-experiments/current
~~~

The Caddy update keeps a timestamped configuration backup beside **/etc/caddy/Caddyfile**. Restore only that backup if an approved Caddy change needs to be reverted, then validate and reload Caddy.

The existing host configuration and deployment account must be available. The publish command requires sudo for the isolated release copy; the Caddy update requires root. No DNS changes or application-service restarts are part of content publication.
