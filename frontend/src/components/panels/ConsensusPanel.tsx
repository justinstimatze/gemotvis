import type { DelibState } from '../../types';
import { PanelWrapper } from './PanelWrapper';

interface ConsensusPanelProps {
  ds: DelibState | null;
}

export function ConsensusPanel({ ds }: ConsensusPanelProps) {
  const consensus = ds?.analysis?.consensus_statements ?? [];
  const bridging = ds?.analysis?.bridging_statements ?? [];
  const compromise = ds?.analysis?.compromise_proposal;

  const items = [
    ...consensus.map(c => ({
      text: c.content,
      meta: `${Math.round(c.overall_agree_ratio * 100)}% agreement`,
      type: 'consensus' as const,
    })),
    ...bridging.map(b => ({
      text: b.content,
      meta: `bridging ${Math.round(b.bridging_score * 100)}%`,
      type: 'bridging' as const,
    })),
  ];

  return (
    <PanelWrapper className="consensus-panel" title="Consensus" emptyText="No consensus yet" isEmpty={items.length === 0 && !compromise}>
      {compromise && (
        <div className="consensus-item consensus-compromise">
          {compromise.length > 80 ? compromise.slice(0, 78) + '...' : compromise}
        </div>
      )}
      {items.map((item, i) => (
        <div key={i} className={`consensus-item consensus-${item.type}`}>
          <span className="consensus-text">{item.text.length > 80 ? item.text.slice(0, 78) + '...' : item.text}</span>
          <span className="consensus-meta">{item.meta}</span>
        </div>
      ))}
    </PanelWrapper>
  );
}
