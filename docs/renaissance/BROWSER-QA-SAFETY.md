# Browser QA resource incident

**Recorded:** 2026-11-16
**Scope:** local browser QA in the renaissance/next-generation worktree. No production service, source branch, or unrelated project was changed.

## Findings

The browser QA scripts connect to an already running Chromium through CDP. They do not launch Chromium themselves, and their normal completion path closes a WebSocket, not the browser. That disconnect leaves the browser process, page, animation frames, and any page-owned work alive.

The scripts used separate hard-coded CDP ports and browser profiles. No shared lock serialized them, and their 30-second CDP request timeouts did not bound the whole script or browser lifetime. At incident inspection, eleven old browser roots each had a separate session/process group and a /tmp/armsteel-renaissance-* profile. Their parent was the user systemd process, not a live QA script or terminal. This is direct evidence that those browser trees had outlived their launch sessions. The roots included processes that had been alive for more than a day.

The inspected browser command lines included --use-angle=swiftshader-webgl. The reported Chromium “GPU process” was therefore doing software-rendering work; it was not evidence of hardware GPU execution. Active canvas/WebGL pages continued to animate and consumed CPU after their test clients were gone. Representative pre-cleanup process samples were:

| PID | Process | Elapsed | CPU time | RSS |
| ---: | --- | --- | --- | ---: |
| 631534 | Chromium GPU process, lifecycle-run2 | 37m 42s | 15m 16s | 75 MiB |
| 3179375 | Renderer, resource-baseline | 1d 6h 28m | 10h 52m | 128 MiB |
| 3251054 | Chromium GPU process, overlays | 1d 5h 27m | 7h 30m | 102 MiB |
| 3190734 | Renderer, journeys | 1d 6h 16m | 7h 39m | 143 MiB |
| 3221394 | Renderer, state-sharing | 1d 5h 45m | 5h 08m | 174 MiB |
| 510519 | Renderer, notebook | 1h 52m | 16m 32s | 164 MiB |
| 610186 | Renderer, lifecycle-final | 50m | 4m 55s | 204 MiB |

No browser QA Node process or retry loop was active when I checked. The locally owned Vite preview on port 5198 was stopped during cleanup. The QA scripts inspected did not spawn browser or worker subprocesses. Multiple browser runs could coexist because there was no lock, but the available process evidence does not establish that two test scripts were executing concurrently when the load peaked.

Kernel journal evidence for 2026-11-16 records global OOM kills of three ChatGPT processes at 19:50, 20:11, and 20:14 local time. It also records a separate memory-cgroup OOM kill of a Python process in midas-reality-research.service at 03:59. The journal does not attribute a specific share of the global memory pressure to Chromium. The MIDAS process was left alone.

## Cleanup performed

The following abandoned Chromium roots were closed through their own CDP Browser.close endpoint. No Chromium process was indiscriminately killed.

| Root PID | Temporary profile | CDP endpoint |
| ---: | --- | ---: |
| 3167382 | armsteel-renaissance-baseline | 9345 |
| 3179178 | armsteel-renaissance-resource-baseline | 9346 |
| 3190520 | armsteel-renaissance-journeys | 9347 |
| 3210822 | armsteel-renaissance-notebook | 9350 |
| 3221194 | armsteel-renaissance-state-sharing | 9351 |
| 605423 | armsteel-renaissance-lifecycle | 9351 |
| 609988 | armsteel-renaissance-lifecycle-final | 9352 |
| 3250899 | armsteel-renaissance-overlays | 9362 |
| 3580032 | armsteel-renaissance-hidden-qa | 9363 |
| 629899 | armsteel-renaissance-lifecycle-9363 | 9363 |
| 631352 | armsteel-renaissance-lifecycle-run2 | 9473 |

Six additional recent fluid-entry browser roots were closed at CDP ports 9497, 9498, 9502, 9503, 9504, and 9505. Their root PIDs and full profile suffixes were not retained in the incident handoff, so they are not guessed here. The locally owned Vite preview on port 5198 was stopped with Ctrl-C. The temporary Chromium profile directories and prior evidence files were retained; no project files, reports, or logs were deleted.

The user’s other Chrome/Chromium and Firefox sessions, ChatGPT/Codex, MIDAS, RustDesk, and other services were left running.

## QA safeguards added

All qa:* package commands now use scripts/run-browser-qa.mjs, and each individual QA script rejects direct execution outside that supervisor. The runner:

- allows one browser QA session per user at a time, identifies its lock owner by PID/start time, and fails closed on a stale or incomplete lock until processes are inspected;
- checks RAM, free swap, system load, CPU pressure and CPU temperature before starting, then checks pressure every 15 seconds through preview/browser startup and the test run;
- refuses to build implicitly and requires an existing dist/index.html;
- starts one loopback-only Vite preview and one isolated Chromium profile on dynamically assigned ports, with CDP bound to IPv4 loopback;
- does not pass SwiftShader or --disable-gpu flags;
- applies 20-second startup bounds, an eight-minute default test limit and a ten-minute hard maximum, with no automatic retries;
- tags each owned role (preview, Chromium and QA script) with a unique per-run environment token inherited by its subprocesses. Cleanup scans `/proc` in bounded batches for processes carrying that exact token, confirms each PID's start time before signaling, and repeats the check after graceful CDP close so reparented Chromium or script subprocesses cannot be missed. It applies SIGTERM then bounded SIGKILL escalation; if tagged processes remain, it retains the lock and profile to prevent a second run.

The preview and browser are ordinary foreground children of the runner; none are detached. The owner token is local process metadata only and is not logged or sent to a service. Test output continues to use the existing paths and is not removed by cleanup.

Run npm run build only when the machine is healthy, then invoke an individual npm run qa:<name>. QA now fails closed when the host has less than 20% or 2 GiB available RAM (whichever is greater), less than 10% or 64 MiB free swap (capped at 512 MiB), sustained CPU pressure over 25%, one-minute load over 1.5 per logical CPU (minimum threshold 4), or CPU temperature at/above 85°C.

## Health after cleanup

At 20:21 local time the one-minute load was 28.80, available RAM was about 2.5 GiB, swap had only 52 KiB free, and CPU temperature reached 100°C. At 20:31 the readings were load 0.89, 8.31, 21.48, 5.6 GiB available RAM, 4,284,841,984 of 4,294,963,200 swap bytes used, and CPU package/core temperatures of 59–63°C. CPU PSI still reported 38.4% some avg10 at that sample.

At 20:46, load was 1.62, 1.95, 8.87; available RAM was 5.9 GiB; swap had 9.8 MiB free; CPU package temperature was 66°C and cores were 53–66°C. CPU PSI avg10 was still 40.21%; memory PSI was zero.

The immediate CPU temperature, RAM availability, and one-minute load improved materially. Swap remained effectively full and CPU pressure was still elevated, so the host was **not yet considered fully recovered**. The QA supervisor consequently refuses to start while the current swap or pressure condition persists.

## Verification limits

No browser, build, benchmark, or test suite was launched after the incident request. The runner and configuration received only lightweight syntax/consistency checks. Hardware rendering behavior, test runtime, and shutdown behavior remain unverified by a new browser run; this was intentional while the host was under investigation.
