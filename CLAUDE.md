# gemotvis

MAGI-inspired real-time visualization dashboard for [gemot](https://gemot.dev) deliberation sessions.

## Quick Start

```bash
# Just run it — demo mode, no setup needed
gemotvis

# Or explicitly
gemotvis demo                    # Built-in samples, auto-cycles every 20s
gemotvis demo --cycle 0          # Demo without auto-cycling
gemotvis watch --api-key KEY     # Live monitor (localhost:8080 default)
gemotvis replay delib.json       # Display a saved snapshot
gemotvis export --api-key K --deliberation ID > out.json  # Save a deliberation
```

Open `http://localhost:9090` in a browser.

## Architecture

```
main.go                          Subcommand dispatch (demo/watch/replay/export)
internal/
  gemot/
    client.go                    A2A JSON-RPC client for gemot's /a2a endpoint
    types.go                     Mirrored types (no gemot import dependency)
  poller/poller.go               Polls gemot, detects changes, caches snapshots
  hub/hub.go                     SSE fan-out to browser clients
  server/
    server.go                    HTTP server, SSE, routes (New/NewDemo/NewReplay)
    demo.go                      Built-in sample data (6 scenarios: 2-10 agents)
    static/                      Frontend (vanilla JS + CSS, //go:embed)
      index.html                 App shell with boot sequence + HUD elements
      css/magi.css               CRT aesthetic (scanlines, glow, tactical grid)
      css/layout.css             Adaptive layouts (bilateral/triangle/polygon/grid)
      js/app.js                  SSE, state, rendering, auto-cycle
```

## Modes

| Mode | Data Source | Use Case |
|------|-----------|----------|
| `demo` | Built-in samples | Try it, ambient display, conference demo |
| `watch` | Live gemot A2A | Real-time monitoring on second monitor |
| `replay` | JSON file or URL | Review past deliberations, share with others |
| `export` | Live gemot A2A | Save a deliberation for later replay/sharing |

## Data Flow

```
gemot /a2a  <--poll--  Poller  --on change-->  Hub  --SSE-->  Browser
                                                              Auto-cycle timer
                                                              ↓ (demo mode)
                                                              Tab rotation
```

## Key Decisions

- **Go + vanilla JS, no build step**: Single binary via `//go:embed`
- **SSE not WebSocket**: Read-only monitor
- **Subcommands**: `demo`/`watch`/`replay`/`export` — each mode is discoverable
- **No args = demo**: Zero-friction entry point
- **Snapshot format = `/api/state` JSON**: Export and replay use the same format
- **Auto-cycle**: Demo mode rotates scenarios; pauses on manual click, resumes after 60s

## Conventions

- All DOM rendering uses safe methods (createElement, textContent). No innerHTML.
- CSS custom properties in `:root` for theming. Colors: `--magi-*`.
- Security headers (CSP, X-Frame-Options) on all responses.
- Max 50 concurrent SSE clients.

## Deployment

```bash
# Docker
docker build -t gemotvis . && docker run -p 9090:9090 gemotvis

# Fly.io
fly deploy

# Binary releases via goreleaser
goreleaser release
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GEMOTVIS_GEMOT_URL` | `http://localhost:8080` | gemot instance URL |
| `GEMOTVIS_API_KEY` | (required for watch/export) | gemot API key |
| `GEMOTVIS_ADDR` | `:9090` | Listen address |
| `GEMOTVIS_POLL_INTERVAL` | `10s` | Polling interval |
| `GEMOTVIS_DELIBERATION_ID` | (all) | Watch specific deliberation |
