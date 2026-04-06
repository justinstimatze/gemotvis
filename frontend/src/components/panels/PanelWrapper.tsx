import type { ReactNode } from 'react';

interface PanelWrapperProps {
  className?: string;
  title: string;
  emptyText: string;
  isEmpty: boolean;
  children: ReactNode;
}

export function PanelWrapper({ className, title, emptyText, isEmpty, children }: PanelWrapperProps) {
  return (
    <div className={`footer-panel ${className ?? ''}`}>
      <div className="footer-panel-title">{title}</div>
      {isEmpty ? (
        <div className="footer-panel-empty">{emptyText}</div>
      ) : children}
    </div>
  );
}
