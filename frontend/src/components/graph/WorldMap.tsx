import { useEffect, useState, useMemo } from 'react';
import { useSessionStore } from '../../stores/session';
import { computeLatLonBounds, collectAgentsWithCoords, type LatLonBounds } from '../../lib/layout';

interface WorldMapProps {
  show: boolean;
}

export function WorldMap({ show }: WorldMapProps) {
  const [svgText, setSvgText] = useState<string | null>(null);
  const delibs = useSessionStore((s) => s.deliberations);

  // Collect all agents with lat/lon
  const agentsWithCoords = useMemo(() => collectAgentsWithCoords(delibs), [delibs]);

  const bounds = useMemo(
    () => computeLatLonBounds(agentsWithCoords),
    [agentsWithCoords],
  );

  // Fetch SVG once
  useEffect(() => {
    if (!show || svgText) return;
    fetch('/world.svg')
      .then((r) => r.text())
      .then(setSvgText)
      .catch(() => {});
  }, [show, svgText]);

  if (!show || !svgText || !bounds) return null;

  // The SVG is a trusted static asset bundled in the Go binary (world.svg).
  // It is NOT user-supplied content — safe to inject directly.
  const transformedSVG = transformSVG(svgText, bounds);

  return (
    <div
      className="world-map-bg"
      aria-hidden
      // eslint-disable-next-line react/no-danger -- trusted static asset (world.svg from Go binary)
      dangerouslySetInnerHTML={{ __html: transformedSVG }}
    />
  );
}

function transformSVG(svgText: string, bounds: LatLonBounds): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return svgText;

  const vbAttr = svg.getAttribute('viewBox')?.split(/\s+/).map(Number) ?? [0, 0, 1000, 500];
  const svgW = (vbAttr[2] ?? 1000) + (vbAttr[0] ?? 0);
  const svgH = (vbAttr[3] ?? 500) + (vbAttr[1] ?? 0);

  const x1 = (bounds.minLon + 180) / 360 * svgW;
  const x2 = (bounds.maxLon + 180) / 360 * svgW;
  const y1 = (90 - bounds.maxLat) / 180 * svgH;
  const y2 = (90 - bounds.minLat) / 180 * svgH;

  svg.setAttribute('viewBox', `${x1} ${y1} ${x2 - x1} ${y2 - y1}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('style', 'width:100%;height:100%;stroke-linejoin:round;stroke-linecap:round');

  svg.querySelectorAll('path').forEach((p) => {
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '0.15');
    p.setAttribute('vector-effect', 'non-scaling-stroke');
  });

  return svg.outerHTML;
}
