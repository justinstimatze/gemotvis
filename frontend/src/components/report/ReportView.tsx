import { memo, useMemo, useState, useCallback } from 'react';
import { useSessionStore } from '../../stores/session';
import { shortAgentID } from '../../lib/helpers';
import type { DelibState, AnalysisResult, Crux, ConsensusStatement, BridgingStatement } from '../../types';

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

      {analysis?.compromise_proposal && (
        <section className="report-section report-compromise" id={`delib-${id}-compromise`}>
          <h3>Compromise Proposal</h3>
          <blockquote>{analysis.compromise_proposal}</blockquote>
        </section>
      )}

      {analysis && <ConsensusSection statements={analysis.consensus_statements ?? []} delibId={id} />}
      {analysis && <CruxSection cruxes={analysis.cruxes ?? []} delibId={id} />}
      {analysis && <BridgingSection statements={analysis.bridging_statements ?? []} delibId={id} />}
      {analysis && <TopicSection analysis={analysis} delibId={id} />}

      <LazyPositionSection positions={positions} agents={agents} delibId={id} />
    </article>
  );
}

const MemoizedDelibReport = memo(DelibReport);

function ConsensusSection({ statements, delibId }: { statements: ConsensusStatement[]; delibId: string }) {
  if (statements.length === 0) return null;
  return (
    <section className="report-section" id={`delib-${delibId}-consensus`}>
      <h3>Consensus</h3>
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

function CruxSection({ cruxes, delibId }: { cruxes: Crux[]; delibId: string }) {
  if (cruxes.length === 0) return null;
  const sorted = [...cruxes].sort((a, b) => b.controversy_score - a.controversy_score);
  return (
    <section className="report-section" id={`delib-${delibId}-cruxes`}>
      <h3>Key Disagreements</h3>
      {sorted.map((crux, i) => (
        <div key={i} className="report-crux">
          <div className="report-crux-header">
            <span className="report-badge report-badge-red" aria-label={`${Math.round(crux.controversy_score * 100)} percent controversy`}>
              {Math.round(crux.controversy_score * 100)}%
            </span>
            <span className="report-crux-claim">{crux.crux_claim}</span>
          </div>
          {crux.explanation && <p className="report-crux-explanation">{crux.explanation}</p>}
          <div className="report-crux-agents">
            {crux.agree_agents.length > 0 && (
              <span className="report-agents-agree" aria-label="Agents who agree">Agree: {crux.agree_agents.map(a => shortAgentID(a)).join(', ')}</span>
            )}
            {crux.disagree_agents.length > 0 && (
              <span className="report-agents-disagree" aria-label="Agents who disagree">Disagree: {crux.disagree_agents.map(a => shortAgentID(a)).join(', ')}</span>
            )}
          </div>
        </div>
      ))}
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

function TopicSection({ analysis, delibId }: { analysis: AnalysisResult; delibId: string }) {
  const topics = analysis.topic_summaries ?? [];
  if (topics.length === 0) return null;
  return (
    <section className="report-section" id={`delib-${delibId}-topics`}>
      <h3>Topics</h3>
      {topics.map((t, i) => (
        <details key={i} className="report-topic-detail">
          <summary>{t.topic}</summary>
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
