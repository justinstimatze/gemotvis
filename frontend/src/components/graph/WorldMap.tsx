import { useEffect, useState, useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import { useSessionStore } from '../../stores/session';
import { computeLatLonBounds, collectAgentsWithCoords, type LatLonBounds } from '../../lib/layout';

interface WorldMapProps {
  show: boolean;
}

/**
 * World map background that syncs with React Flow's viewport transform.
 * Must be rendered as a child of <ReactFlow> to access useViewport().
 */
export function WorldMap({ show }: WorldMapProps) {
  const [svgText, setSvgText] = useState<string | null>(null);
  const delibs = useSessionStore((s) => s.deliberations);
  const viewport = useViewport();

  const agentsWithCoords = useMemo(() => collectAgentsWithCoords(delibs), [delibs]);
  const bounds = useMemo(
    () => computeLatLonBounds(agentsWithCoords),
    [agentsWithCoords],
  );

  useEffect(() => {
    if (!show || svgText) return;
    fetch('/world.svg')
      .then((r) => r.text())
      .then(setSvgText)
      .catch(() => {});
  }, [show, svgText]);

  if (!show || !svgText || !bounds) return null;

  const transformedSVG = transformSVG(svgText, bounds);

  // The map covers flow coordinates 0-100 (same space as node positions).
  // Apply the viewport transform so it pans/zooms with nodes.
  return (
    <div
      className="world-map-bg"
      aria-hidden
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 1600,
        height: 900,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        transformOrigin: '0 0',
      }}
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

  // Expand viewBox to account for the 8% margin in latLonToXY positioning.
  const margin = 8;
  const marginFrac = margin / (100 - 2 * margin);
  const xRange = x2 - x1;
  const yRange = y2 - y1;
  const adjX1 = x1 - xRange * marginFrac;
  const adjY1 = y1 - yRange * marginFrac;
  const adjW = xRange * (1 + 2 * marginFrac);
  const adjH = yRange * (1 + 2 * marginFrac);

  svg.setAttribute('viewBox', `${adjX1} ${adjY1} ${adjW} ${adjH}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('style', 'width:100%;height:100%;stroke-linejoin:round;stroke-linecap:round;overflow:visible');

  svg.querySelectorAll('path').forEach((p) => {
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '0.5');
    p.setAttribute('vector-effect', 'non-scaling-stroke');
  });

  return svg.outerHTML;
}
