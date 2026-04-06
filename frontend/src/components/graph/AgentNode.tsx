import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { useThemeStore } from '../../stores/theme';
import { useGraphStore } from '../../stores/graph';
import { shortAgentID } from '../../lib/helpers';
import { agentColor } from '../../lib/color';

export interface AgentNodeData extends Record<string, unknown> {
  agentId: string;
  totalMessages: number;
  activeGemots: number;
  agentIndex: number;
  agentCount: number;
  isEdgeAgent: boolean;
  sideClass: string;
  clusterId?: number;       // opinion cluster from analysis
  voteDirection?: -1 | 0 | 1; // aggregate vote
  bridgingScore: number;    // best bridging score (0-1)
}

type AgentNodeType = Node<AgentNodeData, 'agent'>;

const voteLabels: Record<number, string> = { [-1]: 'Disagree', 0: 'Neutral', 1: 'Agree' };

function AgentNodeComponent({ data }: NodeProps<AgentNodeType>) {
  const theme = useThemeStore((s) => s.activeTheme);
  const animationPhase = useGraphStore((s) => s.animationPhase);

  const name = shortAgentID(data.agentId);
  const color = agentColor(data.agentIndex, data.agentCount, theme);
  const showActive = data.isEdgeAgent && animationPhase === 'ready';
  const isQuiet = data.activeGemots === 0;

  const classes = [
    'agent-node',
    showActive ? 'agent-node-active' : '',
    showActive ? data.sideClass : '',
    isQuiet ? 'agent-node-quiet' : '',
  ].filter(Boolean).join(' ');

  // Cluster colors — consistent across themes
  const clusterColors = ['#0070f3', '#7c3aed', '#17b169', '#f5a623', '#ef4444', '#0091ff'];
  const clusterColor = data.clusterId != null ? clusterColors[data.clusterId % clusterColors.length] : undefined;

  return (
    <div className={classes}>
      <Handle type="source" position={Position.Top} id="s" className="agent-handle" />
      <Handle type="target" position={Position.Top} id="t" className="agent-handle" />
      <div
        className="agent-node-icon"
        style={{
          borderColor: showActive ? color : clusterColor ?? undefined,
          boxShadow: clusterColor && !showActive ? `0 0 0 3px ${clusterColor}33` : undefined,
        }}
      >
        <span className="agent-node-letter">{name.charAt(0).toUpperCase()}</span>
      </div>
      <div className="agent-node-name">{name}</div>
      {data.voteDirection != null && (
        <div className={`agent-node-vote vote-${data.voteDirection === 1 ? 'agree' : data.voteDirection === -1 ? 'disagree' : 'neutral'}`}
          title={voteLabels[data.voteDirection]}>
          {data.voteDirection === 1 ? '\u2713' : data.voteDirection === -1 ? '\u2717' : '\u2014'}
        </div>
      )}
      {data.activeGemots > 0 && !data.voteDirection && (
        <div className="agent-node-stats">
          {data.totalMessages} msg &middot; {data.activeGemots} gemot{data.activeGemots !== 1 ? 's' : ''}
        </div>
      )}
      {data.bridgingScore >= 0.6 && (
        <div className="agent-node-bridging" title={`Bridging score: ${Math.round(data.bridgingScore * 100)}%`}>
          &#9878;
        </div>
      )}
      <Tooltip data={data} />
    </div>
  );
}

function Tooltip({ data }: { data: AgentNodeData }) {
  const lines = useMemo(() => {
    const l: string[] = [];
    if (data.totalMessages > 0) l.push(`${data.totalMessages} messages`);
    if (data.activeGemots > 0) l.push(`${data.activeGemots} deliberation${data.activeGemots > 1 ? 's' : ''}`);
    if (data.voteDirection != null) l.push(`Vote: ${voteLabels[data.voteDirection] ?? '?'}`);
    if (data.clusterId != null) l.push(`Cluster ${data.clusterId + 1}`);
    if (data.bridgingScore > 0) l.push(`Bridging: ${Math.round(data.bridgingScore * 100)}%`);
    return l;
  }, [data.totalMessages, data.activeGemots, data.voteDirection, data.clusterId, data.bridgingScore]);

  if (lines.length === 0) return null;

  return (
    <div className="agent-tooltip">
      {lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
