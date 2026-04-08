import { memo, useMemo, useState, useCallback } from 'react';
import { useSessionStore } from '../../stores/session';
import { shortAgentID } from '../../lib/helpers';
import type { DelibState, AnalysisResult, Crux, ConsensusStatement, NullControlResult, VerificationResult, ReplicationResult, Position as PositionType } from '../../types';

/** Agent kind categories matching gemot report.go */
const STRUCTURAL_KINDS = new Set(['probe', 'bridge', 'dissent', 'empty-chair', 'resolution']);

function isStructuralKind(kind: string): boolean {
  return STRUCTURAL_KINDS.has(kind);
}

/** Build agent→kind map from position metadata */
function buildAgentKindMap(positions: PositionType[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of positions) {
    const kind = (p.metadata as Record<string, string> | undefined)?.kind;
    if (kind && !map.has(p.agent_id)) map.set(p.agent_id, kind);
  }
  return map;
}

/** Split agent list into speaker-derived and structural */
function splitAgentsByKind(agents: string[], kindMap: Map<string, string>): { speakers: string[]; structural: string[] } {
  const speakers: string[] = [];
  const structural: string[] = [];
  for (const a of agents) {
    if (isStructuralKind(kindMap.get(a) ?? '')) structural.push(a);
    else speakers.push(a);
  }
  return { speakers, structural };
}

/** Infer failure mode heuristically — matches gemot report.go */
function discardReason(c: Crux): string {
  const claim = c.crux_claim.toLowerCase();
  if (claim.includes('inevitably') || claim.includes('impossible') || claim.includes('will always') || claim.includes('can never')) {
    return 'Crux over-specified';
  }
  return 'Agent pool gap';
}

/** Ordinal label factoring in effective sample size — matches gemot report.go */
function controversyLabel(score: number, nAgree: number, nDisagree: number): string {
  if (nAgree + nDisagree <= 2) return 'Divided (small N)';
  if (score >= 0.9) return 'Sharp division';
  if (score >= 0.7) return 'Strong disagreement';
  if (score >= 0.55) return 'Moderate disagreement';
  if (score >= 0.4) return 'Contested';
  return 'Mild disagreement';
}

/** First substantive line from position content, skipping headers/structural prefixes */
function firstLine(s: string): string {
  for (const line of s.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('SPEAKER:') || trimmed.startsWith('Stances:') ||
        trimmed.startsWith('Steelman') || trimmed.startsWith('Revised position') || trimmed.startsWith('REVISED POSITION') ||
        trimmed.startsWith('Probe') || trimmed.startsWith('Resolution:') || trimmed.startsWith('RESOLUTION:') ||
        trimmed.startsWith('REQUIRES:') || trimmed.startsWith('Key claims:') || trimmed.startsWith('Source quotes:') ||
        /^\*\*[A-Z].*\*\*:?$/.test(trimmed) || trimmed.startsWith('**What held') || trimmed.startsWith('**REVISED')) continue;
    return trimmed.length > 120 ? trimmed.slice(0, 117) + '...' : trimmed;
  }
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}

/** Stance label for 5-point scale */
function stanceLabel(value: number): string {
  if (value === 2) return '+2';
  if (value === 1) return '+1';
  if (value === 0) return ' 0';
  if (value === -1) return '-1';
  if (value === -2) return '-2';
  return `${value > 0 ? '+' : ''}${value}`;
}

/** CSS class for stance value */
function stanceClass(value: number): string {
  if (value >= 2) return 'report-stance-strong-agree';
  if (value >= 1) return 'report-stance-agree';
  if (value === 0) return 'report-stance-torn';
  if (value >= -1) return 'report-stance-disagree';
  return 'report-stance-strong-disagree';
}

/** Check if a crux has any real (non-structural) speakers */
function hasRealSpeakers(crux: Crux, kindMap: Map<string, string>): boolean {
  for (const a of crux.agree_agents) {
    if (!isStructuralKind(kindMap.get(a) ?? '')) return true;
  }
  for (const a of crux.disagree_agents) {
    if (!isStructuralKind(kindMap.get(a) ?? '')) return true;
  }
  for (const st of crux.stances ?? []) {
    if (!isStructuralKind(kindMap.get(st.agent_id) ?? '')) return true;
  }
  return false;
}

/** Derive support/opposition for a resolution from crux agree/disagree alignment (matches report.go resolutionStances) */
function resolutionStances(resolutionId: string, cruxes: Crux[], kindMap: Map<string, string>): { support: string[]; opposition: string[] } {
  const supportSet = new Set<string>();
  const oppositionSet = new Set<string>();
  for (const c of cruxes) {
    const resOnAgree = c.agree_agents.includes(resolutionId);
    const resOnDisagree = c.disagree_agents.includes(resolutionId);
    if (!resOnAgree && !resOnDisagree) continue;
    for (const a of c.agree_agents) {
      if (a === resolutionId || isStructuralKind(kindMap.get(a) ?? '')) continue;
      if (resOnAgree) supportSet.add(a); else oppositionSet.add(a);
    }
    for (const a of c.disagree_agents) {
      if (a === resolutionId || isStructuralKind(kindMap.get(a) ?? '')) continue;
      if (resOnDisagree) supportSet.add(a); else oppositionSet.add(a);
    }
  }
  // Remove ambiguous agents that appear on both sides
  for (const a of supportSet) {
    if (oppositionSet.has(a)) {
      supportSet.delete(a);
      oppositionSet.delete(a);
    }
  }
  return { support: [...supportSet], opposition: [...oppositionSet] };
}

/** Aggregate discarded cruxes across all analysis rounds */
function aggregateDiscardedCruxes(analyses: AnalysisResult[]): Crux[] {
  const all: Crux[] = [];
  for (const a of analyses) {
    if (a.discarded_cruxes) all.push(...a.discarded_cruxes);
  }
  return all;
}

/** Aggregate integrity warnings across all rounds */
function aggregateIntegrityWarnings(analyses: AnalysisResult[]): string[] {
  const all: string[] = [];
  for (const a of analyses) {
    for (const w of a.integrity_warnings ?? []) {
      if (!w.startsWith('DEGENERATE:')) all.push(w);
    }
  }
  return all;
}

/** Count speaker-derived vs structural agents from kindMap */
function countAgentTypes(kindMap: Map<string, string>): { nSpeakerDerived: number; nStructural: number; nRevised: number } {
  let nSpeakerDerived = 0;
  let nStructural = 0;
  let nRevised = 0;
  const counted = new Set<string>();
  for (const [agentId, kind] of kindMap) {
    if (agentId.endsWith('-r3')) { nRevised++; continue; }
    if (counted.has(agentId)) continue;
    counted.add(agentId);
    if (isStructuralKind(kind)) nStructural++;
    else nSpeakerDerived++;
  }
  return { nSpeakerDerived, nStructural, nRevised };
}

/** Static report view — renders deliberation analysis as a readable document. */
export function ReportView() {
  const deliberations = useSessionStore((s) => s.deliberations);

  const delibEntries = useMemo(() => {
    return Object.keys(deliberations)
      .filter(id => (deliberations[id]?.positions?.length ?? 0) > 0)
      .sort((a, b) => {
        const ta = deliberations[a]?.deliberation?.topic ?? '';
        const tb = deliberations[b]?.deliberation?.topic ?? '';
        return ta.localeCompare(tb);
      });
  }, [deliberations]);

  if (delibEntries.length === 0) {
    return (
      <div className="report-loading" role="status">
        <p>Waiting for deliberation data...</p>
      </div>
    );
  }

  const isMulti = delibEntries.length > 1;

  return (
    <div className="report-view">
      {isMulti && (
        <nav className="report-toc" aria-label="Deliberation index">
          <h2>Deliberations</h2>
          <ol>
            {delibEntries.map(id => {
              const ds = deliberations[id]!;
              return (
                <li key={id}>
                  <a href={`#delib-${id}`}>{ds.deliberation?.topic ?? id}</a>
                  <span className="report-toc-meta">
                    {ds.positions?.length ?? 0} positions · {ds.agents?.length ?? 0} agents
                    {ds.analysis ? ' · analyzed' : ''}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {delibEntries.map(id => (
        <MemoizedDelibReport key={id} id={id} showTitle={isMulti} />
      ))}
    </div>
  );
}

/** Round labels matching report.go */
const ROUND_TITLES: Record<number, string> = {
  1: 'Round 1: Initial Analysis',
  2: 'Round 2: Emergent Findings',
  3: 'Round 3: Revised Positions',
};

/**
 * Minto pyramid report layout — conclusions first, evidence second, detail last.
 * Matches gemot report-format-guide.md structure.
 */
function DelibReport({ id, showTitle }: { id: string; showTitle: boolean }) {
  const ds = useSessionStore((s) => s.deliberations[id]);
  if (!ds) return null;

  const topic = ds.deliberation?.topic ?? id;
  const analysis = ds.analysis;
  const positions = ds.positions ?? [];
  const agents = ds.agents ?? [];
  const kindMap = useMemo(() => buildAgentKindMap(positions), [positions]);
  const analyses = ds.analyses ?? (analysis ? [analysis] : []);
  const sortedAnalyses = useMemo(() => [...analyses].sort((a, b) => a.round_number - b.round_number), [analyses]);
  const nRounds = sortedAnalyses.length;
  const finalAnalysis = sortedAnalyses.length > 0 ? sortedAnalyses[sortedAnalyses.length - 1]! : analysis;

  // Cross-round aggregations
  const allDiscardedCruxes = useMemo(() => aggregateDiscardedCruxes(sortedAnalyses), [sortedAnalyses]);
  const allIntegrityWarnings = useMemo(() => aggregateIntegrityWarnings(sortedAnalyses), [sortedAnalyses]);
  const { nSpeakerDerived, nStructural, nRevised } = useMemo(() => countAgentTypes(kindMap), [kindMap]);

  // Resolution agents
  const resolutions = useMemo(() =>
    positions.filter(p => kindMap.get(p.agent_id) === 'resolution'),
    [positions, kindMap]
  );

  // Total cruxes across all rounds
  const totalCruxAllRounds = useMemo(() => {
    let n = 0;
    for (const a of sortedAnalyses) {
      n += (a.cruxes ?? []).length + (a.discarded_cruxes ?? []).length;
    }
    return n;
  }, [sortedAnalyses]);

  return (
    <article className="report-delib" id={`delib-${id}`}>
      {/* ═══ 1. HEADER + PROVENANCE + TL;DR ═══ */}
      <header className="report-header">
        {showTitle
          ? <h2 className="report-topic">{topic}: Deliberation Report</h2>
          : <h1 className="report-topic">{topic}: Deliberation Report</h1>
        }
      </header>

      <blockquote className="report-provenance">
        AI-synthesized agents — they represent discourse topology, not real participants. Not human expert consensus — verify against primary sources.
      </blockquote>

      {finalAnalysis && (
        <TLDRSection
          analysis={finalAnalysis}
          agents={agents}
          nRounds={nRounds}
          resolutionCount={resolutions.length}
          kindMap={kindMap}
          delibId={id}
          template={ds.deliberation?.template}
        />
      )}

      {/* ═══ TABLE OF CONTENTS ═══ */}
      {finalAnalysis && (
        <nav className="report-toc-inline">
          <strong>Contents: </strong>
          {[
            resolutions.length > 0 ? ['actions', 'Proposed Actions'] : finalAnalysis.compromise_proposal ? ['compromise', 'Proposed Compromise'] : null,
            ['disagreements', 'Key Disagreements'],
            ['common-ground', 'Common Ground'],
            positions.some(p => p.agent_id.endsWith('-r3')) ? ['evolution', 'How Positions Evolved'] : null,
            kindMap.size > 0 ? ['participants', 'Participants'] : null,
            ['confidence', 'Confidence & Caveats'],
            ['appendix', 'Appendix'],
          ].filter((e): e is string[] => e !== null).map(([slug, label], i, arr) => (
            <span key={slug}>
              <a href={`#delib-${id}-${slug}`}>{label}</a>
              {i < arr.length - 1 && ' | '}
            </span>
          ))}
        </nav>
      )}

      {!analysis && positions.length > 0 && (
        <p className="report-no-analysis">Analysis not yet available for this deliberation.</p>
      )}

      {/* ═══ 2. PROPOSED ACTIONS (or Compromise if no R3) ═══ */}
      {resolutions.length > 0 && finalAnalysis ? (
        <ProposedActionsSection
          resolutions={resolutions}
          cruxes={finalAnalysis.cruxes ?? []}
          kindMap={kindMap}
          delibId={id}
        />
      ) : finalAnalysis?.compromise_proposal && !(finalAnalysis.integrity_warnings ?? []).some(w => w.startsWith('ANALYSIS_REFUSED')) ? (
        <section className="report-section report-compromise" id={`delib-${id}-compromise`}>
          <h2>Proposed Compromise</h2>
          <blockquote>{finalAnalysis.compromise_proposal}</blockquote>
        </section>
      ) : null}

      {/* ═══ 3. KEY DISAGREEMENTS — final round cruxes (fallback to earlier if no real speakers) ═══ */}
      {finalAnalysis && <KeyDisagreementsSection
        analyses={sortedAnalyses}
        kindMap={kindMap}
        totalCruxAllRounds={totalCruxAllRounds}
        nRounds={nRounds}
        delibId={id}
      />}

      {/* ═══ 4. COMMON GROUND ═══ */}
      {finalAnalysis && <CommonGroundSection statements={finalAnalysis.consensus_statements ?? []} delibId={id} />}

      {/* ═══ 5. HOW POSITIONS EVOLVED + SYNTHESIS ═══ */}
      {positions.some(p => p.agent_id.endsWith('-r3')) && (
        <PositionEvolutionSection positions={positions} delibId={id} compromise={finalAnalysis?.compromise_proposal} />
      )}

      {/* ═══ 6. PARTICIPANTS — compact ═══ */}
      {kindMap.size > 0 && (
        <ParticipantsSection
          positions={positions}
          kindMap={kindMap}
          nSpeakerDerived={nSpeakerDerived}
          nStructural={nStructural}
          nRevised={nRevised}
          nRounds={nRounds}
          totalAgents={agents.length}
          delibId={id}
        />
      )}

      {/* ═══ 7. CONFIDENCE & CAVEATS ═══ */}
      {finalAnalysis && (
        <ConfidenceSection
          analyses={sortedAnalyses}
          allDiscardedCruxes={allDiscardedCruxes}
          allWarnings={allIntegrityWarnings}
          totalCruxAllRounds={totalCruxAllRounds}
          nRounds={nRounds}
          delibId={id}
        />
      )}

      {/* ═══ 8. APPENDIX — diagnostic detail ═══ */}
      <AppendixSection
        sortedAnalyses={sortedAnalyses}
        kindMap={kindMap}
        allDiscardedCruxes={allDiscardedCruxes}
        positions={positions}
        agents={agents}
        delibId={id}
      />
    </article>
  );
}

const MemoizedDelibReport = memo(DelibReport);

// ═══════════════════════════════════════════════════
// SECTION COMPONENTS
// ═══════════════════════════════════════════════════

function TLDRSection({ analysis, agents, nRounds, resolutionCount, kindMap, delibId, template }: {
  analysis: AnalysisResult;
  agents: DelibState['agents'];
  nRounds: number;
  resolutionCount: number;
  kindMap: Map<string, string>;
  delibId: string;
  template?: string;
}) {
  const { nSpeakerDerived } = countAgentTypes(kindMap);
  const cruxes = analysis.cruxes ?? [];

  // Build TL;DR like report.go
  let topFinding = '';
  if (cruxes.length > 0) {
    const top = cruxes[0]!;
    const { speakers: sAgree } = splitAgentsByKind(top.agree_agents, kindMap);
    const { speakers: sDisagree } = splitAgentsByKind(top.disagree_agents, kindMap);
    if (sAgree.length > 0 && sDisagree.length > 0) {
      const claim = top.crux_claim.replace(/\.$/, '').slice(0, 100).toLowerCase();
      topFinding = `Strongest division: ${sAgree.length} speakers for vs. ${sDisagree.length} against on whether ${claim}.`;
    }
  }

  return (
    <div className="report-tldr">
      <p>
        {nSpeakerDerived > 0 ? `${nSpeakerDerived} speaker-derived` : `${agents.length}`} agents across {nRounds} round{nRounds !== 1 ? 's' : ''}.
        {topFinding && ` ${topFinding}`}
        {resolutionCount > 0 && ` ${resolutionCount} resolution proposal${resolutionCount !== 1 ? 's' : ''} generated.`}
      </p>
      <p className="report-meta-line">
        <em>Deliberation <code>{delibId.slice(0, 8)}...</code>{template && ` — ${template} template`}</em>
      </p>
    </div>
  );
}

function ProposedActionsSection({ resolutions, cruxes, kindMap, delibId }: {
  resolutions: PositionType[];
  cruxes: Crux[];
  kindMap: Map<string, string>;
  delibId: string;
}) {
  return (
    <section className="report-section" id={`delib-${delibId}-actions`}>
      <h2>Proposed Actions</h2>
      {resolutions.map((res, i) => {
        // Extract title from content (RESOLUTION: Title line or role)
        const title = res.content.split('\n')
          .map(l => l.trim())
          .find(l => l.startsWith('RESOLUTION:'))
          ?.replace(/^RESOLUTION:\s*/i, '')
          ?? shortAgentID(res.agent_id);

        // Extract proposal body and REQUIRES section
        const lines = res.content.split('\n');
        const proposalLines: string[] = [];
        const requiresLines: string[] = [];
        let inRequires = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('RESOLUTION:')) continue;
          if (trimmed.startsWith('REQUIRES:')) {
            inRequires = true;
            requiresLines.push(trimmed.replace(/^REQUIRES:\s*/, ''));
            continue;
          }
          if (inRequires) requiresLines.push(trimmed);
          else proposalLines.push(trimmed);
        }

        // Get support/opposition from crux alignment
        const { support, opposition } = resolutionStances(res.agent_id, cruxes, kindMap);

        return (
          <div key={i} className="report-resolution">
            <h3>{i + 1}. {title}</h3>
            {proposalLines.length > 0 && <p>{proposalLines.join(' ')}</p>}
            {requiresLines.length > 0 && (
              <p className="report-requires"><em>Requires:</em> {requiresLines.join(' ')}</p>
            )}
            <div className="report-stances">
              {support.length > 0 && (
                <span className="report-agents-agree"><strong>Support:</strong> {support.map(a => shortAgentID(a)).join(', ')}</span>
              )}
              {opposition.length > 0 && (
                <span className="report-agents-disagree"><strong>Opposition:</strong> {opposition.map(a => shortAgentID(a)).join(', ')}</span>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function KeyDisagreementsSection({ analyses, kindMap, totalCruxAllRounds, nRounds, delibId }: {
  analyses: AnalysisResult[];
  kindMap: Map<string, string>;
  totalCruxAllRounds: number;
  nRounds: number;
  delibId: string;
}) {
  // Pick analysis with most real-speaker cruxes — fallback to earlier round if final has none
  const finalAnalysis = analyses[analyses.length - 1]!;
  let cruxAnalysis = finalAnalysis;
  let isFallback = false;
  const finalCruxes = (finalAnalysis.cruxes ?? []).filter(c => hasRealSpeakers(c, kindMap));
  if (finalCruxes.length === 0) {
    for (let i = analyses.length - 2; i >= 0; i--) {
      const rCruxes = (analyses[i]!.cruxes ?? []).filter(c => hasRealSpeakers(c, kindMap));
      if (rCruxes.length > 0) {
        cruxAnalysis = analyses[i]!;
        isFallback = true;
        break;
      }
    }
  }

  const cruxes = (cruxAnalysis.cruxes ?? []).filter(c => hasRealSpeakers(c, kindMap));
  if (cruxes.length === 0) return null;

  return (
    <section className="report-section" id={`delib-${delibId}-disagreements`}>
      <h2>Key Disagreements</h2>
      <p className="report-section-note">
        <em>{cruxes.length} cruxes from {isFallback ? 'an earlier round (final round lacked real-speaker data; ' : 'the final round ('}{totalCruxAllRounds} generated across all {nRounds} rounds).</em>
      </p>
      {cruxes.map((crux, i) => {
        const { speakers: sAgree } = splitAgentsByKind(crux.agree_agents, kindMap);
        const { speakers: sDisagree } = splitAgentsByKind(crux.disagree_agents, kindMap);
        const hasStances = crux.stances && crux.stances.length > 0;
        // For (X vs Y) count, use speakers only
        const nFor = hasStances
          ? crux.stances!.filter(st => st.value > 0 && !isStructuralKind(kindMap.get(st.agent_id) ?? '')).length
          : sAgree.length;
        const nAgainst = hasStances
          ? crux.stances!.filter(st => st.value < 0 && !isStructuralKind(kindMap.get(st.agent_id) ?? '')).length
          : sDisagree.length;

        return (
          <div key={i} className="report-crux">
            <div className="report-crux-header">
              <strong>{i + 1}. ({nFor} vs {nAgainst})</strong>{' '}
              <span className="report-crux-claim">{crux.crux_claim}</span>
            </div>
            {hasStances ? (
              <div className="report-stance-list">
                {crux.stances!
                  .filter(st => !isStructuralKind(kindMap.get(st.agent_id) ?? ''))
                  .map((st, j) => (
                    <div key={j} className={`report-stance ${stanceClass(st.value)}`}>
                      <span className="report-stance-value">{stanceLabel(st.value)}</span>
                      <span className="report-stance-name">{shortAgentID(st.agent_id)}</span>
                      {st.qualifier && <span className="report-stance-qualifier">({st.qualifier})</span>}
                    </div>
                  ))
                }
              </div>
            ) : (sAgree.length > 0 || sDisagree.length > 0) ? (
              <div className="report-crux-agents">
                {sAgree.length > 0 && <span className="report-agents-agree">Agree: {sAgree.map(a => shortAgentID(a)).join(', ')}</span>}
                {sDisagree.length > 0 && <span className="report-agents-disagree">Disagree: {sDisagree.map(a => shortAgentID(a)).join(', ')}</span>}
              </div>
            ) : null}
            {crux.explanation && (
              <blockquote className="report-crux-explanation">{crux.explanation}</blockquote>
            )}
          </div>
        );
      })}
    </section>
  );
}

function CommonGroundSection({ statements, delibId }: { statements: ConsensusStatement[]; delibId: string }) {
  return (
    <section className="report-section report-common-ground" id={`delib-${delibId}-common-ground`}>
      <h2>Common Ground</h2>
      {statements.length > 0 ? (
        <ul className="report-list">
          {statements.map((c, i) => (
            <li key={i}>{c.content}</li>
          ))}
        </ul>
      ) : (
        <p className="report-section-note"><em>No consensus statements survived quality filtering. Positions remained divergent across all clusters — deliberation did not produce artificial convergence.</em></p>
      )}
    </section>
  );
}

/** Render [HELD], [UPDATED], [NEW] tags with distinct styling */
function EvolutionTags({ text }: { text: string }) {
  const tagPattern = /\[(HELD|UPDATED|NEW)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = tagPattern.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    const tag = m[1]!.toLowerCase();
    const cls = tag === 'held' ? 'report-tag-held' : tag === 'updated' ? 'report-tag-updated' : 'report-tag-new';
    parts.push(<span key={m.index} className={`report-evolution-tag ${cls}`}>[{m[1]}]</span>);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  if (parts.length === 0) return <>{text}</>;
  return <>{parts}</>;
}

function PositionEvolutionSection({ positions, delibId, compromise }: { positions: PositionType[]; delibId: string; compromise?: string }) {
  const r3Positions = positions.filter(p => p.agent_id.endsWith('-r3') && !(p.metadata as Record<string, string> | undefined)?.kind?.includes('resolution'));
  if (r3Positions.length === 0) return null;

  const r1Map = new Map<string, PositionType>();
  for (const p of positions) {
    if (p.round_number === 1 && !p.agent_id.endsWith('-r3')) {
      r1Map.set(p.agent_id, p);
    }
  }

  const pairs = r3Positions
    .map(r3 => {
      const baseId = r3.agent_id.replace(/-r3$/, '');
      const r1 = r1Map.get(baseId);
      return r1 ? { name: shortAgentID(baseId), r1: r1.content, r3: r3.content } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (pairs.length === 0) return null;

  return (
    <section className="report-section" id={`delib-${delibId}-evolution`}>
      <h2>How Positions Evolved</h2>
      {pairs.map((p, i) => {
        const revisedLine = firstLine(p.r3);
        return (
          <div key={i} className="report-position-evolution">
            <strong>{p.name}</strong>
            <div className="report-evolution-comparison">
              <div className="report-evolution-round"><em>Started:</em> {firstLine(p.r1)}</div>
              <div className="report-evolution-round"><em>Revised:</em> <EvolutionTags text={revisedLine} /></div>
            </div>
          </div>
        );
      })}

      {/* Synthesis — final compromise under evolution */}
      {compromise && (
        <>
          <h3>Synthesis</h3>
          <p className="report-section-note"><em>LLM-generated synthesis from the final round — treat as a starting point.</em></p>
          <blockquote>{compromise}</blockquote>
        </>
      )}
    </section>
  );
}

function ParticipantsSection({ positions, kindMap, nSpeakerDerived, nStructural, nRevised, nRounds, totalAgents, delibId }: {
  positions: PositionType[];
  kindMap: Map<string, string>;
  nSpeakerDerived: number;
  nStructural: number;
  nRevised: number;
  nRounds: number;
  totalAgents: number;
  delibId: string;
}) {
  // Group into clusters and individuals (compact format matching new report.go)
  const clusters: string[][] = [];
  const individuals: string[] = [];
  const seen = new Set<string>();

  for (const p of positions) {
    const baseId = p.agent_id.replace(/-r3$/, '');
    if (seen.has(baseId)) continue;
    seen.add(baseId);
    const kind = kindMap.get(p.agent_id);
    if (kind === 'steelman') {
      // Each steelman is a cluster — names are in the agent ID
      clusters.push([shortAgentID(baseId)]);
    } else if (kind === 'speaker') {
      individuals.push(shortAgentID(baseId));
    }
    // Structural agents not listed in compact participants — they're implicit
  }

  return (
    <section className="report-section" id={`delib-${delibId}-participants`}>
      <h2>Participants</h2>
      {clusters.length > 0 && (
        <p><strong>Clusters:</strong> {clusters.map(c => c.join(', ')).join(' | ')}</p>
      )}
      {individuals.length > 0 && (
        <p><strong>Individual:</strong> {individuals.join(', ')}</p>
      )}
      <p className="report-section-note">
        <em>{totalAgents} total agents across {nRounds} rounds ({nSpeakerDerived} speaker-derived, {nStructural} structural{nRevised > 0 ? `, ${nRevised} revised/resolution` : ''})</em>
      </p>
    </section>
  );
}

function ConfidenceSection({ analyses, allDiscardedCruxes, allWarnings, totalCruxAllRounds, nRounds, delibId }: {
  analyses: AnalysisResult[];
  allDiscardedCruxes: Crux[];
  allWarnings: string[];
  totalCruxAllRounds: number;
  nRounds: number;
  delibId: string;
}) {
  const analysis = analyses[analyses.length - 1]!;
  const discardedCount = allDiscardedCruxes.length;
  const degenerateRate = totalCruxAllRounds > 0 ? Math.round((discardedCount / totalCruxAllRounds) * 100) : 0;

  const coherenceStatus = degenerateRate > 40 ? 'fail' : degenerateRate > 20 ? 'partial' : 'pass';
  const coherenceClass = degenerateRate > 40 ? 'report-badge-red' : degenerateRate > 20 ? 'report-badge-yellow' : 'report-badge-green';

  // Hallucination count across all rounds
  let hallucinationCount = 0;
  for (const a of analyses) {
    hallucinationCount += (a.integrity_warnings ?? []).filter(w => w.startsWith('HALLUCINATION')).length;
  }

  // SYBIL/ANALYSIS_REFUSED warnings
  const criticalWarnings = allWarnings.filter(w => w.startsWith('SYBIL') || w.startsWith('ANALYSIS_REFUSED'));

  return (
    <section className="report-section" id={`delib-${delibId}-confidence`}>
      <h2>Confidence &amp; Caveats</h2>
      <table className="report-table">
        <thead>
          <tr><th>Check</th><th>Status</th><th>Detail</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Crux coherence</td>
            <td><span className={`report-badge ${coherenceClass}`}>{coherenceStatus}</span></td>
            <td>{totalCruxAllRounds - discardedCount}/{totalCruxAllRounds} survived ({degenerateRate}% discard rate)</td>
          </tr>
          <tr>
            <td>Agent hallucinations</td>
            <td><span className={`report-badge ${hallucinationCount > 0 ? 'report-badge-yellow' : 'report-badge-green'}`}>
              {hallucinationCount > 0 ? 'minor' : 'none'}
            </span></td>
            <td>{hallucinationCount > 0 ? `${hallucinationCount} phantom agents removed` : '—'}</td>
          </tr>
          {analysis.null_control ? (
            <tr>
              <td>Null control</td>
              <td><span className={`report-badge ${analysis.null_control.pass ? 'report-badge-green' : 'report-badge-red'}`}>
                {analysis.null_control.pass ? 'pass' : 'fail'}
              </span></td>
              <td>{analysis.null_control.pass ? 'Distinguishable from noise' : `${analysis.null_control.failed_metrics?.length ?? 0} metrics indistinguishable`}</td>
            </tr>
          ) : (
            <tr><td>Null control</td><td><span className="report-badge report-badge-dim">untested</span></td><td>—</td></tr>
          )}
          {analysis.replication && analysis.replication.runs.length >= 2 ? (
            <tr>
              <td>Replication</td>
              <td><span className={`report-badge ${analysis.replication.stability.all_stable ? 'report-badge-green' : 'report-badge-yellow'}`}>
                {analysis.replication.stability.all_stable ? 'pass' : 'partial'}
              </span></td>
              <td>{analysis.replication.runs.length} runs{analysis.replication.stability.all_stable ? ', all CV < 0.2' : ', some metrics unstable'}</td>
            </tr>
          ) : (
            <tr><td>Replication</td><td><span className="report-badge report-badge-dim">untested</span></td><td>—</td></tr>
          )}
          {analysis.verification ? (() => {
            const vf = analysis.verification;
            const kept = vf.checked - vf.downgraded;
            const vfLabel = vf.downgraded > 0 ? 'cleaned' : 'pass';
            const vfClass = vf.downgraded > 0 ? 'report-badge-yellow' : 'report-badge-green';
            const vfDetail = vf.downgraded > 0
              ? `${kept}/${vf.checked} kept, ${vf.downgraded} downgraded`
              : `All ${vf.checked} stances verified`;
            return (
              <tr>
                <td>Stance grounding</td>
                <td><span className={`report-badge ${vfClass}`}>{vfLabel}</span></td>
                <td>{vfDetail}</td>
              </tr>
            );
          })() : (
            <tr><td>Stance grounding</td><td><span className="report-badge report-badge-dim">untested</span></td><td>—</td></tr>
          )}
          <tr><td>T3C input quality</td><td><span className="report-badge report-badge-dim">unchecked</span></td><td>—</td></tr>
          <tr><td>Crux assignments</td><td><span className="report-badge report-badge-dim">unchecked</span></td><td>—</td></tr>
        </tbody>
      </table>

      {criticalWarnings.map((w, i) => (
        <p key={i} className="report-warning"><strong>Warning:</strong> {w}</p>
      ))}

      <p><strong>Key caveat:</strong> AI-synthesized agents deliberating is inherently circular. This maps discourse structure — it does not produce independent evidence. Verify conclusions against primary sources.</p>
      <p className="report-section-note">
        <strong>Methodology:</strong> Agents built from extracted claims+quotes. Clustered by Jaccard subtopic overlap (&ge;50%) + shared claims (&ge;2). {nRounds}-round phased protocol{nRounds >= 3 ? ' with position revision and resolution proposals' : ''}. LLM outputs are stochastic — replicate to confirm stability.
      </p>
    </section>
  );
}

// ═══════════════════════════════════════════════════
// APPENDIX — diagnostic detail in collapsible sections
// ═══════════════════════════════════════════════════

function AppendixSection({ sortedAnalyses, kindMap, allDiscardedCruxes, positions, agents, delibId }: {
  sortedAnalyses: AnalysisResult[];
  kindMap: Map<string, string>;
  allDiscardedCruxes: Crux[];
  positions: PositionType[];
  agents: DelibState['agents'];
  delibId: string;
}) {
  const hasContent = sortedAnalyses.length > 0 || allDiscardedCruxes.length > 0 || positions.length > 0;
  if (!hasContent) return null;

  const analysis = sortedAnalyses.length > 0 ? sortedAnalyses[sortedAnalyses.length - 1]! : null;

  return (
    <>
      <hr className="report-appendix-rule" />
      <section className="report-appendix" id={`delib-${delibId}-appendix`}>
        <h2>Appendix</h2>

        {/* Per-round analysis */}
        {sortedAnalyses.map((roundAnalysis) => (
          <AppendixRoundSection
            key={roundAnalysis.round_number}
            analysis={roundAnalysis}
            kindMap={kindMap}
            delibId={delibId}
          />
        ))}

        {/* Evolution across rounds */}
        {sortedAnalyses.length > 1 && (
          <EvolutionSection analyses={sortedAnalyses} delibId={delibId} />
        )}

        {/* Discarded cruxes */}
        {allDiscardedCruxes.length > 0 && (
          <details className="report-appendix-detail">
            <summary>Discarded Cruxes ({allDiscardedCruxes.length})</summary>
            <p className="report-section-note">Cruxes where one side had zero agents after validation.</p>
            {allDiscardedCruxes.map((crux, i) => (
              <div key={i} className="report-crux report-crux-discarded">
                <span className="report-badge report-badge-dim">{discardReason(crux)}</span>
                {' '}{crux.crux_claim}
              </div>
            ))}
          </details>
        )}

        {/* Verification detail */}
        {analysis?.verification && analysis.verification.checked > 0 && (
          <VerificationDetail result={analysis.verification} delibId={delibId} />
        )}

        {/* Null control detail */}
        {analysis?.null_control && (
          <NullControlDetail result={analysis.null_control} delibId={delibId} />
        )}

        {/* Replication detail */}
        {analysis?.replication && analysis.replication.runs.length >= 2 && (
          <ReplicationDetail result={analysis.replication} delibId={delibId} />
        )}

        {/* Coverage gaps */}
        {analysis?.coverage_gaps && analysis.coverage_gaps.length > 0 && (
          <details className="report-appendix-detail">
            <summary>Missing Perspectives ({analysis.coverage_gaps.length})</summary>
            <ul className="report-list">
              {analysis.coverage_gaps.map((gap, i) => (
                <li key={i}>
                  <strong>{gap.position}</strong>
                  {gap.missing_perspective && <div className="report-gap-detail">Missing: {gap.missing_perspective}</div>}
                  {gap.suggested_source && <div className="report-gap-detail">Would contest: {gap.suggested_source}</div>}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Agent positions */}
        <LazyPositionSection positions={positions} agents={agents} delibId={delibId} />
      </section>
    </>
  );
}

/** Per-round analysis in the appendix — cruxes with two-track, consensus, compromise, topics */
function AppendixRoundSection({ analysis, kindMap, delibId }: {
  analysis: AnalysisResult;
  kindMap: Map<string, string>;
  delibId: string;
}) {
  const title = ROUND_TITLES[analysis.round_number] ?? `Round ${analysis.round_number}`;
  const cruxes = analysis.cruxes ?? [];
  const consensus = analysis.consensus_statements ?? [];
  const topics = analysis.topic_summaries ?? [];
  const compromise = analysis.compromise_proposal;
  const refused = (analysis.integrity_warnings ?? []).some(w => w.startsWith('ANALYSIS_REFUSED'));

  return (
    <details className="report-appendix-detail" id={`delib-${delibId}-round-${analysis.round_number}`}>
      <summary>{title} ({cruxes.length} cruxes)</summary>

      {cruxes.length > 0 && (
        <>
          <h4>Cruxes</h4>
          {cruxes.map((crux, i) => {
            const hasStances = crux.stances && crux.stances.length > 0;

            return (
              <div key={i} className="report-crux">
                <div className="report-crux-header">
                  <span className="report-badge report-badge-red">
                    {controversyLabel(crux.controversy_score, crux.agree_agents.length, crux.disagree_agents.length)}
                  </span>
                  <span className="report-crux-claim">{crux.crux_claim}</span>
                </div>
                {hasStances ? (
                  <div className="report-stance-list">
                    {crux.stances!.filter(st => !isStructuralKind(kindMap.get(st.agent_id) ?? '')).map((st, j) => (
                      <div key={j} className={`report-stance ${stanceClass(st.value)}`}>
                        <span className="report-stance-value">{stanceLabel(st.value)}</span>
                        <span className="report-stance-name">{shortAgentID(st.agent_id)}</span>
                        {st.qualifier && <span className="report-stance-qualifier">({st.qualifier})</span>}
                      </div>
                    ))}
                    {crux.stances!.filter(st => isStructuralKind(kindMap.get(st.agent_id) ?? '')).map((st, j) => (
                      <div key={`s${j}`} className={`report-stance report-stance-structural ${stanceClass(st.value)}`}>
                        <span className="report-stance-value">{stanceLabel(st.value)}</span>
                        <span className="report-stance-name">{shortAgentID(st.agent_id)}</span>
                        {st.qualifier && <span className="report-stance-qualifier">({st.qualifier})</span>}
                      </div>
                    ))}
                  </div>
                ) : (() => {
                  const agreeByKind = splitAgentsByKind(crux.agree_agents, kindMap);
                  const disagreeByKind = splitAgentsByKind(crux.disagree_agents, kindMap);
                  const showTwoTrack = kindMap.size > 0 &&
                    (agreeByKind.speakers.length > 0 || disagreeByKind.speakers.length > 0) &&
                    (agreeByKind.structural.length > 0 || disagreeByKind.structural.length > 0);
                  return showTwoTrack ? (
                    <div className="report-crux-agents">
                      <div className="report-crux-track">
                        <span className="report-track-label">Speakers:</span>
                        {agreeByKind.speakers.length > 0 && <span className="report-agents-agree">Agree: {agreeByKind.speakers.map(a => shortAgentID(a)).join(', ')}</span>}
                        {disagreeByKind.speakers.length > 0 && <span className="report-agents-disagree">Disagree: {disagreeByKind.speakers.map(a => shortAgentID(a)).join(', ')}</span>}
                      </div>
                      <div className="report-crux-track">
                        <span className="report-track-label">Structural:</span>
                        {agreeByKind.structural.length > 0 && <span className="report-agents-agree">Agree: {agreeByKind.structural.map(a => shortAgentID(a)).join(', ')}</span>}
                        {disagreeByKind.structural.length > 0 && <span className="report-agents-disagree">Disagree: {disagreeByKind.structural.map(a => shortAgentID(a)).join(', ')}</span>}
                      </div>
                    </div>
                  ) : (
                    <div className="report-crux-agents">
                      {crux.agree_agents.length > 0 && <span className="report-agents-agree">Agree: {crux.agree_agents.map(a => shortAgentID(a)).join(', ')}</span>}
                      {crux.disagree_agents.length > 0 && <span className="report-agents-disagree">Disagree: {crux.disagree_agents.map(a => shortAgentID(a)).join(', ')}</span>}
                    </div>
                  );
                })()}
                {crux.explanation && <blockquote className="report-crux-explanation">{crux.explanation}</blockquote>}
              </div>
            );
          })}
        </>
      )}

      {consensus.length > 0 && (
        <>
          <h4>Unchallenged Within This Agent Pool</h4>
          <p className="report-section-note">Positions on which no agent registered disagreement — reflects this agent pool's topology, not established truths.</p>
          <ul className="report-list">
            {consensus.map((c, i) => <li key={i}>{c.content}</li>)}
          </ul>
        </>
      )}

      {compromise && !refused && (
        <>
          <h4>Compromise Proposal</h4>
          <p className="report-section-note">LLM-generated synthesis — treat as a starting point.</p>
          <blockquote>{compromise}</blockquote>
        </>
      )}

      {topics.length > 0 && (
        <>
          <h4>Topics</h4>
          {topics.map((t, i) => (
            <details key={i} className="report-topic-detail">
              <summary>{t.topic_id ? `${t.topic_id}: ${t.topic}` : t.topic}</summary>
              <p>{t.summary}</p>
            </details>
          ))}
        </>
      )}

      <p className="report-round-coherence"><em>Internal coherence: {analysis.confidence} (self-assessed, not externally validated)</em></p>
    </details>
  );
}

function EvolutionSection({ analyses, delibId }: { analyses: AnalysisResult[]; delibId: string }) {
  if (analyses.length < 2) return null;
  const r1 = analyses[0]!;
  const r2 = analyses[1]!;

  const r1Claims = new Set((r1.cruxes ?? []).map(c => c.crux_claim));
  const newCruxes = (r2.cruxes ?? []).filter(c => !r1Claims.has(c.crux_claim));

  // Topic taxonomy changes using topic_id
  const r1TopicsById = new Map((r1.topic_summaries ?? []).filter(t => t.topic_id).map(t => [t.topic_id!, t.topic]));
  const r1TopicNames = new Set((r1.topic_summaries ?? []).map(t => t.topic));
  const renamed: string[] = [];
  const added: string[] = [];
  const dropped: string[] = [];
  const r2TopicsById = new Map((r2.topic_summaries ?? []).filter(t => t.topic_id).map(t => [t.topic_id!, t.topic]));
  const r2TopicNames = new Set((r2.topic_summaries ?? []).map(t => t.topic));
  for (const [tid, name] of r2TopicsById) {
    const r1Name = r1TopicsById.get(tid);
    if (r1Name && r1Name !== name) renamed.push(`${tid}: ${r1Name} → ${name}`);
    if (!r1TopicNames.has(name) && !r1Name) added.push(tid ? `${tid}: ${name}` : name);
  }
  for (const [tid, name] of r1TopicsById) {
    if (!r2TopicsById.has(tid) && !r2TopicNames.has(name)) dropped.push(tid ? `${tid}: ${name}` : name);
  }

  const hasChanges = newCruxes.length > 0 || renamed.length > 0 || added.length > 0 || dropped.length > 0;
  if (!hasChanges) return null;

  return (
    <details className="report-appendix-detail" id={`delib-${delibId}-taxonomy-evolution`}>
      <summary>Cross-Round Evolution</summary>
      {newCruxes.length > 0 && (
        <>
          <h4>New or refined cruxes in Round 2:</h4>
          <ul className="report-list">
            {newCruxes.map((c, i) => (
              <li key={i}>
                <span className="report-badge report-badge-red">{controversyLabel(c.controversy_score, c.agree_agents.length, c.disagree_agents.length)}</span>
                {' '}{c.crux_claim.length > 140 ? c.crux_claim.slice(0, 140) + '...' : c.crux_claim}
              </li>
            ))}
          </ul>
          <p className="report-section-note">R2 cruxes may be reworded versions of R1 cruxes — some may be refinements.</p>
        </>
      )}
      {(renamed.length > 0 || added.length > 0 || dropped.length > 0) && (
        <>
          <h4>Topic taxonomy changes:</h4>
          <ul className="report-list">
            {renamed.map((r, i) => <li key={`r${i}`}>Renamed: {r}</li>)}
            {added.map((a, i) => <li key={`a${i}`}>New in R2: {a}</li>)}
            {dropped.map((d, i) => <li key={`d${i}`}>Dropped from R1: {d}</li>)}
          </ul>
        </>
      )}
    </details>
  );
}

function VerificationDetail({ result, delibId }: { result: VerificationResult; delibId: string }) {
  const scoreLabels = ['', 'No relevant quotes', 'Tangentially related', 'Interpretation', 'Clearly aligned', 'Explicitly supported'];

  let scoreDist = result.score_dist ?? [0, 0, 0, 0, 0, 0];
  const distTotal = scoreDist.reduce((a, b) => a + b, 0);
  if (distTotal === 0 && result.details && result.details.length > 0) {
    scoreDist = [0, 0, 0, 0, 0, 0];
    for (const d of result.details) {
      if (d.score >= 1 && d.score <= 5) scoreDist[d.score] = (scoreDist[d.score] ?? 0) + 1;
    }
  }

  const kept = result.checked - result.downgraded;
  return (
    <details className="report-appendix-detail" id={`delib-${delibId}-verification`}>
      <summary>Stance Verification ({kept}/{result.checked} kept)</summary>
      <p className="report-section-note">
        {result.checked} stances checked against source quotes (1-5 grounding scale, threshold &le;{result.threshold}). {kept} kept, {result.downgraded} downgraded.
      </p>
      <table className="report-table">
        <thead>
          <tr><th>Score</th><th>Meaning</th><th>Count</th></tr>
        </thead>
        <tbody>
          {[5, 4, 3, 2, 1].map(s => (
            <tr key={s} className={s <= result.threshold ? 'report-row-downgraded' : ''}>
              <td>{s}</td>
              <td>{scoreLabels[s]}{s <= result.threshold && <span className="report-badge report-badge-dim">downgraded</span>}</td>
              <td>{scoreDist[s] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.details && result.details.length > 0 && (
        <div className="report-verify-details">
          {result.details.map((d, i) => (
            <div key={i} className="report-verify-detail">
              <strong>{shortAgentID(d.speaker)}</strong> ({d.orig_stance}, score {d.score}) on: {d.crux}
              {d.reason && <blockquote>{d.reason}</blockquote>}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

function NullControlDetail({ result, delibId }: { result: NullControlResult; delibId: string }) {
  const r = result.real_metrics;
  const n = result.null_metrics;
  function delta(real: number, nul: number): string {
    if (real === 0 && nul === 0) return '—';
    if (real === 0) return `${nul > 0 ? '+' : ''}${nul}`;
    const pct = ((real - nul) / real) * 100;
    return `${pct >= 0 ? '+' : ''}${Math.round(pct)}%`;
  }

  return (
    <details className="report-appendix-detail" id={`delib-${delibId}-null-control`}>
      <summary>Null Control ({result.pass ? 'pass' : 'fail'})</summary>
      <table className="report-table">
        <thead>
          <tr><th>Metric</th><th>Real Run</th><th>Null Control</th><th>Delta</th></tr>
        </thead>
        <tbody>
          <tr><td>Cruxes</td><td>{r.crux_count}</td><td>{n.crux_count}</td><td>{delta(r.crux_count, n.crux_count)}</td></tr>
          <tr><td>Avg controversy</td><td>{r.avg_controversy.toFixed(2)}</td><td>{n.avg_controversy.toFixed(2)}</td><td>{delta(r.avg_controversy, n.avg_controversy)}</td></tr>
          <tr><td>Consensus</td><td>{r.consensus_count}</td><td>{n.consensus_count}</td><td>{delta(r.consensus_count, n.consensus_count)}</td></tr>
          <tr><td>Bridging</td><td>{r.bridging_count}</td><td>{n.bridging_count}</td><td>{delta(r.bridging_count, n.bridging_count)}</td></tr>
          <tr><td>Clusters</td><td>{r.cluster_count}</td><td>{n.cluster_count}</td><td>{delta(r.cluster_count, n.cluster_count)}</td></tr>
        </tbody>
      </table>
      <p className={result.pass ? 'report-verdict-pass' : 'report-verdict-fail'}>
        <strong>{result.pass ? 'Pass' : 'Fail'}:</strong> {result.pass
          ? 'Real run distinguishable from noise.'
          : `${result.failed_metrics?.length ?? 0} metrics indistinguishable from noise.`
        }
      </p>
    </details>
  );
}

function ReplicationDetail({ result, delibId }: { result: ReplicationResult; delibId: string }) {
  const s = result.stability;
  return (
    <details className="report-appendix-detail" id={`delib-${delibId}-replication`}>
      <summary>Replication ({result.runs.length} runs, {s.all_stable ? 'stable' : 'unstable'})</summary>
      <table className="report-table">
        <thead>
          <tr><th>Run</th><th>Cruxes</th><th>Avg Controversy</th><th>Consensus</th><th>Bridging</th><th>Confidence</th></tr>
        </thead>
        <tbody>
          {result.runs.map((run, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{run.crux_count}</td>
              <td>{run.avg_controversy.toFixed(2)}</td>
              <td>{run.consensus_count}</td>
              <td>{run.bridging_count}</td>
              <td>{run.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><strong>Stability (CV):</strong> crux {s.crux_cv.toFixed(2)}, controversy {s.controv_cv.toFixed(2)}, consensus {s.consensus_cv.toFixed(2)}</p>
    </details>
  );
}

/** Lazy-loaded position section — content only rendered when expanded. */
function LazyPositionSection({ positions, agents, delibId }: { positions: DelibState['positions']; agents: DelibState['agents']; delibId: string }) {
  if (!positions || positions.length === 0) return null;
  const agentNames = new Map((agents ?? []).map(a => [a.id, shortAgentID(a.id)]));

  return (
    <details className="report-appendix-detail" id={`delib-${delibId}-positions`}>
      <summary>Agent Positions ({positions.length})</summary>
      {positions.map((p, i) => (
        <LazyPosition key={p.position_id ?? i} name={agentNames.get(p.agent_id) ?? p.agent_id} content={p.content} />
      ))}
    </details>
  );
}

/** Individual position — content only mounts to DOM when opened. */
function LazyPosition({ name, content }: { name: string; content: string }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(o => !o), []);

  return (
    <div className="report-position">
      <button className="report-position-toggle" onClick={toggle} aria-expanded={open}>
        <span className="report-expand-icon">{open ? '▾' : '▸'}</span>
        {name}
      </button>
      {open && <div className="report-position-content">{content}</div>}
    </div>
  );
}
