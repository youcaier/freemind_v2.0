import { useState, useRef, useEffect } from 'react';
import './FileMenu.css';

export interface FileMenuProps {
  onNew: () => void;
  onOpen: () => void;
  onImportMarkdown: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  recentFiles: string[];
  onOpenRecent: (path: string) => void;
  autoSave: boolean;
  onToggleAutoSave: (value: boolean) => void;
  currentPath: string | null;
  isDirty: boolean;
}

export function FileMenu({
  onNew,
  onOpen,
  onImportMarkdown,
  onSave,
  onSaveAs,
  onExport,
  recentFiles,
  onOpenRecent,
  autoSave,
  onToggleAutoSave,
  currentPath,
  isDirty,
}: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setRecentOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const title = currentPath ? currentPath.split('/').pop() || currentPath.split('\\').pop() || currentPath : '未命名';

  return (
    <div className="file-menu" ref={containerRef}>
      <button
        className="file-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        文件
      </button>
      {open && (
        <div className="file-menu-dropdown">
          <div className="file-menu-title">
            {title}
            {isDirty && <span className="file-menu-dirty">●</span>}
          </div>
          <div className="file-menu-divider" />
          <button className="file-menu-item" onClick={() => { onNew(); setOpen(false); }}>
            <span>新建</span>
            <span className="file-menu-shortcut">⌘N</span>
          </button>
          <button className="file-menu-item" onClick={() => { onOpen(); setOpen(false); }}>
            <span>打开</span>
            <span className="file-menu-shortcut">⌘O</span>
          </button>
          <button className="file-menu-item" onClick={() => { onImportMarkdown(); setOpen(false); }}>
            <span>导入 Markdown…</span>
          </button>
          <button className="file-menu-item" onClick={() => { onSave(); setOpen(false); }}>
            <span>保存</span>
            <span className="file-menu-shortcut">⌘S</span>
          </button>
          <button className="file-menu-item" onClick={() => { onSaveAs(); setOpen(false); }}>
            <span>另存为</span>
            <span className="file-menu-shortcut">⇧⌘S</span>
          </button>
          <button className="file-menu-item" onClick={() => { onExport(); setOpen(false); }}>
            <span>导出</span>
          </button>
          <div className="file-menu-divider" />
          <label className="file-menu-item file-menu-checkbox">
            <span>自动保存</span>
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(e) => onToggleAutoSave(e.target.checked)}
            />
          </label>
          <div className="file-menu-divider" />
          <div
            className="file-menu-item file-menu-submenu-trigger"
            onMouseEnter={() => setRecentOpen(true)}
            onMouseLeave={() => setRecentOpen(false)}
          >
            <span>最近文件</span>
            <span className="file-menu-arrow">▶</span>
            {recentOpen && (
              <div className="file-menu-submenu">
                {recentFiles.length === 0 ? (
                  <div className="file-menu-empty">暂无最近文件</div>
                ) : (
                  recentFiles.map((path) => (
                    <button
                      key={path}
                      className="file-menu-item file-menu-recent"
                      title={path}
                      onClick={() => {
                        onOpenRecent(path);
                        setOpen(false);
                        setRecentOpen(false);
                      }}
                    >
                      {path.split('/').pop() || path.split('\\').pop() || path}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
