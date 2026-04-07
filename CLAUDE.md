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
gemotvis export --api-key K --group GROUP_ID > out.json
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
    static/                      Build output from frontend/ (//go:embed, gitignored)
frontend/                        React + TypeScript frontend (Vite build)
  src/
    App.tsx                      Router + theme provider + layout shell
    types.ts                     TypeScript mirrors of Go types
    stores/                      Zustand state (session, scrubber, graph, theme)
    hooks/                       useSSE, useAnimationPhase, useFilteredState, useScrubberPlayback,
                                 useGraphData, useKeyboardShortcuts, useURLSync
    lib/                         Pure logic: filterToTime, buildGraph, layout, votes, color, helpers
    components/
      graph/                     React Flow: GraphCanvas, AgentNode, DelibEdge, CenterPanel
      chat/                      ChatThread, ChatBubble, TypeReveal, AnalysisSection
      scrubber/                  ScrubberBar with timeline dots
      panels/                    Footer (CruxPanel, MetricsPanel, AuditLog)
    styles/                      CSS: base.css, themes.css, layout.css, reactflow.css
```

## Modes

| Mode | Data Source | Use Case |
|------|-----------|----------|
| `demo` | JSON replay files from `testdata/` | Try it, ambient display, conference demo |
| `watch` | Live gemot A2A | Real-time monitoring on second monitor |
| `replay` | JSON file or URL | Review past deliberations, share with others |
| `export` | Live gemot A2A | Save a deliberation or group for later replay |

### Demo Data

Demo mode loads JSON replay files from `testdata/` (and `/data/` in Docker). No hardcoded data — all demos are exported from real gemot runs.

**Adding new demos:**
```bash
# Export a single deliberation
gemotvis export --api-key $KEY --deliberation <id> > testdata/my-demo.json

# Export all deliberations in a group
gemotvis export --api-key $KEY --group <group-id> > testdata/my-group.json
```

Files are auto-loaded on startup. Dataset name = filename minus `.json`. Select via `?data=<name>` URL param. The delib picker nav in the scrubber shows all deliberations within the active dataset.

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

The scrubber bar lets users step through events chronologically. In single-view, it shows one deliberation's events. In multi-view, it shows a **global timeline** across ALL deliberations — events sorted chronologically with `delibID` tags. Pinned to viewport bottom via `position: fixed` in multi-view.

Controls: play/pause, 1x/2x/4x speed, event type filter (ALL/POSITION/VOTE/ANALYSIS), arrow keys, click dot, click track, LIVE/LATEST button. Marker opacity varies by event density (heatmap).

When scrubbing in multi-view, the focused deliberation renders as a **full single-view** (identical quality to standalone mode), not a scaled mini-view. `filterToTime()` applied to the focused deliberation's data.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play/pause |
| Arrow Right/Left | Step forward/back one event |
| S | Skip to next deliberation |
| Shift+1-9 | Jump to nth deliberation (pauses playback) |
| Tab / Shift+Tab | Cycle through agents (focuses bilateral in multi-delib) |
| / | Open chat search |
| F | Cycle event type filter |
| 1-4 | Set speed (1x/2x/3x/5x) |

## Graph Interactions

- **Click edge**: Focus that bilateral conversation, pause autoplay, jump scrubber
- **Click node (multi-delib)**: Cycle through that agent's bilateral conversations
- **Click node (single-delib)**: Highlight that agent's messages in chat, scroll to latest
- **Hover node**: Show tooltip with stats (messages, votes, cluster, bridging score), highlight connected edges
- **Search (/)**: Filter chat messages by keyword, matching messages highlighted, others dimmed

## Analysis Visualization

- **Cluster coloring**: Colored ring on nodes when analysis assigns opinion clusters
- **Vote badges**: Checkmark (agree), cross (disagree), dash (neutral) on nodes
- **Crux badges**: Red count on edges where connected agents disagree on cruxes
- **Bridging indicator**: Compass rose on nodes with bridging score >= 60%
- **Consensus glow**: Green glow on edges with >70% agreement

## URL State

Shareable links via URL params. Updated on user-initiated actions (click/keyboard), not autoplay.

| Param | Description |
|-------|-------------|
| `?theme=` | Theme (minimal, magi, gastown) |
| `?data=` | Dataset name (demo, diplomacy, code-review) |
| `?edge=` | Active deliberation ID |
| `?t=` | Scrubber event index |
| `?demo=1` | Enable demo mode |
| `?also=` | Additional watch codes (comma-separated) |

## Landing Page

`vis.gemot.dev/` shows a themed overlay with: theme dropdown selector, "Start Demo" button, watch code input, dashboard link. Auto-dismissed when navigating to `?demo=1`.

## Key Design Decisions

- **React + TypeScript + Vite**: Frontend built to `internal/server/static/`, embedded via `//go:embed`
- **SSE not WebSocket**: Read-only monitor
- **Subcommands**: `demo`/`watch`/`replay`/`export` — each mode is discoverable
- **No args = demo**: Zero-friction entry point
- **Snapshot format = `/api/state` JSON**: Export and replay use the same format
- **Auto-cycle**: Demo mode rotates scenarios; multi-view pans between deliberations
- **Join codes as auth**: For hosted watching, users share a join code, not an API key
- **Session encryption**: Dashboard API keys encrypted with AES-GCM at rest

## Conventions

- Frontend is React + TypeScript + React Flow + Zustand. Build with `cd frontend && npm run build`.
- All DOM rendering via React components. No innerHTML or direct DOM manipulation.
- CSS custom properties in `:root` for theming. Colors: `--vis-*`. Theme overrides via `.theme-*` selectors (on body for portal inheritance).
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) on all responses.
- Max 50 concurrent SSE clients, 20 watch sessions, 100 dashboard sessions.
- `atomic.Int64` for shared session timestamps (race-free).
- Agents sorted by ID for deterministic ordering.
- Hub channels closed under write lock to prevent send-on-closed panics.

## MANDATORY: Before Adding Derived State

Before computing agent lists, colors, layout decisions, or any state derived from deliberation data:
1. **Grep first**: search for the pattern in `lib/`, `hooks/`, `components/` — a helper likely exists
2. **Single source of truth**: agent colors come from `agentColor(graphNodes.indexOf(id), graphNodes.length, theme)` where `graphNodes` is stored in the graph store. Never recompute agent ordering independently.
3. **Shared helpers exist for**: `isSingleDelibGraph()`, `countBilaterals()`, `collectAgentsWithCoords()`, `getPositionCount()`, `findInDelibs()`, `useFocusedDelib()`, `classNames()`

## MANDATORY: Visual QA After Changes

After any visual change, run `node test_visual_qa.js` which tests:
- Color consistency between graph nodes and chat bubbles across all 3 layout modes
- Footer panels visible and not clipped
- Side panel not overlapping bottom bar
- Graph fitting within viewport (no overflow)

Manual verification: load `?demo=1&data=showcase&theme=minimal` and `?demo=1&data=diplomacy&theme=minimal`, advance scrubber, and visually confirm colors match between node rings and chat bubble borders.

## Adaptive Layouts

Layout computed in `lib/layout.ts`, positions passed to React Flow nodes.

| Agent Count | Layout |
|---|---|
| 2 | Bilateral (side-by-side) |
| 3-7 | Regular polygon |
| 8+ | Force-directed (d3-force) |
| Multiple bilaterals | Full network graph with focused bilateral |
| Any with lat/lon | Geographic projection with world map |
| Any with x,y coords | Explicit positioned layout |

## Themes

Select via `?theme=` query param. Same HTML and JS for all themes — only CSS changes.

| Theme | Class | Agent Shape | Description |
|---|---|---|---|
| Classic (default) | `theme-classic` | Shield (clip-path) | Parchment, blackletter, vermillion rubrication, cartographic terrain, manuscript borders |
| MAGI | `theme-magi` | Diamond (45deg) | CRT scanlines, amber-on-black, kanji votes, tactical grid, boot sequence |
| Minimal | `theme-minimal` | Circle | Clean #fafafa, system sans-serif, pill badges, Linear/Vercel-inspired |
| Gastown | `theme-gastown` | Diamond | Warm parchment, dark brown bars, brass accents, Cinzel type, industrial pipes |

Architecture: `base.css` defines `--vis-*` variables with classic palette defaults and neutral structural styles. `themes.css` overrides variables per theme using `.theme-*` selectors. `reactflow.css` contains all component styles including theme-specific overrides for nodes, edges, panels, and scrubber. Theme class set on `document.body` so portaled elements (scrubber, footer, chat panels) inherit variables.

## Multi-View

When multiple bilateral deliberations exist (e.g. diplomacy dataset with 22 bilaterals), all agents render as a full network graph with edges per bilateral. Click/hover edges or nodes to explore. Side panel (380px, docked right) shows chat for the focused bilateral.

For 2-4 agent single deliberations, center panel overlay shows the chat conversation.

## Responsive Layout

- **> 900px**: Side panel docked right, full graph
- **<= 900px**: Side panel becomes bottom sheet (40vh max), smaller nodes
- **<= 600px**: Further compaction — smaller icons, tighter spacing

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

## Testing

```bash
cd frontend && npm test              # 20 unit tests (vitest)
node test_visual.js                  # 79 visual regression tests (playwright)
docker build -t gemotvis . && docker run --rm -p 9091:9090 gemotvis  # Docker build verification
```

Visual tests require `npx playwright install chromium` and the demo server running on `:9090`.

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
