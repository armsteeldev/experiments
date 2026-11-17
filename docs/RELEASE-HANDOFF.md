# Release handoff

## Candidate

The consolidated candidate is on `codex/production-ready` in `/home/charlie/experiments-release-candidate`. It descends from `renaissance/next-generation` and contains 19 works with 21 canonical URLs: the homepage, nineteen exhibit pages, and Privacy. Read the exact reviewed commit with `git rev-parse HEAD` after the final candidate commit.

The candidate retains the completed work from the combined release, computing rethink, reliability, exhibit renaissance, Invisible World, and Renaissance histories. This includes the six added works, experiment refinements and fallbacks, state sharing and local notebooks, optional editorial paths, accessibility and keyboard work, discovery/search, lifecycle handling, and their existing checks and documentation.

The Shape of Motion identity is integrated across the homepage, gallery, exhibit shell, information pages, title and social metadata, manifest, icons, and preview image. The centered title and ARMSTEEL attribution remain the focal point; “Explore the collection” now sits immediately beneath them on a softly lit glass surface. The tagline remains in the collection heading. The live homepage experiment preview and simulation implementations are retained.

## Work preserved outside the candidate

`improvement/accessible-depth` retains two local commits made during the audit: `a3477b3` (rebrand) and `c3b83e1` (pending exhibit refinements). The rebrand was integrated as `5cf14d2`. Cellular Automata, Fluid, and Reaction Diffusion changes from `c3b83e1` already exist in the candidate; its Adder output coordinates target an older board layout and were not applied. The source branch remains available for review. Other source worktrees remain in place.

No completed experiment or user feature was intentionally removed. Older duplicate working screenshots in the source checkout were removed only after confirming the exact same files exist in the release candidate. Existing Renaissance follow-up work remains documented in `docs/renaissance/BACKLOG.md`; physical GPU and phone performance, real WebGPU device-loss recovery, specialist review, and formal assistive-technology review are not claimed as verified.

## Verification and release status

The existing Renaissance branch records a passing `npm run verify` and sequential browser suites from 2026-11-16. Those results cover the 19-work branch before this rebrand and final CTA adjustment, so they do not verify this exact candidate.

For this integration pass, `git diff --check` and JavaScript syntax checks passed. The current host QA supervisor has refused new build and browser runs while available swap remains below its ~410 MiB admission threshold. No bypass was used. Before publishing, wait for the resource gate to pass and run:

~~~sh
npm run verify
npm run qa:brand
npm run qa:existing
npm run qa:invisible-world
npm run qa:state-sharing
~~~

`qa:brand` also refreshes the desktop, tablet, phone, narrow-phone, and landscape screenshots in `docs/rebrand/screenshots/`. Review those screenshots and the generated `homepage-brand-checks.json` before approving publication. If the supervisor refuses a run, stop and wait for recovery; do not bypass the guard.

The public site was checked read-only on 2026-11-17 and still serves the previous Armsteel Experiments title and fifteen sitemap URLs. The candidate has not been pushed, deployed, or published.

## Publish after approval

The repository checkout on the Ubuntu deployment host must first receive the reviewed candidate commit. After the approved branch has been pushed, run the following from that host's project checkout, replacing the placeholder with the full reviewed commit SHA:

~~~sh
git fetch origin codex/production-ready
git checkout --detach <reviewed-release-sha>
npm ci
npm run publish
~~~

Run as the normal deployment user. `npm run publish` runs `npm run verify`, prepares the static files, and atomically switches `/var/www/armsteel-experiments/current`; it requests `sudo` only for installing the isolated release. A Git push alone does not deploy. This candidate does not change Caddy configuration, so `sudo bash deploy/update-caddy.sh` is not required. After publication, follow the HTTP checks in `docs/DEPLOYMENT.md` for the homepage, privacy page, all nineteen exhibit routes, robots file, sitemap, and an unknown route returning 404.
