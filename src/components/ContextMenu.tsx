import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > winW) left = winW - rect.width - 8;
    if (top + rect.height > winH) top = winH - rect.height - 8;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 1000,
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        minWidth: 160,
        padding: '4px 0',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, index) =>
        item.divider ? (
          <div
            key={index}
            style={{
              height: 1,
              background: '#eee',
              margin: '4px 0',
            }}
          />
        ) : (
          <button
            key={index}
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 16px',
              border: 'none',
              background: 'transparent',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              color: item.disabled ? '#999' : '#333',
              fontSize: 14,
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) e.currentTarget.style.background = '#f5f5f5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span style={{ marginLeft: 'auto', color: '#999', fontSize: 12 }}>{item.shortcut}</span>
            )}
          </button>
        )
      )}
    </div>
  );
}
