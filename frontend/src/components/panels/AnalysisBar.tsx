import type { DelibState } from '../../types';

const STAGES = ['taxonomy', 'extracting', 'deduplicating', 'crux_detection', 'summarizing', 'complete'];
const STAGE_LABELS: Record<string, string> = {
  taxonomy: 'Taxonomy',
  extracting: 'Extracting',
  deduplicating: 'Deduplicating',
  crux_detection: 'Crux Detection',
  summarizing: 'Summarizing',
  complete: 'Complete',
};

interface AnalysisBarProps {
  ds: DelibState | null;
}

export function AnalysisBar({ ds }: AnalysisBarProps) {
  if (!ds || ds.deliberation?.status !== 'analyzing') return null;

  const subStatus = ds.deliberation?.sub_status ?? '';
  const currentIdx = STAGES.indexOf(subStatus);

  return (
    <div className="analysis-bar" id="analysis-bar">
      <div className="pipeline">
        {STAGES.map((stage, i) => {
          const isDone = i < currentIdx;
          const isActive = i === currentIdx;
          return (
            <div
              key={stage}
              className={`pipeline-stage ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}
            >
              {STAGE_LABELS[stage] ?? stage}
            </div>
          );
        })}
      </div>
    </div>
  );
}
