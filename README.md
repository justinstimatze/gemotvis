# gemotvis

MAGI-inspired real-time visualization for [gemot](https://gemot.dev) deliberation sessions.

Watch your AI agents submit positions, vote, and reach consensus — rendered as a retro anime command center display inspired by the MAGI system from Neon Genesis Evangelion.

<!-- TODO: Replace with gemotvis screenshot after first deploy -->

## Quick Start

```bash
# No setup needed — just run it
gemotvis
```

Open [localhost:9090](http://localhost:9090). The built-in demo auto-cycles through four scenarios showing different deliberation types and agent counts.

## Install

```bash
go install github.com/justinstimatze/gemotvis@latest
```

Or download a binary from [Releases](https://github.com/justinstimatze/gemotvis/releases).

## Commands

```
gemotvis                     Demo mode (default)
gemotvis demo [flags]        Built-in sample deliberations
gemotvis watch [flags]       Live monitoring of a gemot instance
gemotvis replay <file|url>   Display a saved deliberation
gemotvis export [flags]      Save a deliberation to JSON
```

### Demo

```bash
gemotvis demo                # Auto-cycles every 20s
gemotvis demo --cycle 0      # Manual tab switching only
gemotvis demo --cycle 10s    # Faster cycling for ambient display
```

### Watch (live monitoring)

```bash
gemotvis watch --api-key gmt_xxx
gemotvis watch --gemot-url https://gemot.dev --api-key gmt_xxx
gemotvis watch --api-key gmt_xxx --deliberation abc-123
```

### Export + Replay (save and share)

```bash
# Save a deliberation
gemotvis export --api-key gmt_xxx --deliberation abc-123 > delib.json

# Replay it later
gemotvis replay delib.json

# Or from a URL
gemotvis replay https://gist.githubusercontent.com/.../delib.json
```

## What It Shows

| Element | Source |
|---------|--------|
| Diamond nodes with kanji (承認/否定/保留) | Agent votes (approve/deny/pass) |
| Diamond fill color + cluster tinting | Opinion clusters from PCA analysis |
| Connection lines (green/red/dashed) | Pairwise agreement between agents |
| Center MAGI panel | Consensus, bridging statements, compromise proposals |
| CRUXES panel | Key disagreements with controversy scores |
| METRICS panel | Agent count, vote count, participation, diversity |
| AUDIT LOG | Timestamped operation stream |
| Analysis pipeline bar | Sub-status progress (taxonomy, extracting, dedup, crux detection, summarize) |

### Adaptive Layouts

- **2 agents** — bilateral (side-by-side)
- **3 agents** — MAGI triangle
- **4-7 agents** — regular polygon
- **8+ agents** — flex grid

### Visual Details

- CRT scanline overlay with scan sweep (speed increases during analysis)
- Tactical grid background
- HUD corner brackets
- Boot sequence animation on load
- Chromatic aberration on title text
- Emergency color collapse (green turns red) when integrity warnings detected
- Node entry animations and vote-change flashes
- Typewriter cascade on audit log entries
- Position tooltips on hover

## Docker

```bash
docker build -t gemotvis .
docker run -p 9090:9090 gemotvis
docker run -p 9090:9090 gemotvis watch --api-key gmt_xxx --gemot-url https://gemot.dev
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GEMOTVIS_GEMOT_URL` | `http://localhost:8080` | gemot instance URL |
| `GEMOTVIS_API_KEY` | | gemot API key |
| `GEMOTVIS_ADDR` | `:9090` | Listen address |
| `GEMOTVIS_POLL_INTERVAL` | `10s` | Polling interval |
| `GEMOTVIS_DELIBERATION_ID` | | Watch specific deliberation |

## How It Works

gemotvis is a Go binary (~15MB) that serves a single-page web visualization via embedded static files. In watch mode, it polls gemot's A2A JSON-RPC endpoint for deliberation state, detects changes, and pushes updates to the browser via Server-Sent Events. No Node.js, no build step, no external dependencies.

## License

Apache 2.0
