# Feature Request: Report Mode (Static Readable View)

## Summary

Add a "report mode" to gemotvis that renders a deliberation as a clean, readable document instead of an animated node graph. Think T3C's report output, but for gemot deliberations.

## Motivation

Gemotvis currently shows deliberations as interactive force-directed graphs with scrubber playback — great for exploring dynamics, less great for reading results. When someone runs a T3C structural import (or any deliberation), there's no clean way to just *read the transcript and findings*.

The gemot export (`deliberation action:export`) returns raw JSON. The CSV export is T3C-compatible but not human-readable. There's no markdown, HTML, or document-style output anywhere in the stack.

People who run deliberations want to share results with others who weren't there. A link to an animated graph isn't the same as a document you can read in 3 minutes.

## What It Would Look Like

A new route: `/report/{deliberation_id}` (or a toggle in the existing view).

### Sections

**Header**
- Deliberation title/topic
- Template, participant count, round count
- Provenance tag if imported (e.g. "Imported from T3C report · AI-synthesized structural agents")
- Timestamp, duration

**Participants**
- Agent list with roles (speaker, steelman, adversary, bridge, dissent, empty chair)
- Cluster membership if available
- Model family if tracked

**Per-Round Sections**

For each round:

*Positions*
- Each agent's position text, attributed
- Vote summary: who agreed/disagreed with whom (matrix or compact table)

*Analysis Results*
- **Cruxes**: claim, controversy %, agree/disagree agents, explanation. Sorted by controversy.
- **Consensus**: statements all agents endorse
- **Bridging proposals**: text + bridging score, sorted by score
- **Clusters**: if vote analysis produced them — members, representative statement, repness positions
- **Topic summaries**: LLM-generated per-topic narrative

*Integrity*
- Any warnings (coverage, Sybil, drift, model diversity)

**Evolution** (multi-round only)
- What changed between rounds
- New cruxes that emerged
- Cruxes that resolved
- Positions that shifted

**Commitments** (if any)
- Who committed to what
- Conditional commitments
- Fulfillment status

### Style
- Clean typography, minimal chrome
- Collapsible sections (positions can be long)
- Quote-style blocks for position text
- Controversy scores as colored badges (red = high, green = consensus)
- No animation, no physics, no scrubber
- Print-friendly / PDF-exportable
- Mobile-readable

## Data Source

All data already available from `deliberation action:export`:
- `deliberation`: metadata, topic, template, round
- `rounds[].positions`: all positions per round
- `rounds[].analysis`: full analysis result per round (cruxes, consensus, bridging, clusters, topics)
- `rounds[].votes`: raw vote data
- `commitments`: commitment records
- `audit_log`: operation log

No new gemot API endpoints needed. The export JSON has everything.

## Relationship to T3C Import

The T3C structural import (`scripts/t3c-import/`) creates deliberations from T3C reports. The natural flow is:

1. T3C report → gemot structural import → deliberation created
2. Analysis runs (1-2 rounds)
3. Share results as a readable report via gemotvis report mode

The t3c-import script currently outputs JSON to stdout. It could also generate a markdown report directly. But gemotvis report mode is better because:
- It works for ANY deliberation, not just T3C imports
- It's a URL you can share
- It stays up-to-date if the deliberation continues

## Implementation Notes

- Could reuse the existing export fetch logic (gemotvis already calls gemot APIs)
- The section structure maps directly to the export JSON fields
- Collapsible sections: just HTML details/summary elements
- For the first version, a static render on page load is fine (no need for SSE/live updates)
- Consider making it the default view when a deliberation has completed analysis but the user hasn't opted into the graph view

## Not In Scope

- PDF generation (browser print is sufficient)
- Custom branding/theming (use gemotvis defaults)
- Editing from the report view (read-only)
- Comparative reports (multiple deliberations side-by-side — future feature)
