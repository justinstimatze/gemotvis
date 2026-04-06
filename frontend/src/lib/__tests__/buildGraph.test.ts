import { describe, it, expect } from 'vitest';
import { buildGraphFromDelibs } from '../buildGraph';
import type { DelibState } from '../../types';

function makeDelib(id: string, agentIds: string[]): DelibState {
  return {
    deliberation: { deliberation_id: id, topic: id, description: '', round_number: 1, status: 'open', created_at: '' },
    positions: [],
    votes: [],
    agents: agentIds.map(aid => ({ id: aid, model_family: '', conviction: 0 })),
  };
}

describe('buildGraphFromDelibs', () => {
  it('bilateral creates one edge', () => {
    const g = buildGraphFromDelibs({ d1: makeDelib('d1', ['a', 'b']) });
    expect(g.nodes).toEqual(['a', 'b']);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toEqual({ a: 'a', b: 'b', delibID: 'd1' });
  });

  it('3-agent delib with no bilaterals creates pairwise edges', () => {
    const g = buildGraphFromDelibs({ d1: makeDelib('d1', ['a', 'b', 'c']) });
    expect(g.edges).toHaveLength(3);
    expect(g.groupDelibID).toBe('d1');
  });

  it('mixed bilaterals and group creates edges from both', () => {
    const g = buildGraphFromDelibs({
      bi: makeDelib('bi', ['a', 'b']),
      group: makeDelib('group', ['a', 'b', 'c']),
    });
    expect(g.edges).toHaveLength(3); // a-b (bilateral), a-c, b-c (from group)
    expect(g.groupDelibID).toBe('group');
  });
});
