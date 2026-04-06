import { describe, it, expect } from 'vitest';
import { countDisagreements, buildRFNodes, buildRFEdges } from '../graphData';
import type { DelibState, Graph, NodePosition } from '../../types';

function makeDelib(overrides: Partial<DelibState> = {}): DelibState {
  return {
    deliberation: { deliberation_id: 'd1', topic: 'test', description: '', status: 'open' as const, created_at: '', round_number: 1 },
    positions: [],
    votes: [],
    agents: [
      { id: 'a1', model_family: 'test', conviction: 0.5 },
      { id: 'a2', model_family: 'test', conviction: 0.5 },
    ],
    ...overrides,
  };
}

describe('countDisagreements', () => {
  it('returns 0 when no analysis', () => {
    const delibs = { d1: makeDelib() };
    expect(countDisagreements(delibs, 'a1', 'a2')).toBe(0);
  });

  it('counts cruxes where agents disagree', () => {
    const delibs = {
      d1: makeDelib({
        analysis: {
          deliberation_id: 'd1', round_number: 1, clusters: [], cruxes: [
            { crux_claim: 'c1', topic: 't', subtopic: 's', agree_agents: ['a1'], disagree_agents: ['a2'], no_clear_position: [], controversy_score: 0.8, explanation: '' },
            { crux_claim: 'c2', topic: 't', subtopic: 's', agree_agents: ['a2'], disagree_agents: ['a1'], no_clear_position: [], controversy_score: 0.6, explanation: '' },
          ],
          consensus_statements: [], topic_summaries: [], agent_count: 2, position_count: 0, vote_count: 0, confidence: 'high',
        },
      }),
    };
    expect(countDisagreements(delibs, 'a1', 'a2')).toBe(2);
  });

  it('does not count when both agree', () => {
    const delibs = {
      d1: makeDelib({
        analysis: {
          deliberation_id: 'd1', round_number: 1, clusters: [], cruxes: [
            { crux_claim: 'c1', topic: 't', subtopic: 's', agree_agents: ['a1', 'a2'], disagree_agents: [], no_clear_position: [], controversy_score: 0.1, explanation: '' },
          ],
          consensus_statements: [], topic_summaries: [], agent_count: 2, position_count: 0, vote_count: 0, confidence: 'high',
        },
      }),
    };
    expect(countDisagreements(delibs, 'a1', 'a2')).toBe(0);
  });

  it('counts across multiple delibs', () => {
    const crux = { crux_claim: 'c', topic: 't', subtopic: 's', agree_agents: ['a1'], disagree_agents: ['a2'], no_clear_position: [], controversy_score: 0.5, explanation: '' };
    const analysis = { deliberation_id: 'd', round_number: 1, clusters: [], cruxes: [crux], consensus_statements: [], topic_summaries: [], agent_count: 2, position_count: 0, vote_count: 0, confidence: 'high' as const };
    const delibs = {
      d1: makeDelib({ analysis: { ...analysis, deliberation_id: 'd1' } }),
      d2: makeDelib({ analysis: { ...analysis, deliberation_id: 'd2' } }),
    };
    expect(countDisagreements(delibs, 'a1', 'a2')).toBe(2);
  });
});

describe('buildRFNodes', () => {
  const graph: Graph = {
    nodes: ['a1', 'a2'],
    edges: [{ a: 'a1', b: 'a2', delibID: 'd1' }],
    groupDelibID: null,
    groups: [],
  };
  const positions: NodePosition[] = [
    { id: 'a1', x: 20, y: 40 },
    { id: 'a2', x: 80, y: 40 },
  ];

  it('builds nodes with correct positions', () => {
    const nodes = buildRFNodes(positions, graph, {}, null);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.id).toBe('a1');
    expect(nodes[0]!.position.x).toBeCloseTo(320); // 20/100 * 1600
    expect(nodes[0]!.position.y).toBeCloseTo(360); // 40/100 * 900
  });

  it('counts messages from filtered delibs', () => {
    const delibs = { d1: makeDelib({ positions: [
      { position_id: 'p1', agent_id: 'a1', content: 'hi', deliberation_id: 'd1', round_number: 1, created_at: '' },
      { position_id: 'p2', agent_id: 'a2', content: 'yo', deliberation_id: 'd1', round_number: 1, created_at: '' },
    ]}) };
    const nodes = buildRFNodes(positions, graph, delibs, null);
    expect(nodes[0]!.data.totalMessages).toBe(2);
    expect(nodes[0]!.data.activeGemots).toBe(1);
  });

  it('marks edge agents in single-delib mode', () => {
    const nodes = buildRFNodes(positions, graph, {}, 'd1');
    expect(nodes[0]!.data.isEdgeAgent).toBe(true);
    expect(nodes[1]!.data.isEdgeAgent).toBe(true);
  });

  it('finds vote direction', () => {
    const delibs = { d1: makeDelib({ votes: [
      { vote_id: 'v1', agent_id: 'a1', value: 1, deliberation_id: 'd1', position_id: 'p1', created_at: '' },
    ]}) };
    const nodes = buildRFNodes(positions, graph, delibs, 'd1');
    expect(nodes[0]!.data.voteDirection).toBe(1);
    expect(nodes[1]!.data.voteDirection).toBeUndefined();
  });

  it('finds cluster ID', () => {
    const delibs = { d1: makeDelib({ agents: [
      { id: 'a1', model_family: 'test', conviction: 0.5, cluster_id: 0 },
      { id: 'a2', model_family: 'test', conviction: 0.5, cluster_id: 1 },
    ]}) };
    const nodes = buildRFNodes(positions, graph, delibs, null);
    expect(nodes[0]!.data.clusterId).toBe(0);
    expect(nodes[1]!.data.clusterId).toBe(1);
  });
});

describe('buildRFEdges', () => {
  const graph: Graph = {
    nodes: ['a1', 'a2', 'a3'],
    edges: [
      { a: 'a1', b: 'a2', delibID: 'd1' },
      { a: 'a2', b: 'a3', delibID: 'd2' },
    ],
    groupDelibID: null,
    groups: [],
  };

  it('builds edges with position counts', () => {
    const delibs = { d1: makeDelib({ positions: [
      { position_id: 'p1', agent_id: 'a1', content: 'x', deliberation_id: 'd1', round_number: 1, created_at: '' },
    ]}) };
    const edges = buildRFEdges(graph, delibs, null);
    expect(edges).toHaveLength(2);
    expect(edges[0]!.data!.posCount).toBe(1);
    expect(edges[1]!.data!.posCount).toBe(0);
  });

  it('highlights active edge in multi-delib mode', () => {
    const edges = buildRFEdges(graph, {}, 'd1');
    expect(edges[0]!.data!.highlighted).toBe(true);
    expect(edges[1]!.data!.highlighted).toBe(false);
  });

  it('does not highlight in single-delib mode', () => {
    const singleGraph: Graph = { ...graph, edges: [{ a: 'a1', b: 'a2', delibID: 'd1' }] };
    const edges = buildRFEdges(singleGraph, {}, 'd1');
    expect(edges[0]!.data!.highlighted).toBe(false);
  });

  it('detects consensus', () => {
    const delibs = { d1: makeDelib({ analysis: {
      deliberation_id: 'd1', round_number: 1, clusters: [], cruxes: [],
      consensus_statements: [{ position_id: 'p1', content: 'agree', overall_agree_ratio: 0.85, min_cluster_agree_ratio: 0.7 }],
      topic_summaries: [], agent_count: 2, position_count: 1, vote_count: 0, confidence: 'high',
    }}) };
    const edges = buildRFEdges(graph, delibs, null);
    expect(edges[0]!.data!.hasConsensus).toBe(true);
    expect(edges[1]!.data!.hasConsensus).toBe(false);
  });
});
