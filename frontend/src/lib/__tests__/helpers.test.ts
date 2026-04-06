import { describe, it, expect } from 'vitest';
import { shortAgentID, truncate, collectAgentNames, splitMentions } from '../helpers';

describe('shortAgentID', () => {
  it('strips -agent suffix', () => {
    expect(shortAgentID('alice-agent')).toBe('alice');
  });
  it('strips _agent suffix', () => {
    expect(shortAgentID('bob_agent')).toBe('bob');
  });
  it('takes last segment after colon', () => {
    expect(shortAgentID('org:team:dave-agent')).toBe('dave');
  });
  it('truncates long names', () => {
    expect(shortAgentID('this-is-a-very-long-agent-name')).toBe('this-is-a-very-l..');
  });
  it('returns ? for empty', () => {
    expect(shortAgentID('')).toBe('?');
  });
});

describe('truncate', () => {
  it('leaves short strings', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });
  it('truncates long strings', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
  });
});

describe('collectAgentNames', () => {
  it('collects names and demonyms', () => {
    const names = collectAgentNames([
      { id: 'france', model_family: '', conviction: 0 },
      { id: 'germany', model_family: '', conviction: 0 },
    ]);
    expect(names).toContain('france');
    expect(names).toContain('french');
    expect(names).toContain('germany');
    expect(names).toContain('german');
  });
});

describe('splitMentions', () => {
  it('splits text at agent mentions', () => {
    const segments = splitMentions('I agree with France on this', ['france']);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ text: 'I agree with ', isMention: false });
    expect(segments[1]).toEqual({ text: 'France', isMention: true });
    expect(segments[2]).toEqual({ text: ' on this', isMention: false });
  });
  it('returns single segment when no mentions', () => {
    const segments = splitMentions('no mentions here', ['france']);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.isMention).toBe(false);
  });
});
