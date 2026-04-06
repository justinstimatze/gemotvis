import { describe, it, expect } from 'vitest';
import { polygonPosition, computeLatLonBounds, latLonToXY, computeFocusedLayout } from '../layout';

describe('polygonPosition', () => {
  it('bilateral: left and right', () => {
    expect(polygonPosition(0, 2)).toEqual({ x: 12, y: 40 });
    expect(polygonPosition(1, 2)).toEqual({ x: 88, y: 40 });
  });
  it('triangle: two top, one bottom', () => {
    expect(polygonPosition(0, 3)).toEqual({ x: 12, y: 18 });
    expect(polygonPosition(2, 3)).toEqual({ x: 50, y: 78 });
  });
  it('five agents: uses circular layout', () => {
    const p = polygonPosition(0, 5);
    expect(p.x).toBeCloseTo(50, 0); // top of circle
    expect(p.y).toBeLessThan(20);
  });
});

describe('computeLatLonBounds', () => {
  it('computes bounding box with padding', () => {
    const bounds = computeLatLonBounds([
      { id: 'a', lat: 48, lon: 2, model_family: '', conviction: 0 },
      { id: 'b', lat: 52, lon: 13, model_family: '', conviction: 0 },
    ]);
    expect(bounds).not.toBeNull();
    expect(bounds!.minLat).toBeLessThan(48);
    expect(bounds!.maxLat).toBeGreaterThan(52);
  });
  it('returns null for no coords', () => {
    expect(computeLatLonBounds([{ id: 'a', model_family: '', conviction: 0 }])).toBeNull();
  });
});

describe('latLonToXY', () => {
  it('projects to percentage with margin', () => {
    const bounds = { minLat: 40, maxLat: 60, minLon: -10, maxLon: 30 };
    const p = latLonToXY(50, 10, bounds);
    expect(p.x).toBeGreaterThan(8);
    expect(p.x).toBeLessThan(92);
    expect(p.y).toBeGreaterThan(8);
    expect(p.y).toBeLessThan(92);
  });
});

describe('computeFocusedLayout', () => {
  it('snaps active agents to left/right', () => {
    const base = [
      { id: 'a', x: 50, y: 50 },
      { id: 'b', x: 60, y: 60 },
      { id: 'c', x: 70, y: 70 },
    ];
    const focused = computeFocusedLayout(base, 'a', 'b');
    expect(focused.find(n => n.id === 'a')!.x).toBe(15);
    expect(focused.find(n => n.id === 'b')!.x).toBe(85);
    expect(focused.find(n => n.id === 'c')!.x).toBe(70); // unchanged
  });
});
