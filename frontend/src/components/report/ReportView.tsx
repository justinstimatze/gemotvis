import { useMemo } from 'react';
import { useSessionStore } from '../../stores/session';
import { shortAgentID } from '../../lib/helpers';
import type { DelibState, AnalysisResult, Crux, ConsensusStatement, BridgingStatement } from '../../types';

/** Static report view — renders deliberation analysis as a readable document. */
export function ReportView() {
  const deliberations = useSessionStore((s) => s.deliberations);

  const delibEntries = useMemo(() => {
    return Object.entries(deliberations)
      .filter(([, ds]) => (ds.positions?.length ?? 0) > 0)
      .sort((a, b) => {
        const ta = a[1].deliberation?.topic ?? '';
        const tb = b[1].deliberation?.topic ?? '';
        return ta.localeCompare(tb);
      });
  }, [deliberations]);

  if (delibEntries.length === 0) {
    return (
      <div className="report-loading">
        <p>Waiting for deliberation data...</p>
      </div>
    );
  }

  // Single delib: full report. Multiple: table of contents + sections.
  const isMulti = delibEntries.length > 1;

  return (
    <div className="report-view">
      {isMulti && (
        <nav className="report-toc">
          <h2>Deliberations</h2>
          <ol>
            {delibEntries.map(([id, ds]) => (
              <li key={id}>
                <a href={`#delib-${id}`}>{ds.deliberation?.topic ?? id}</a>
                <span className="report-toc-meta">
                  {ds.positions?.length ?? 0} positions · {ds.agents?.length ?? 0} agents
                  {ds.analysis ? ' · analyzed' : ''}
                </span>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {delibEntries.map(([id, ds]) => (
        <DelibReport key={id} id={id} ds={ds} showTitle={isMulti} />
      ))}
    </div>
  );
}

function DelibReport({ id, ds, showTitle }: { id: string; ds: DelibState; showTitle: boolean }) {
  const topic = ds.deliberation?.topic ?? id;
  const analysis = ds.analysis;
  const positions = ds.positions ?? [];
  const agents = ds.agents ?? [];

  return (
    <article className="report-delib" id={`delib-${id}`}>
      <header className="report-header">
        {showTitle && <h2 className="report-topic">{topic}</h2>}
        {!showTitle && <h1 className="report-topic">{topic}</h1>}
        <div className="report-meta">
          {agents.length} agents · {positions.length} positions
          {ds.deliberation?.status && <span className="report-status">{ds.deliberation.status}</span>}
          {analysis && <span className="report-confidence">{analysis.confidence} confidence</span>}
        </div>
      </header>

      {analysis?.compromise_proposal && (
        <section className="report-section report-compromise">
          <h3>Compromise Proposal</h3>
          <blockquote>{analysis.compromise_proposal}</blockquote>
        </section>
      )}

      {analysis && <ConsensusSection statements={analysis.consensus_statements ?? []} />}
      {analysis && <CruxSection cruxes={analysis.cruxes ?? []} />}
      {analysis && <BridgingSection statements={analysis.bridging_statements ?? []} />}
      {analysis && <TopicSection analysis={analysis} />}

      <PositionSection positions={positions} agents={agents} />
    </article>
  );
}

function ConsensusSection({ statements }: { statements: ConsensusStatement[] }) {
  if (statements.length === 0) return null;
  return (
    <section className="report-section">
      <h3>Consensus</h3>
      <ul className="report-list">
        {statements.map((c, i) => (
          <li key={i}>
            {c.content}
            <span className="report-badge report-badge-green">{Math.round(c.overall_agree_ratio * 100)}% agreement</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CruxSection({ cruxes }: { cruxes: Crux[] }) {
  if (cruxes.length === 0) return null;
  const sorted = [...cruxes].sort((a, b) => b.controversy_score - a.controversy_score);
  return (
    <section className="report-section">
      <h3>Key Disagreements</h3>
      {sorted.map((crux, i) => (
        <div key={i} className="report-crux">
          <div className="report-crux-header">
            <span className="report-badge report-badge-red">{Math.round(crux.controversy_score * 100)}%</span>
            <span className="report-crux-claim">{crux.crux_claim}</span>
          </div>
          {crux.explanation && <p className="report-crux-explanation">{crux.explanation}</p>}
          <div className="report-crux-agents">
            {crux.agree_agents.length > 0 && (
              <span className="report-agents-agree">Agree: {crux.agree_agents.map(a => shortAgentID(a)).join(', ')}</span>
            )}
            {crux.disagree_agents.length > 0 && (
              <span className="report-agents-disagree">Disagree: {crux.disagree_agents.map(a => shortAgentID(a)).join(', ')}</span>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function BridgingSection({ statements }: { statements: BridgingStatement[] }) {
  if (!statements || statements.length === 0) return null;
  return (
    <section className="report-section">
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

function TopicSection({ analysis }: { analysis: AnalysisResult }) {
  const topics = analysis.topic_summaries ?? [];
  if (topics.length === 0) return null;
  return (
    <section className="report-section">
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

function PositionSection({ positions, agents }: { positions: DelibState['positions']; agents: DelibState['agents'] }) {
  if (!positions || positions.length === 0) return null;
  const agentNames = new Map((agents ?? []).map(a => [a.id, shortAgentID(a.id)]));

  return (
    <section className="report-section">
      <h3>Agent Positions</h3>
      {positions.map((p, i) => (
        <details key={p.position_id ?? i} className="report-position">
          <summary>{agentNames.get(p.agent_id) ?? p.agent_id}</summary>
          <div className="report-position-content">{p.content}</div>
        </details>
      ))}
    </section>
  );
}
