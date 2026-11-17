# Release handoff

## Candidate

The consolidated candidate is on `codex/production-ready` in `/home/charlie/experiments-release-candidate`. It descends from `renaissance/next-generation` and contains 19 works with 21 canonical URLs: the homepage, nineteen exhibit pages, and Privacy. Read the exact reviewed commit with `git rev-parse HEAD` after the final candidate commit.

The candidate retains the completed work from the combined release, computing rethink, reliability, exhibit renaissance, Invisible World, and Renaissance histories. This includes the six added works, experiment refinements and fallbacks, state sharing and local notebooks, optional editorial paths, accessibility and keyboard work, discovery/search, lifecycle handling, and their existing checks and documentation.

The Shape of Motion identity is integrated across the homepage, gallery, exhibit shell, information pages, title and social metadata, manifest, icons, and preview image. The centered title and ARMSTEEL attribution remain the focal point; “Explore the collection” now sits immediately beneath them on a softly lit glass surface. The tagline remains in the collection heading. The live homepage experiment preview and simulation implementations are retained.

## Work preserved outside the candidate

`improvement/accessible-depth` retains two local commits made during the audit: `a3477b3` (rebrand) and `c3b83e1` (pending exhibit refinements). The rebrand was integrated as `5cf14d2`. Cellular Automata, Fluid, and Reaction Diffusion changes from `c3b83e1` already exist in the candidate; its Adder output coordinates target an older board layout and were not applied. The source branch remains available for review. Other source worktrees remain in place.

No completed experiment or user feature was intentionally removed. Older duplicate working screenshots in the source checkout were removed only after confirming the exact same files exist in the release candidate. Existing Renaissance follow-up work remains documented in `docs/renaissance/BACKLOG.md`; physical GPU and phone performance, real WebGPU device-loss recovery, specialist review, and formal assistive-technology review are not claimed as verified.

## Verification and release status

The exact final candidate was verified on 2026-11-17:

- `npm run verify` passed: TypeScript build, production Vite build, all 17 automated checks, and the 19-work/21-URL site metadata check.
- `npm run qa:brand` passed across five homepage viewports, keyboard entry, reduced motion, interior navigation, metadata and mobile overflow. The centered desktop and mobile screenshots were visually reviewed in `docs/rebrand/screenshots/`.
- `npm run qa:existing` passed all 13 original exhibits at desktop and mobile sizes, with no browser or HTTP errors.
- `npm run qa:invisible-world` passed all six studies, 50 screenshots, 12 repeated route entries, desktop/mobile interactions, gallery search and navigation, with no browser or HTTP errors.
- `npm run qa:state-sharing` passed shared-state save/restore across all 19 exhibits, with no browser or HTTP errors.
- `git diff --check` passed. Browser runs were serialized and the owned Chromium, preview, temporary profiles and QA lock were cleaned after each suite.

Host assessment: the machine had 6.7–7.4 GiB available RAM during the sequence, nearly full swap with no swap-in/out after the initial `vmstat` sample, zero memory-full PSI, CPU PSI below 5%, load below 2.5 on six CPUs, and temperatures below 70°C. The original unconditional free-swap rule was too conservative for these readings. The supervisor now requires at least 30% of physical RAM or 4 GiB free (whichever is greater) whenever swap is constrained, and continues enforcing its PSI/load/temperature checks and in-run reserve. All four browser suites passed under that supervisor; no gate was bypassed and no unrelated process was stopped.

Headless Chrome used software WebGL on this host. The release checks exercise browser behavior and interactions, but do not establish physical-GPU rendering/performance, a real phone’s performance, or real-device WebGPU/device-loss behavior. These remain non-blocking device validation items in `docs/renaissance/BACKLOG.md`.

At the previous read-only public check on 2026-11-17, the site still served the Armsteel Experiments title and fifteen sitemap URLs. This verification pass did not publish or change production.

Release assessment: **GO for publication after approval**. This handoff will be committed at the head of `codex/production-ready`; get its exact SHA with `git rev-parse HEAD` before publishing.

## Publish after approval

After approval, push the final candidate branch from the release-candidate worktree, then run the following from the Ubuntu deployment host. Replace the placeholder with the final reviewed commit SHA:

From `/home/charlie/experiments-release-candidate`:

~~~sh
git push origin codex/production-ready
~~~

On the deployment host's project checkout:

~~~sh
git fetch origin codex/production-ready
git checkout --detach <reviewed-release-sha>
npm ci
npm run publish
~~~

Run as the normal deployment user. `npm run publish` runs `npm run verify`, prepares the static files, and atomically switches `/var/www/armsteel-experiments/current`; it requests `sudo` only for installing the isolated release. A Git push alone does not deploy. This candidate does not change Caddy configuration, so `sudo bash deploy/update-caddy.sh` is not required. After publication, follow the HTTP checks in `docs/DEPLOYMENT.md` for the homepage, privacy page, all nineteen exhibit routes, robots file, sitemap, and an unknown route returning 404.
