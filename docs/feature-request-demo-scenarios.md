# Feature Request: Regenerate Demo Scenarios

**Status** (2026-04-19): partially addressed. Four gemot-generated pre-rendered demos exist at `vis.gemot.dev/?data=demo-*` (OSS governance, Diplomacy, Climate policy, AI Manifestos) and are linked from the gemot.dev landing page. The remaining rigor described below — geographic agents with lat/lon, force-directed layouts with 8+ agents, progressive scrubber reveal — is unaddressed.

## Summary

Gemot's built-in demo scenarios should be redesigned to exercise both gemot's deliberation features and gemotvis's visualization capabilities. Two birds, one stone.

## Current State

The gemotvis demo data is hand-written in `internal/server/demo.go` with 5 scenarios. The data was created to test basic visualization but doesn't fully exercise:

- All vote types (agree/disagree/neutral) in visible combinations
- Analysis results (cruxes, clusters, bridging, consensus) that populate footer panels
- Geographic agent metadata (lat/lon) for world map layouts
- Large agent counts (8+) for force-directed layouts
- Mixed bilateral + group deliberations for network graph views
- Progressive data reveal (positions → votes → analysis) that looks good during scrubber playback

## Proposal

Have gemot generate demo scenarios using its actual deliberation engine (with LLM agents or scripted agents) that:

1. **Exercise all gemot features**: voting, analysis (crux detection, opinion clustering, bridging analysis, consensus building), audit logging, multi-round deliberation
2. **Exercise all gemotvis features**: 
   - 2-agent bilateral (center chat panel)
   - 3-agent triangle (center panel + polygon layout)
   - 5-agent pentagon (side panel)
   - 7+ agent network (force-directed layout, network graph)
   - Geographic agents (world map)
   - All vote states (agree/disagree/neutral mix)
   - Rich analysis data (cruxes with disagreements, opinion clusters, bridging agents, consensus statements)
   - Meaningful scrubber timeline with position/vote/analysis events interspersed
3. **Be compelling content**: interesting topics that make good demos at conferences, in screenshots, etc.

## Suggested Scenarios

- **AI Governance** (5 agents): Already exists but needs richer analysis data
- **Diplomacy** (7 agents, geographic): Real bilateral negotiations with lat/lon
- **Code Review** (3 agents): Technical discussion with clear agree/disagree votes
- **Climate Policy** (8+ agents, geographic): Large enough for force-directed layout
- **Ethics Board** (4 agents): Balanced votes showing all three states

## Impact

Better demos → better first impression → easier adoption. Currently the demo data feels static and doesn't showcase gemot's analysis capabilities because the analysis results are sparse placeholder data.
