import { memo } from 'react';
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
  sideClass: string; // 'graph-node-left' | 'graph-node-right' | ''
}

type AgentNodeType = Node<AgentNodeData, 'agent'>;

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

  return (
    <div className={classes}>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        className="agent-node-icon"
        style={{ borderColor: showActive ? color : undefined }}
      >
        <span className="agent-node-letter">{name.charAt(0).toUpperCase()}</span>
      </div>
      <div className="agent-node-name">{name}</div>
      {data.activeGemots > 0 && (
        <div className="agent-node-stats">
          {data.totalMessages} msg &middot; {data.activeGemots} gemot{data.activeGemots !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
