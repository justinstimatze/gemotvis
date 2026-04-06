import type { DelibState } from '../types';

/** Summarize each agent's aggregate vote: +1 (agree), -1 (disagree), 0 (neutral). */
export function buildVoteMap(ds: DelibState): Record<string, -1 | 0 | 1> {
  const votes = ds.votes || [];
  const agentVotes: Record<string, number[]> = {};

  for (const v of votes) {
    if (!agentVotes[v.agent_id]) agentVotes[v.agent_id] = [];
    agentVotes[v.agent_id]!.push(v.value);
  }

  const result: Record<string, -1 | 0 | 1> = {};
  for (const [agent, vals] of Object.entries(agentVotes)) {
    const sum = vals.reduce((a, b) => a + b, 0);
    result[agent] = sum > 0 ? 1 : sum < 0 ? -1 : 0;
  }
  return result;
}

export type Relationship = 'agree' | 'disagree' | 'neutral';

/** Classify agent pair relationships based on vote agreement. */
export function buildPairwiseRelationship(ds: DelibState): Record<string, Relationship> {
  const votes = ds.votes || [];
  const byPosition: Record<string, Record<string, number>> = {};

  for (const v of votes) {
    if (!byPosition[v.position_id]) byPosition[v.position_id] = {};
    byPosition[v.position_id]![v.agent_id] = v.value;
  }

  const agents = (ds.agents || []).map(a => a.id);
  const pairScores: Record<string, Relationship> = {};

  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      let agree = 0, disagree = 0;
      for (const posVotes of Object.values(byPosition)) {
        const vi = posVotes[agents[i]!];
        const vj = posVotes[agents[j]!];
        if (vi !== undefined && vj !== undefined) {
          if (vi === vj) agree++;
          else if (vi === -vj) disagree++;
        }
      }
      const key = `${agents[i]}|${agents[j]}`;
      if (agree > disagree) pairScores[key] = 'agree';
      else if (disagree > agree) pairScores[key] = 'disagree';
      else pairScores[key] = 'neutral';
    }
  }

  return pairScores;
}
