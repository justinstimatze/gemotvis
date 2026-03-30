# gemotvis

MAGI-inspired real-time visualization dashboard for [gemot](https://gemot.dev) deliberation sessions.

## Quick Start

```bash
gemotvis                                   # Demo mode, no setup
gemotvis demo --cycle 5s                   # Fast cycling demo
gemotvis demo --cycle 0                    # Manual tab switching
gemotvis watch --api-key KEY               # Live monitor (localhost:8080)
gemotvis replay delib.json                 # Display saved snapshot
gemotvis export --api-key K --deliberation ID > out.json
```

Add `?multi=true` to see all deliberations simultaneously with activity-driven zoom.
Add `?theme=classic` or `?theme=minimal` to switch visual themes.

Open `http://localhost:9090`.

## Architecture

```
main.go                          Subcommand dispatch (demo/watch/replay/export)
internal/
  gemot/
    client.go                    A2A JSON-RPC client (list_deliberations, list_by_group,
                                 list_by_agent, get_deliberation, get_positions, get_votes,
                                 get_analysis_result, get_audit_log)
    types.go                     Mirrored types (no gemot import dependency)
  hub/hub.go                     SSE fan-out to browser clients
  poller/poller.go               Polls gemot, detects changes via SHA-256 hash, caches snapshots
  server/
    server.go                    HTTP server, SSE, routes (New/NewDemo/NewReplay), security headers
    watch.go                     Join code watching — per-session pollers via gemot /join/ endpoint
    dashboard.go                 Agent dashboard — encrypted sessions (AES-GCM), proxied polling
    demo.go                      Built-in sample data (5 scenarios from real gemot scripts)
    static/                      Frontend (vanilla JS + CSS, //go:embed)
      index.html                 App shell with boot sequence + HUD elements
      css/base.css               Neutral structure + classic palette defaults (design tokens, layout, components)
      css/themes.css             Theme-specific effects (MAGI CRT, classic manuscript, minimal clean)
      css/layout.css             Adaptive layouts (bilateral/triangle/polygon/positioned/grid)
      js/app.js                  SSE, state, rendering, multi-view, auto-cycle, demo loop (1200+ lines)
```

## Modes

| Mode | Data Source | Use Case |
|------|-----------|----------|
| `demo` | Built-in samples | Try it, ambient display, conference demo |
| `watch` | Live gemot A2A | Real-time monitoring on second monitor |
| `replay` | JSON file or URL | Review past deliberations, share with others |
| `export` | Live gemot A2A | Save a deliberation for later replay/sharing |

### Hosted Modes (vis.gemot.dev)

| Path | Description |
|------|-------------|
| `/` | Demo with auto-cycling |
| `/?multi=true` | Multi-deliberation spatial viewport with zoom |
| `/watch/<code>` | Live watching via gemot join code |
| `/watch/<code>?also=code2,code3` | Multi-deliberation watching |
| `/dashboard` | Login with API key, see all your deliberations |

## Data Flow

```
gemot /a2a  <--poll--  Poller  --on change-->  Hub  --SSE-->  Browser
gemot /events --SSE push-->  Poller (triggers immediate re-fetch)

For hosted watch: join code → /join/ lookup → per-session Poller → SSE
For dashboard:    API key → encrypted session → per-user Poller → SSE
For multi-view:   multiple SSE streams merged → spatial canvas → CSS zoom
```

When `EnableSSE()` is called on a Poller, it connects to gemot's `/events` SSE endpoint and triggers an immediate state re-fetch on each relevant event (position_submitted, vote_cast, analysis_*). Timer-based polling continues as fallback.

## Timeline Scrubber

The scrubber bar (above the footer) lets users step through audit log events chronologically. Each event is a colored dot (cyan=position, green=vote, gold=analysis). Controls: click dot, arrow keys, Space play/pause, LIVE button.

The scrubber filters `DelibState` client-side via `filterToTime()`: positions/votes filtered by `created_at`, agents derived from visible positions, analysis shown only after analyze event. Existing render functions are unchanged — the filter runs before passing data to them.

## Key Design Decisions

- **Go + vanilla JS, no build step**: Single binary via `//go:embed`
- **SSE not WebSocket**: Read-only monitor
- **Subcommands**: `demo`/`watch`/`replay`/`export` — each mode is discoverable
- **No args = demo**: Zero-friction entry point
- **Snapshot format = `/api/state` JSON**: Export and replay use the same format
- **Auto-cycle**: Demo mode rotates scenarios; multi-view pans between deliberations
- **Join codes as auth**: For hosted watching, users share a join code, not an API key
- **Session encryption**: Dashboard API keys encrypted with AES-GCM at rest

## Conventions

- All DOM rendering uses safe methods (createElement, textContent). No innerHTML.
- CSS custom properties in `:root` for theming. Colors: `--vis-*`. Theme overrides via `#screen.theme-*` in `themes.css`.
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) on all responses.
- Max 50 concurrent SSE clients, 20 watch sessions, 100 dashboard sessions.
- `atomic.Int64` for shared session timestamps (race-free).
- Agents sorted by ID for deterministic ordering.
- Hub channels closed under write lock to prevent send-on-closed panics.

## Adaptive Layouts

| Agent Count | Layout | CSS Class |
|---|---|---|
| 2 | Bilateral (side-by-side) | `layout-bilateral` |
| 3 | MAGI triangle | `layout-triangle` |
| 4-7 | Regular polygon | `layout-polygon` |
| 8+ | Flex grid | `layout-grid` |
| Any with x,y coords | Geographic positions | `layout-positioned` |

## Themes

Select via `?theme=` query param. Same HTML and JS for all themes — only CSS changes.

| Theme | Class | Agent Shape | Description |
|---|---|---|---|
| Classic (default) | `theme-classic` | Shield (clip-path) | Parchment, blackletter, vermillion rubrication, cartographic terrain, manuscript borders |
| MAGI | `theme-magi` | Diamond (45deg) | CRT scanlines, amber-on-black, kanji votes, tactical grid, boot sequence |
| Minimal | `theme-minimal` | Circle | White background, system sans-serif, pill badges, rounded corners |

Architecture: `base.css` defines `--vis-*` variables with classic palette defaults and neutral structural styles. `themes.css` adds theme-specific effects — MAGI adds CRT effects/glow, classic adds manuscript decorations (terrain, compass rose, shields), minimal overrides to a clean modern look. Fonts loaded dynamically in `app.js` per theme.

## Multi-View

When `?multi=true` or watching multiple codes, all deliberations render simultaneously in a spatial canvas. CSS `transform: scale() translate()` provides smooth camera zoom/pan:
- Demo loop cycles: overview → zoom delib 1 → overview → zoom delib 2 → ...
- Live events trigger auto-zoom to the active deliberation
- Manual click pauses for 60s, then resumes

## Deployment

```bash
docker build -t gemotvis . && docker run -p 9090:9090 gemotvis
fly deploy
fly secrets set GEMOTVIS_SERVICE_KEY=xxx GEMOTVIS_GEMOT_URL=https://gemot.dev
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GEMOTVIS_GEMOT_URL` | `http://localhost:8080` | gemot instance URL |
| `GEMOTVIS_API_KEY` | | gemot API key (for watch/export) |
| `GEMOTVIS_SERVICE_KEY` | | gemot service key (for hosted watch + dashboard) |
| `GEMOTVIS_ADDR` | `:9090` | Listen address |
| `GEMOTVIS_POLL_INTERVAL` | `10s` | Polling interval |
| `GEMOTVIS_DELIBERATION_ID` | | Watch specific deliberation |

## A2A Client Methods

The `gemot.Client` supports these JSON-RPC methods:

| Method | Client Function | Description |
|---|---|---|
| `gemot/list_deliberations` | `ListDeliberations()` | All visible deliberations |
| `gemot/list_by_group` | `ListByGroup(groupID)` | Deliberations in a group |
| `gemot/list_by_agent` | `ListByAgent(agentID)` | Deliberations an agent participates in |
| `gemot/get_deliberation` | `GetDeliberation(id)` | Single deliberation status |
| `gemot/get_positions` | `GetPositions(id)` | All positions |
| `gemot/get_votes` | `GetVotes(id)` | All votes |
| `gemot/get_analysis_result` | `GetAnalysisResult(id)` | Latest analysis (cruxes, clusters, consensus) |
| `gemot/get_audit_log` | `GetAuditLog(id)` | Operation log |
