# The Shape of Motion

**A collection by ARMSTEEL**

*Where rules become worlds.*

The Shape of Motion is an open collection of interactive computational art. The identity gives the work a quiet frame and lets each live experiment remain the main event.

## Mark and assets

`public/shape-of-motion-symbol.png` is the supplied approved symbol, kept unchanged. It is the source for the compact site mark, favicon, Apple touch icon, maskable application icon, and social preview. Text remains live HTML everywhere except the raster social preview, where a rendered title is needed for sharing.

The symbol is monochromatic warm ivory with transparency. On dark surfaces it is shown directly; add the `.brand-mark--ink` class to the same mark on a light surface to render it in dark ink. The application icons place the ivory mark on the site charcoal. No alternate symbol or decorative mark is used.

The homepage header pairs the supplied mark with a compact, live HTML wordmark. The wordmark uses the editorial serif and omits the author line so the larger hero title remains primary. Interior information-page headers pair the same mark with the wordmark and a quiet `BY ARMSTEEL` line. Experiment pages put the compact lockup in the navigation dock, simplifying to a 42px symbol link on mobile.

## Type

- Editorial headings: `Bitstream Charter`, followed by native old-style serif fallbacks including Iowan Old Style, Palatino, and Georgia.
- Interface text: Inter when available, followed by the operating-system sans-serif stack.
- Technical labels: the existing system monospace stack.
- No remote font requests or additional font dependencies.

The homepage title is the primary display size. Exhibit names, section headings, and information-page headings use the same serif at smaller sizes; navigation, controls, descriptions, and metadata use the sans-serif.

## Color and interface tokens

| Token | Value | Use |
| --- | --- | --- |
| `--void` | `#090b0d` | Main page background |
| `--deep` | `#0d1113` | Recessed surfaces |
| `--panel` | `#111719` | Panels |
| `--surface` | `#171c1e` | Raised controls |
| `--text` | `#f0eee7` | Primary warm ivory text |
| `--secondary` | `#c6c7c1` | Supporting text |
| `--muted` | `#929690` | Quiet interface text |
| `--line` | `rgba(239, 237, 228, .12)` | Delicate borders |
| `--line-soft` | `rgba(239, 237, 228, .07)` | Section dividers |

Spacing uses a 4px base (`--space-1` through `--space-16`). Control, panel, and pill radii use `--radius-control`, `--radius-panel`, and `--radius-pill`. Floating surfaces use `--shadow-float`; transitions share `--motion-fast`, `--motion-base`, `--motion-slow`, and `--ease-graceful`.

The existing responsive layouts remain in place. The branded entrance adds a 720px mobile layout and a 380px compact-phone adjustment. Information-page navigation remains visible on narrow screens, and the experiment dock simplifies its home lockup to a symbol link on mobile. The collection keeps its existing tablet and gallery breakpoints.

## Homepage entrance and motion

The two-line title is centered in the viewport in the large editorial serif, with the live attractor preview continuing to move behind it. It fades into view over 1.4 seconds after the ambient field has started. “A collection by ARMSTEEL” settles beneath the title as a centered, secondary line. A glass-like “Explore the collection” button follows directly below the attribution; a softly lit edge, translucent layered surface, and 18px backdrop blur give it enough presence to invite entry without competing with the title. The tagline is omitted from the hero and appears below “Choose a world.” in the collection heading.

The header collection link and the collection below the entrance are usable immediately; the staged text is never a loading or splash screen. The title remains centered at desktop, tablet, and mobile widths; the logo lockup, byline, and collection link retain comfortable spacing at narrow widths. Under `prefers-reduced-motion: reduce`, the title and byline render without entrance animations, and page scrolling is immediate. The collection link has a generous target, visible keyboard focus, and a restrained arrow response.

## Page and sharing metadata

The homepage, exhibit routes, privacy page, not-found state, manifest, favicon, and Open Graph preview use The Shape of Motion consistently. Canonical URLs remain on the existing host. The privacy page continues to describe the actual browser storage and hosting behavior.

## Rendered verification

Run `npm run qa:brand` after `npm run verify` to capture the final homepage in the production preview at 1440×900, 1024×768, 844×390, 390×844, and 320×740. The suite checks title and attribution centering, CTA placement, minimum target size, keyboard focus and activation, the interior wordmark, metadata, reduced motion, the live preview canvas, and mobile overflow. It refreshes the screenshots and writes `rebrand/screenshots/homepage-brand-checks.json`.

The homepage images currently stored under `rebrand/screenshots/` predate the final glass entry treatment and are retained as historical review material. They are not evidence of the final composition. The 2026-11-17 integration pass did not run the production build or browser checks because the project's host resource supervisor refused admission; see [the release handoff](RELEASE-HANDOFF.md). Refresh and inspect the final screenshots before publication.
