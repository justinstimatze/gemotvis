import { useState, useCallback, type ReactNode } from 'react';
import { classNames } from '../../lib/helpers';

interface PanelWrapperProps {
  className?: string;
  title: string;
  emptyText: string;
  isEmpty: boolean;
  children: ReactNode;
}

export function PanelWrapper({ className, title, emptyText, isEmpty, children }: PanelWrapperProps) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded(e => !e), []);

  return (
    <div className={classNames('footer-panel', expanded && 'footer-panel-expanded', className)}>
      <button className="footer-panel-title" onClick={toggle} aria-expanded={expanded}>
        {title}
        {!isEmpty && <span className="footer-panel-toggle">{expanded ? '▾' : '▸'}</span>}
      </button>
      {isEmpty ? (
        <div className="footer-panel-empty">{emptyText}</div>
      ) : children}
    </div>
  );
}
