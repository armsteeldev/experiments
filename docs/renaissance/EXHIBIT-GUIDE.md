# Exhibit integration guide

This guide records the current contracts for adding or changing an exhibit. Keep each exhibit specific to its subject; the shared shell provides navigation, panels, URL state transport, and error recovery without requiring one universal simulation engine.

## Collection registration

1. Add the exhibit's stable lowercase route ID and visitor-facing metadata to `src/data/experiments.json`. The ID is also used by routes, saves, recommendations, previews, and test selection, so do not rename it casually. Keep concepts normalized and curate `related` IDs that exist in this file.
2. Add a matching lazy component entry to `src/registry.ts`. The key must exactly match the metadata ID. The registry is the join between static metadata and the exhibit module; avoid importing exhibit implementations eagerly.
3. Add a subject-specific preview palette and drawing mode in `src/components/ArtworkPreview.tsx`. Keep previews lightweight and let its visibility, reduced-motion, and gallery cleanup logic govern animation; do not mount the full simulation as a card preview.
4. Add representative metadata and interaction coverage to the relevant site and browser checks. `scripts/check-site-pages.mjs` verifies the collection count, unique IDs/numbers, safe route IDs, metadata, related links, lazy registration, and generated static SEO pages.

## Component and shared shell

An exhibit component accepts `ExperimentControls` from `src/types.ts`:

- `paused` includes the museum's pause state and hidden-document state. Stop simulation advancement when it is true; keep explicitly requested user actions responsive where appropriate.
- `controlsVisible` controls the exhibit's `ControlPanel`; `onCloseControls` closes the shared panel.
- `stateFromUrl` is untrusted decoded input. Validate each field at the exhibit boundary, with bounded numbers, known choices, and safe defaults before it reaches a simulation.
- `onShareState` sends only a compact, meaningful settings record to the shell. Do not include large live buffers or imply that an unreplayable history can be recreated. Record replay limits in `docs/renaissance/STATE-REPLAY.md` and scientific limits in `docs/renaissance/SCIENCE.md`.

The shell lazy-loads the component inside `ExperimentBoundary` and `Suspense`. Keep failures local to the exhibit and provide a useful in-exhibit fallback when a renderer or worker cannot start. Do not make an exhibit depend on another exhibit's runtime state.

## Interaction and accessibility

- Give the first useful action a visible affordance and immediate feedback. Preserve deeper controls without making them a prerequisite for beginning.
- Use shared `ControlPanel`, `RangeControl`, and `SelectControl` where their behavior fits. Give custom controls clear names, selected states, keyboard behavior, and touch targets. A canvas interaction that matters should have a practical keyboard path or an equivalent DOM control.
- Respect `paused`, `prefers-reduced-motion`, viewport changes, and touch input. Keep key handlers scoped and do not consume shared navigation shortcuts unintentionally.
- Announce meaningful state changes through an existing live region or a concise status element. Do not expose decorative canvas output as a misleading textual result.

## Rendering and cleanup

Own animation frames, observers, listeners, workers, audio nodes, and graphics resources in the effect or lifecycle that creates them. Every setup must have matching cleanup: cancel frames and pending work, disconnect observers, remove listeners, terminate workers, close audio contexts opened by the exhibit, and delete GPU resources. Guard asynchronous results with cancellation or generation checks so an old task cannot update a newly mounted route.

Suspend expensive work while paused or hidden where the model allows it. Keep fidelity changes explicit; a visual quality fallback must not silently alter the scientific model. Handle resize and context/worker failure without taking down the rest of the museum.

## State, tests, and review

Use the shared bounded state transport in `src/lib/storage.ts`; it versions new URLs, accepts safe legacy records, and enforces size and JSON limits. Exhibit-specific deserialization still owns field-level validation. Local notebook saves use the same settings-only principle and validated exhibit allow-list. URLs and notebook exports are readable by anyone who receives them; never put private data in either.

Add focused simulation tests for numerical invariants, bounds, deterministic seeds, reset behavior, and malformed inputs where relevant. Add browser assertions for a real visible state change, recovery/reset, and route exit when the exhibit introduces a substantial interaction or resource. Existing browser scripts must be invoked via `npm run qa:<name>` so the supervisor applies its exclusive lock, host-pressure checks, timeouts, and owned-process cleanup. Do not run browser QA when that preflight fails. Run the appropriate site/build/numerical checks only when the host is healthy enough for their load.

Before integration, check that the ID appears in metadata and the lazy registry, that the preview represents the exhibit, that shared state restores safely, that keyboard/touch paths are usable, and that all created resources have a bounded lifetime. Keep the collection at nineteen only when that is the intended product count; update the site checks deliberately if the collection itself changes.
