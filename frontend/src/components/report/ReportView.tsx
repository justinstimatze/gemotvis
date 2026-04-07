import { memo, useMemo, useState, useCallback } from 'react';
import { useSessionStore } from '../../stores/session';
import { shortAgentID } from '../../lib/helpers';
import type { DelibState, AnalysisResult, Crux, ConsensusStatement, BridgingStatement, NullControlResult, VerificationResult, ReplicationResult, CoverageGap, Position as PositionType } from '../../types';

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

/** Each delib report subscribes to its own slice of the store. */
function DelibReport({ id, showTitle }: { id: string; showTitle: boolean }) {
  const ds = useSessionStore((s) => s.deliberations[id]);
  if (!ds) return null;

  const topic = ds.deliberation?.topic ?? id;
  const analysis = ds.analysis;
  const positions = ds.positions ?? [];
  const agents = ds.agents ?? [];
  const kindMap = useMemo(() => buildAgentKindMap(positions), [positions]);

  return (
    <article className="report-delib" id={`delib-${id}`}>
      <header className="report-header">
        {showTitle ? <h2 className="report-topic">{topic}</h2> : <h1 className="report-topic">{topic}</h1>}
        <div className="report-meta">
          {agents.length} agents · {positions.length} positions
          {ds.deliberation?.status && <span className="report-status">{ds.deliberation.status}</span>}
          {analysis && <span className="report-confidence">{analysis.confidence} confidence</span>}
        </div>
      </header>

      {!analysis && positions.length > 0 && (
        <p className="report-no-analysis">Analysis not yet available for this deliberation.</p>
      )}

      {analysis && <KeyFindings analysis={analysis} delibId={id} />}

      {analysis && <VerificationSection result={analysis.verification} delibId={id} />}

      {kindMap.size > 0 && <ParticipantsSection positions={positions} kindMap={kindMap} delibId={id} />}

      {analysis?.compromise_proposal && !(analysis.integrity_warnings ?? []).some(w => w.startsWith('ANALYSIS_REFUSED')) && (
        <section className="report-section report-compromise" id={`delib-${id}-compromise`}>
          <h3>Compromise Proposal</h3>
          <p className="report-section-note">LLM-generated synthesis — treat as a starting point, not a conclusion.</p>
          <blockquote>{analysis.compromise_proposal}</blockquote>
        </section>
      )}
      {(analysis?.integrity_warnings ?? []).some(w => w.startsWith('ANALYSIS_REFUSED')) && (
        <section className="report-section report-compromise" id={`delib-${id}-compromise`}>
          <h3>Compromise Proposal</h3>
          <p className="report-section-note">Suppressed — analysis engine flagged integrity issues. Compromise proposals from compromised analysis are unreliable.</p>
        </section>
      )}

      {analysis && <ConsensusSection statements={analysis.consensus_statements ?? []} delibId={id} />}
      {analysis && <CruxSection cruxes={analysis.cruxes ?? []} kindMap={kindMap} delibId={id} />}
      {analysis && <BridgingSection statements={analysis.bridging_statements ?? []} delibId={id} />}
      {analysis && <TopicSection analysis={analysis} delibId={id} />}
      {(ds.analyses?.length ?? 0) > 1 && <EvolutionSection analyses={ds.analyses!} delibId={id} />}
      {positions.some(p => p.agent_id.endsWith('-r3')) && <PositionEvolutionSection positions={positions} delibId={id} />}
      {analysis && <IntegritySection warnings={analysis.integrity_warnings ?? []} discardedCruxes={analysis.discarded_cruxes} delibId={id} />}
      {analysis && <NullControlSection result={analysis.null_control} delibId={id} />}
      {analysis && <CoverageSection gaps={analysis.coverage_gaps} delibId={id} />}
      {analysis && <ReplicationSection result={analysis.replication} delibId={id} />}
      {analysis && <ReliabilitySection analysis={analysis} delibId={id} />}
      {analysis && <MethodologyNotes analysis={analysis} delibId={id} />}

      <LazyPositionSection positions={positions} agents={agents} delibId={id} />
    </article>
  );
}

const MemoizedDelibReport = memo(DelibReport);

function ConsensusSection({ statements, delibId }: { statements: ConsensusStatement[]; delibId: string }) {
  if (statements.length === 0) return null;
  return (
    <section className="report-section" id={`delib-${delibId}-consensus`}>
      <h3>Unchallenged Within This Agent Pool</h3>
      <p className="report-section-note">Positions on which no agent registered disagreement. These reflect the topology of this specific agent pool — not established truths or real-world expert consensus.</p>
      <ul className="report-list">
        {statements.map((c, i) => (
          <li key={i}>
            {c.content}
            <span className="report-badge report-badge-green" aria-label={`${Math.round(c.overall_agree_ratio * 100)} percent agreement`}>
              {Math.round(c.overall_agree_ratio * 100)}% agreement
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CruxSection({ cruxes, kindMap, delibId }: { cruxes: Crux[]; kindMap: Map<string, string>; delibId: string }) {
  if (cruxes.length === 0) return null;
  const sorted = [...cruxes].sort((a, b) => b.controversy_score - a.controversy_score);
  const hasTwoTrack = kindMap.size > 0;

  return (
    <section className="report-section" id={`delib-${delibId}-cruxes`}>
      <h3>Key Disagreements</h3>
      {sorted.map((crux, i) => {
        const agreeByKind = hasTwoTrack ? splitAgentsByKind(crux.agree_agents, kindMap) : null;
        const disagreeByKind = hasTwoTrack ? splitAgentsByKind(crux.disagree_agents, kindMap) : null;
        const showTwoTrack = hasTwoTrack && (
          (agreeByKind!.speakers.length > 0 || disagreeByKind!.speakers.length > 0) &&
          (agreeByKind!.structural.length > 0 || disagreeByKind!.structural.length > 0)
        );

        return (
          <div key={i} className="report-crux">
            <div className="report-crux-header">
              <span className="report-badge report-badge-red" aria-label={controversyLabel(crux.controversy_score, crux.agree_agents.length, crux.disagree_agents.length)}>
                {controversyLabel(crux.controversy_score, crux.agree_agents.length, crux.disagree_agents.length)}
              </span>
              <span className="report-crux-claim">{crux.crux_claim}</span>
            </div>
            {crux.explanation && <p className="report-crux-explanation">{crux.explanation}</p>}
            {showTwoTrack ? (
              <div className="report-crux-agents">
                {(agreeByKind!.speakers.length > 0 || disagreeByKind!.speakers.length > 0) && (
                  <div className="report-crux-track">
                    <span className="report-track-label">Speakers:</span>
                    {agreeByKind!.speakers.length > 0 && <span className="report-agents-agree">Agree: {agreeByKind!.speakers.map(a => shortAgentID(a)).join(', ')}</span>}
                    {disagreeByKind!.speakers.length > 0 && <span className="report-agents-disagree">Disagree: {disagreeByKind!.speakers.map(a => shortAgentID(a)).join(', ')}</span>}
                  </div>
                )}
                {(agreeByKind!.structural.length > 0 || disagreeByKind!.structural.length > 0) && (
                  <div className="report-crux-track">
                    <span className="report-track-label">Structural:</span>
                    {agreeByKind!.structural.length > 0 && <span className="report-agents-agree">Agree: {agreeByKind!.structural.map(a => shortAgentID(a)).join(', ')}</span>}
                    {disagreeByKind!.structural.length > 0 && <span className="report-agents-disagree">Disagree: {disagreeByKind!.structural.map(a => shortAgentID(a)).join(', ')}</span>}
                  </div>
                )}
              </div>
            ) : (
              <div className="report-crux-agents">
                {crux.agree_agents.length > 0 && (
                  <span className="report-agents-agree" aria-label="Agents who agree">Agree: {crux.agree_agents.map(a => shortAgentID(a)).join(', ')}</span>
                )}
                {crux.disagree_agents.length > 0 && (
                  <span className="report-agents-disagree" aria-label="Agents who disagree">Disagree: {crux.disagree_agents.map(a => shortAgentID(a)).join(', ')}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function BridgingSection({ statements, delibId }: { statements: BridgingStatement[]; delibId: string }) {
  if (!statements || statements.length === 0) return null;
  return (
    <section className="report-section" id={`delib-${delibId}-bridging`}>
      <h3>Bridging Positions</h3>
      <ul className="report-list">
        {statements.map((b, i) => (
          <li key={i}>
            {b.content}
            <span className="report-badge report-badge-blue">bridging {Math.round(b.bridging_score * 100)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Kind labels for display — maps internal kind to human-readable category */
const KIND_CATEGORIES: Record<string, { label: string; order: number }> = {
  steelman: { label: 'Clusters', order: 0 },
  speaker: { label: 'Speakers', order: 1 },
  probe: { label: 'Topic Probes', order: 2 },
  bridge: { label: 'Round 2 — Bridge', order: 3 },
  dissent: { label: 'Round 2 — Dissent', order: 4 },
  'empty-chair': { label: 'Round 2 — Empty Chair', order: 5 },
  resolution: { label: 'Round 3 — Resolution', order: 6 },
};

function ParticipantsSection({ positions, kindMap, delibId }: { positions: PositionType[]; kindMap: Map<string, string>; delibId: string }) {
  // Group agents by kind, deduplicate — R3 agents (e.g. agent-r3) map to base agent
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const p of positions) {
    // Strip -r3 suffix for dedup — the same speaker may have R1 and R3 positions
    const baseId = p.agent_id.replace(/-r3$/, '');
    if (seen.has(baseId)) continue;
    seen.add(baseId);
    const kind = kindMap.get(p.agent_id) ?? 'unknown';
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind)!.push(p.agent_id);
  }

  // Sort groups by category order
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const oa = KIND_CATEGORIES[a[0]]?.order ?? 99;
    const ob = KIND_CATEGORIES[b[0]]?.order ?? 99;
    return oa - ob;
  });

  const nSpeakerDerived = (groups.get('steelman')?.length ?? 0) + (groups.get('speaker')?.length ?? 0);
  const nStructural = [...groups.entries()]
    .filter(([k]) => isStructuralKind(k))
    .reduce((sum, [, agents]) => sum + agents.length, 0);

  return (
    <section className="report-section" id={`delib-${delibId}-participants`}>
      <h3>Participants</h3>
      <p className="report-section-note">Agents fall into two categories: speaker-derived (grounded in source claims) and structural (pipeline-generated to probe the discourse topology).</p>
      {sortedGroups.map(([kind, agents]) => (
        <div key={kind} className="report-participant-group">
          <span className="report-participant-label">
            {KIND_CATEGORIES[kind]?.label ?? kind}
            {isStructuralKind(kind) && <span className="report-badge report-badge-dim">structural</span>}
          </span>
          <span className="report-participant-agents">{agents.map(a => shortAgentID(a)).join(', ')}</span>
        </div>
      ))}
      <p className="report-findings-pipeline">{nSpeakerDerived} speaker-derived, {nStructural} structural agents</p>
    </section>
  );
}

function KeyFindings({ analysis, delibId }: { analysis: AnalysisResult; delibId: string }) {
  const cruxes = analysis.cruxes ?? [];
  const consensus = analysis.consensus_statements ?? [];
  if (cruxes.length === 0 && consensus.length === 0) return null;

  const topCruxes = [...cruxes].sort((a, b) => b.controversy_score - a.controversy_score).slice(0, 3);

  return (
    <section className="report-section" id={`delib-${delibId}-findings`}>
      <h3>Key Findings</h3>
      {topCruxes.length > 0 && (
        <>
          <p className="report-subsection-label">Top disagreements:</p>
          <ol className="report-findings-list">
            {topCruxes.map((c, i) => (
              <li key={i}>
                <span className="report-badge report-badge-red">{controversyLabel(c.controversy_score, c.agree_agents.length, c.disagree_agents.length)}</span>
                {' '}{c.crux_claim.length > 140 ? c.crux_claim.slice(0, 140) + '...' : c.crux_claim}
              </li>
            ))}
          </ol>
        </>
      )}
      {consensus.length > 0 && (
        <p className="report-findings-consensus">
          <strong>Common ground</strong> ({consensus.length} unchallenged position{consensus.length !== 1 ? 's' : ''}):
          {' '}{(consensus[0]?.content ?? '').length > 120 ? consensus[0]!.content.slice(0, 120) + '...' : consensus[0]!.content}
          {consensus.length > 1 && ` (+${consensus.length - 1} more)`}
        </p>
      )}
      <p className="report-findings-pipeline">
        {analysis.agent_count} agents · {analysis.position_count} positions · {(analysis.cruxes ?? []).length} cruxes · {analysis.confidence} confidence
      </p>
    </section>
  );
}

function VerificationSection({ result, delibId }: { result?: VerificationResult; delibId: string }) {
  if (!result || result.checked === 0) return null;
  const kept = result.checked - result.downgraded;
  const scoreLabels = ['', 'No relevant quotes', 'Tangentially related', 'Interpretation', 'Clearly aligned', 'Explicitly supported'];

  // Compute score_dist from details if the array is all zeros (some exports don't populate it)
  let scoreDist = result.score_dist ?? [0, 0, 0, 0, 0, 0];
  const distTotal = scoreDist.reduce((a, b) => a + b, 0);
  if (distTotal === 0 && result.details && result.details.length > 0) {
    scoreDist = [0, 0, 0, 0, 0, 0];
    for (const d of result.details) {
      if (d.score >= 1 && d.score <= 5) scoreDist[d.score] = (scoreDist[d.score] ?? 0) + 1;
    }
  }

  return (
    <section className="report-section" id={`delib-${delibId}-verification`}>
      <h3>Stance Verification</h3>
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
        <details className="report-topic-detail">
          <summary>Downgraded stances ({result.details.length})</summary>
          <div className="report-verify-details">
            {result.details.map((d, i) => (
              <div key={i} className="report-verify-detail">
                <strong>{shortAgentID(d.speaker)}</strong> ({d.orig_stance}, score {d.score}) on: {d.crux}
                {d.reason && <blockquote>{d.reason}</blockquote>}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function NullControlSection({ result, delibId }: { result?: NullControlResult; delibId: string }) {
  if (!result) return null;
  const r = result.real_metrics;
  const n = result.null_metrics;

  function delta(real: number, nul: number): string {
    if (real === 0 && nul === 0) return '—';
    if (real === 0) return `${nul > 0 ? '+' : ''}${nul}`;
    const pct = ((real - nul) / real) * 100;
    return `${pct >= 0 ? '+' : ''}${Math.round(pct)}%`;
  }

  return (
    <section className="report-section" id={`delib-${delibId}-null-control`}>
      <h3>Null Control</h3>
      <p className="report-section-note">Comparison against shuffled speaker-crux assignments. If the pipeline finds similar structure in shuffled data, real findings may be indistinguishable from noise.</p>
      <table className="report-table">
        <thead>
          <tr><th>Metric</th><th>Real Run</th><th>Null Control</th><th>Delta</th></tr>
        </thead>
        <tbody>
          <tr><td>Cruxes found</td><td>{r.crux_count}</td><td>{n.crux_count}</td><td>{delta(r.crux_count, n.crux_count)}</td></tr>
          <tr><td>Avg controversy</td><td>{r.avg_controversy.toFixed(2)}</td><td>{n.avg_controversy.toFixed(2)}</td><td>{delta(r.avg_controversy, n.avg_controversy)}</td></tr>
          <tr><td>Consensus statements</td><td>{r.consensus_count}</td><td>{n.consensus_count}</td><td>{delta(r.consensus_count, n.consensus_count)}</td></tr>
          <tr><td>Bridging proposals</td><td>{r.bridging_count}</td><td>{n.bridging_count}</td><td>{delta(r.bridging_count, n.bridging_count)}</td></tr>
          <tr><td>Clusters</td><td>{r.cluster_count}</td><td>{n.cluster_count}</td><td>{delta(r.cluster_count, n.cluster_count)}</td></tr>
          <tr><td>Confidence</td><td>{r.confidence}</td><td>{n.confidence}</td><td>—</td></tr>
        </tbody>
      </table>
      <p className={`report-verdict ${result.pass ? 'report-verdict-pass' : 'report-verdict-fail'}`}>
        <strong>Verdict:</strong> {result.pass
          ? 'Real run shows substantially different structure from null control.'
          : `Real run patterns are within 15% of null control on ${result.failed_metrics?.length ?? 0} metrics. Findings may be indistinguishable from noise.`
        }
      </p>
    </section>
  );
}

function CoverageSection({ gaps, delibId }: { gaps?: CoverageGap[]; delibId: string }) {
  if (!gaps || gaps.length === 0) return null;
  return (
    <section className="report-section" id={`delib-${delibId}-coverage`}>
      <h3>Missing Perspectives</h3>
      <p className="report-section-note">Automatically detected absent viewpoints that would likely challenge unchallenged or lopsided positions.</p>
      <ul className="report-list">
        {gaps.map((gap, i) => (
          <li key={i}>
            <strong>{gap.position}</strong>
            {gap.missing_perspective && <div className="report-gap-detail">Missing: {gap.missing_perspective}</div>}
            {gap.suggested_source && <div className="report-gap-detail">Would contest: {gap.suggested_source}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReplicationSection({ result, delibId }: { result?: ReplicationResult; delibId: string }) {
  if (!result || result.runs.length < 2) return null;
  const s = result.stability;
  return (
    <section className="report-section" id={`delib-${delibId}-replication`}>
      <h3>Replication</h3>
      <p className="report-section-note">{result.runs.length} replication runs with identical input (same agents, same votes — only LLM analysis varies).</p>
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
      <p className="report-stability">
        <strong>Stability (CV):</strong> crux count {s.crux_cv.toFixed(2)}, controversy {s.controv_cv.toFixed(2)}, consensus {s.consensus_cv.toFixed(2)}
      </p>
      <p className={s.all_stable ? 'report-verdict-pass' : 'report-verdict-fail'}>
        {s.all_stable
          ? 'All metrics stable (CV < 0.2). Findings are reproducible.'
          : 'Some metrics show high variance (CV >= 0.2). Findings should be interpreted with caution.'}
      </p>
    </section>
  );
}

function PositionEvolutionSection({ positions, delibId }: { positions: PositionType[]; delibId: string }) {
  // Find R3 agents and match to R1 originals by stripping -r3 suffix
  const r3Positions = positions.filter(p => p.agent_id.endsWith('-r3'));
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

  function firstLine(s: string): string {
    for (const line of s.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('SPEAKER:') || trimmed.startsWith('Stances:') ||
          trimmed.startsWith('Steelman') || trimmed.startsWith('Revised position') || trimmed.startsWith('REVISED POSITION') ||
          trimmed.startsWith('Probe') || trimmed.startsWith('Resolution:') || trimmed.startsWith('REQUIRES:') ||
          /^\*\*[A-Z].*\*\*:?$/.test(trimmed) || trimmed.startsWith('**What held') || trimmed.startsWith('**REVISED')) continue;
      return trimmed.length > 120 ? trimmed.slice(0, 117) + '...' : trimmed;
    }
    return s.length > 120 ? s.slice(0, 117) + '...' : s;
  }

  return (
    <section className="report-section" id={`delib-${delibId}-position-evolution`}>
      <h3>Position Evolution (R1 → R3)</h3>
      <p className="report-section-note">Speaker-derived agents revised their positions after seeing R2 findings.</p>
      {pairs.map((p, i) => (
        <div key={i} className="report-position-evolution">
          <strong>{p.name}</strong>
          <div className="report-evolution-comparison">
            <div className="report-evolution-round"><span className="report-badge report-badge-dim">R1</span> {firstLine(p.r1)}</div>
            <div className="report-evolution-round"><span className="report-badge report-badge-blue">R3</span> {firstLine(p.r3)}</div>
          </div>
        </div>
      ))}
    </section>
  );
}

function EvolutionSection({ analyses, delibId }: { analyses: AnalysisResult[]; delibId: string }) {
  if (analyses.length < 2) return null;
  const sorted = [...analyses].sort((a, b) => a.round_number - b.round_number);
  const r1 = sorted[0]!;
  const r2 = sorted.length >= 2 ? sorted[1]! : null;

  // New cruxes: claims in R2 not in R1
  const r1Claims = new Set((r1.cruxes ?? []).map(c => c.crux_claim));
  const newCruxes = r2 ? (r2.cruxes ?? []).filter(c => !r1Claims.has(c.crux_claim)) : [];

  // Topic taxonomy changes using topic_id
  const r1TopicsById = new Map((r1.topic_summaries ?? []).filter(t => t.topic_id).map(t => [t.topic_id!, t.topic]));
  const r1TopicNames = new Set((r1.topic_summaries ?? []).map(t => t.topic));
  const renamed: string[] = [];
  const added: string[] = [];
  const dropped: string[] = [];
  if (r2) {
    const r2TopicsById = new Map((r2.topic_summaries ?? []).filter(t => t.topic_id).map(t => [t.topic_id!, t.topic]));
    const r2TopicNames = new Set((r2.topic_summaries ?? []).map(t => t.topic));
    for (const [id, name] of r2TopicsById) {
      const r1Name = r1TopicsById.get(id);
      if (r1Name && r1Name !== name) renamed.push(`${id}: ${r1Name} → ${name}`);
      if (!r1TopicNames.has(name) && !r1Name) added.push(id ? `${id}: ${name}` : name);
    }
    for (const [id, name] of r1TopicsById) {
      if (!r2TopicsById.has(id) && !r2TopicNames.has(name)) dropped.push(id ? `${id}: ${name}` : name);
    }
  }

  const hasChanges = newCruxes.length > 0 || renamed.length > 0 || added.length > 0 || dropped.length > 0;
  if (!hasChanges) return null;

  return (
    <section className="report-section" id={`delib-${delibId}-evolution`}>
      <h3>Evolution (R1 → R{r2?.round_number ?? 2})</h3>
      {newCruxes.length > 0 && (
        <>
          <p className="report-subsection-label">New or refined cruxes:</p>
          <ul className="report-list">
            {newCruxes.map((c, i) => (
              <li key={i}>
                <span className="report-badge report-badge-red">{controversyLabel(c.controversy_score, c.agree_agents.length, c.disagree_agents.length)}</span>
                {' '}{c.crux_claim.length > 140 ? c.crux_claim.slice(0, 140) + '...' : c.crux_claim}
              </li>
            ))}
          </ul>
          <p className="report-section-note">R2 cruxes may be reworded versions of R1 cruxes. Exact string matching identifies new cruxes — some may be refinements.</p>
        </>
      )}
      {(renamed.length > 0 || added.length > 0 || dropped.length > 0) && (
        <>
          <p className="report-subsection-label">Topic taxonomy changes:</p>
          <ul className="report-list">
            {renamed.map((r, i) => <li key={`r${i}`}>Renamed: {r}</li>)}
            {added.map((a, i) => <li key={`a${i}`}>New in R2: {a}</li>)}
            {dropped.map((d, i) => <li key={`d${i}`}>Dropped from R1: {d}</li>)}
          </ul>
          <p className="report-section-note">Topic IDs persist across rounds. Renamed topics share the same ID.</p>
        </>
      )}
    </section>
  );
}

function IntegritySection({ warnings, discardedCruxes, delibId }: { warnings: string[]; discardedCruxes?: Crux[]; delibId: string }) {
  // Prefer structured discarded_cruxes from API; fall back to parsing DEGENERATE warnings
  const hasStructuredDiscarded = discardedCruxes && discardedCruxes.length > 0;
  const degenerateWarnings = warnings.filter(w => w.startsWith('DEGENERATE'));
  const other = warnings.filter(w => !w.startsWith('DEGENERATE') && !w.startsWith('ANALYSIS_REFUSED'));
  const showDiscarded = hasStructuredDiscarded || degenerateWarnings.length > 0;

  if (!showDiscarded && other.length === 0) return null;

  return (
    <>
      {showDiscarded && (
        <section className="report-section" id={`delib-${delibId}-discarded`}>
          <h3>Discarded Cruxes</h3>
          <p className="report-section-note">Cruxes where one side had zero agents after validation — typically due to an over-specified claim or a gap in the agent pool.</p>
          {hasStructuredDiscarded ? (
            discardedCruxes!.map((crux, i) => (
              <div key={i} className="report-crux report-crux-discarded">
                <div className="report-crux-header">
                  <span className="report-badge report-badge-dim">{discardReason(crux)}</span>
                  <span className="report-crux-claim">{crux.crux_claim}</span>
                </div>
                {crux.explanation && <p className="report-crux-explanation">{crux.explanation}</p>}
              </div>
            ))
          ) : (
            degenerateWarnings.map((w, i) => {
              const claim = w.replace(/^DEGENERATE: crux "/, '').replace(/" has no agents.*$/, '');
              return (
                <div key={i} className="report-crux report-crux-discarded">
                  <div className="report-crux-header">
                    <span className="report-badge report-badge-dim">{discardReason({ crux_claim: claim } as Crux)}</span>
                    <span className="report-crux-claim">{claim}</span>
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}
      {other.length > 0 && (
        <section className="report-section" id={`delib-${delibId}-integrity`}>
          <h3>Integrity Warnings</h3>
          <ul className="report-list">
            {other.map((w, i) => (
              <li key={i} className="report-integrity-warning">{w}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ReliabilitySection({ analysis, delibId }: { analysis: AnalysisResult; delibId: string }) {
  const keptCruxes = (analysis.cruxes ?? []).length;
  // Prefer structured discarded_cruxes; fall back to counting DEGENERATE warnings
  const discardedCount = (analysis.discarded_cruxes ?? []).length ||
    (analysis.integrity_warnings ?? []).filter(w => w.startsWith('DEGENERATE')).length;
  const totalCount = keptCruxes + discardedCount;
  const degenerateRate = totalCount > 0 ? (discardedCount / totalCount) * 100 : 0;

  let coherenceStatus: string;
  let coherenceClass: string;
  if (degenerateRate > 40) { coherenceStatus = 'fail'; coherenceClass = 'report-badge-red'; }
  else if (degenerateRate > 20) { coherenceStatus = 'partial'; coherenceClass = 'report-badge-yellow'; }
  else { coherenceStatus = 'pass'; coherenceClass = 'report-badge-green'; }

  const coherenceDetail = `${totalCount - discardedCount}/${totalCount} cruxes survived validation (${Math.round(degenerateRate)}% discard rate)`;

  // Hallucination corrections — parsed from HALLUCINATION: warnings
  const hallucinationCount = (analysis.integrity_warnings ?? []).filter(w => w.startsWith('HALLUCINATION')).length;
  let hallucinationStatus: string;
  let hallucinationClass: string;
  let hallucinationDetail: string;
  if (hallucinationCount >= 10) {
    hallucinationStatus = 'high'; hallucinationClass = 'report-badge-red';
    hallucinationDetail = `${hallucinationCount} phantom agents removed — manual audit recommended`;
  } else if (hallucinationCount >= 4) {
    hallucinationStatus = 'moderate'; hallucinationClass = 'report-badge-yellow';
    hallucinationDetail = `${hallucinationCount} phantom agents removed`;
  } else if (hallucinationCount >= 1) {
    hallucinationStatus = 'minor'; hallucinationClass = 'report-badge-dim';
    hallucinationDetail = `${hallucinationCount} phantom agent(s) removed`;
  } else {
    hallucinationStatus = 'none'; hallucinationClass = 'report-badge-green';
    hallucinationDetail = 'No phantom agents removed';
  }

  return (
    <section className="report-section" id={`delib-${delibId}-reliability`}>
      <h3>Reliability</h3>
      <table className="report-table">
        <thead>
          <tr><th>Dimension</th><th>Status</th><th>Detail</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Internal coherence</td>
            <td><span className={`report-badge ${coherenceClass}`}>{coherenceStatus}</span></td>
            <td>{coherenceDetail}</td>
          </tr>
          <tr>
            <td>Agent hallucinations</td>
            <td><span className={`report-badge ${hallucinationClass}`}>{hallucinationStatus}</span></td>
            <td>{hallucinationDetail}</td>
          </tr>
          {analysis.verification ? (() => {
            const vf = analysis.verification;
            const kept = vf.checked - vf.downgraded;
            const vfLabel = vf.downgraded > 0 ? 'cleaned' : 'pass';
            const vfClass = vf.downgraded > 0 ? 'report-badge-yellow' : 'report-badge-green';
            const vfDetail = vf.downgraded > 0
              ? `${kept}/${vf.checked} kept (score 4-5), ${vf.downgraded} downgraded (score 1-3)`
              : `All ${vf.checked} stances scored 4-5 against source quotes`;
            return (
              <tr>
                <td>Stance grounding</td>
                <td><span className={`report-badge ${vfClass}`}>{vfLabel}</span></td>
                <td>{vfDetail}</td>
              </tr>
            );
          })() : null}
          {analysis.null_control ? (
            <tr>
              <td>Null control</td>
              <td><span className={`report-badge ${analysis.null_control.pass ? 'report-badge-green' : 'report-badge-red'}`}>
                {analysis.null_control.pass ? 'pass' : 'fail'}
              </span></td>
              <td>{analysis.null_control.pass
                ? 'Real run distinguishable from shuffled null control'
                : `${analysis.null_control.failed_metrics?.length ?? 0} metrics indistinguishable from noise`
              }</td>
            </tr>
          ) : (
            <tr>
              <td>Null control</td>
              <td><span className="report-badge report-badge-dim">untested</span></td>
              <td>Run with null control to validate signal vs. noise</td>
            </tr>
          )}
          {analysis.replication && analysis.replication.runs.length >= 2 ? (() => {
            const s = analysis.replication.stability;
            const repLabel = s.all_stable ? 'pass' : 'partial';
            const repClass = s.all_stable ? 'report-badge-green' : 'report-badge-yellow';
            const repDetail = s.all_stable
              ? `${analysis.replication.runs.length} runs, all CV < 0.2`
              : `${analysis.replication.runs.length} runs, some metrics unstable`;
            return (
              <tr>
                <td>Replication stability</td>
                <td><span className={`report-badge ${repClass}`}>{repLabel}</span></td>
                <td>{repDetail}</td>
              </tr>
            );
          })() : (
            <tr>
              <td>Replication stability</td>
              <td><span className="report-badge report-badge-dim">untested</span></td>
              <td>Single run — re-run to test cross-run stability</td>
            </tr>
          )}
          <tr>
            <td>Grounding fidelity</td>
            <td><span className="report-badge report-badge-dim">unchecked</span></td>
            <td>Agent stances not yet spot-checked against primary sources</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function MethodologyNotes({ analysis, delibId }: { analysis: AnalysisResult; delibId: string }) {
  return (
    <section className="report-section report-methodology" id={`delib-${delibId}-methodology`}>
      <h3>Methodology Notes</h3>
      <p><strong>Score interpretation:</strong> Crux scores reflect the proportion of participating agents that agree vs. disagree.
        With {analysis.agent_count} agents, these scores indicate the topology of the discourse, not the strength of evidence or real-world expert consensus.
        Ordinal labels are used instead of raw percentages.</p>
      <p><strong>Multiple comparisons:</strong> This analysis tests multiple cruxes simultaneously without correction for multiple comparisons.
        With {(analysis.cruxes ?? []).length}+ cruxes across a small agent pool, some apparent disagreements may be artefacts of the generation process.</p>
      <p><strong>Replicability:</strong> {analysis.replication && analysis.replication.runs.length >= 2
        ? `This analysis was replicated across ${analysis.replication.runs.length} runs. ${analysis.replication.stability.all_stable ? 'Cross-run metrics are stable.' : 'Some metrics showed high variance.'}`
        : 'This is a single pipeline run. LLM outputs are stochastic — a second run on the same input will produce different crux wordings, scores, and topic labels.'
      }</p>
    </section>
  );
}

function TopicSection({ analysis, delibId }: { analysis: AnalysisResult; delibId: string }) {
  const topics = analysis.topic_summaries ?? [];
  if (topics.length === 0) return null;
  return (
    <section className="report-section" id={`delib-${delibId}-topics`}>
      <h3>Topics</h3>
      {topics.map((t, i) => (
        <details key={i} className="report-topic-detail">
          <summary>{t.topic_id ? `${t.topic_id}: ${t.topic}` : t.topic}</summary>
          <p>{t.summary}</p>
        </details>
      ))}
    </section>
  );
}

/** Lazy-loaded position section — content only rendered when expanded. */
function LazyPositionSection({ positions, agents, delibId }: { positions: DelibState['positions']; agents: DelibState['agents']; delibId: string }) {
  if (!positions || positions.length === 0) return null;
  const agentNames = new Map((agents ?? []).map(a => [a.id, shortAgentID(a.id)]));

  return (
    <section className="report-section" id={`delib-${delibId}-positions`}>
      <h3>Agent Positions</h3>
      {positions.map((p, i) => (
        <LazyPosition key={p.position_id ?? i} name={agentNames.get(p.agent_id) ?? p.agent_id} content={p.content} />
      ))}
    </section>
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
