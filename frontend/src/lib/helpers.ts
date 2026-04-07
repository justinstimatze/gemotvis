import type { AgentInfo } from '../types';

/** Join truthy class names into a space-separated string. */
export function classNames(...classes: (string | false | undefined | null | 0)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Shorten an agent ID for display (strip suffix, truncate). */
export function shortAgentID(id: string): string {
  if (!id) return '?';
  const parts = id.split(':');
  let name = parts[parts.length - 1]!;
  name = name.replace(/-agent$/, '').replace(/_agent$/, '');
  return name.length > 24 ? name.slice(0, 22) + '..' : name;
}

export function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '...' : s;
}

export function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

/** Known demonym overrides for agent mention highlighting. */
const DEMONYMS: Record<string, string> = {
  france: 'french', russia: 'russian', england: 'english',
  turkey: 'turkish', germany: 'german', italy: 'italian',
  austria: 'austrian', spain: 'spanish', china: 'chinese',
  japan: 'japanese', brazil: 'brazilian', india: 'indian',
};

/** Collect all agent names + demonym variants for mention highlighting. */
export function collectAgentNames(allAgents: AgentInfo[]): string[] {
  const names = new Set<string>();
  for (const a of allAgents) {
    const name = shortAgentID(a.id);
    if (name.length <= 2) continue;
    names.add(name);
    const lower = name.toLowerCase();
    if (DEMONYMS[lower]) {
      names.add(DEMONYMS[lower]!);
    } else if (lower.endsWith('a')) {
      names.add(lower + 'n');
    } else if (lower.endsWith('y')) {
      names.add(lower.slice(0, -1) + 'ish');
    } else if (lower.endsWith('e')) {
      names.add(lower.slice(0, -1) + 'ish');
    } else {
      names.add(lower + 'ish');
    }
  }
  return [...names];
}

/** Split text into segments: plain text and agent mentions. */
export interface TextSegment {
  text: string;
  isMention: boolean;
}

/** Count positions in a deliberation state (or 0 if undefined/null). */
export function getPositionCount(ds: { positions?: unknown[] } | undefined | null): number {
  return (ds?.positions ?? []).length;
}

/** Check if the current route is a live (non-demo) route: dashboard, watch, or group. */
export function isLiveRoute(): boolean {
  const path = window.location.pathname;
  return path.startsWith('/dashboard') || path.startsWith('/watch/') || path.startsWith('/g/');
}

export function splitMentions(text: string, agentNames: string[]): TextSegment[] {
  if (agentNames.length === 0) return [{ text, isMention: false }];

  const escaped = agentNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp('\\b(' + escaped.join('|') + ')\\b', 'gi');
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isMention: false });
    }
    segments.push({ text: match[0], isMention: true });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isMention: false });
  }
  return segments;
}
