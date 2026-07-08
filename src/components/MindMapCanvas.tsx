import { useRef, useEffect, useState } from 'react';
import type { MindMapData, MindNode } from '@/types/mindmap';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { NodeStylePanel } from './NodeStylePanel';

interface MindMapCanvasProps {
  data: MindMapData;
  selectedId: string | null;
  editingId: string | null;
  onSelect: (id: string | null) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, label: string) => void;
  onAddChild: (parentId: string) => void;
  onAddSibling: (siblingId: string) => void;
  onDelete: (id: string) => void;
  onDeleteSubtree: (id: string) => void;
  onToggle: (id: string) => void;
  onCopy: (id: string) => void;
  onCut: (id: string) => void;
  onPaste: (parentId: string) => void;
  onChangeStyle: (id: string, patch: Partial<Pick<MindNode, 'style' | 'icon' | 'tags' | 'priority' | 'progress' | 'note' | 'hyperlink'>>) => void;
  clipboard: { nodes: Record<string, MindNode>; rootId: string } | null;
  onUndo: () => void;
  onRedo: () => void;
  onClick: (e: React.MouseEvent, container: HTMLElement | null) => void;
  onDoubleClick: (e: React.MouseEvent, container: HTMLElement | null) => void;
}

export function MindMapCanvas({
  data,
  selectedId,
  editingId,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onAddChild,
  onAddSibling,
  onDelete,
  onDeleteSubtree,
  onToggle,
  onCopy,
  onCut,
  onPaste,
  onChangeStyle,
  clipboard,
  onUndo,
  onRedo,
  onClick,
  onDoubleClick,
}: MindMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);
  const [stylePanelNodeId, setStylePanelNodeId] = useState<string | null>(null);

  const closeContextMenu = () => setContextMenu(null);
  const closeStylePanel = () => setStylePanelNodeId(null);

  const handleKeyDown = (_e: React.KeyboardEvent) => {
    // 键盘快捷键统一在 App.tsx window 级别处理，这里只保留 focus 行为
  };

  const handleNodeContextMenu = (nodeId: string, x: number, y: number) => {
    onSelect(nodeId);
    setContextMenu({ x, y, nodeId });
  };

  const visibleNodes = getVisibleNodes(data);

  const contextMenuItems: ContextMenuItem[] = (() => {
    if (!contextMenu) return [];
    const id = contextMenu.nodeId;
    const isRoot = id === data.rootId;
    const hasChildren = (data.nodes[id]?.children?.length ?? 0) > 0;
    return [
      { label: '编辑', shortcut: 'Enter', onClick: () => onStartEdit(id) },
      { label: '添加子主题', shortcut: 'Tab/Insert', onClick: () => onAddChild(id) },
      { label: '添加同级主题', shortcut: 'Ctrl+Enter', disabled: isRoot, onClick: () => onAddSibling(id) },
      { divider: true, label: '', onClick: () => {} },
      { label: '复制', shortcut: 'Ctrl+C', disabled: isRoot, onClick: () => onCopy(id) },
      { label: '剪切', shortcut: 'Ctrl+X', disabled: isRoot, onClick: () => onCut(id) },
      { label: '粘贴', shortcut: 'Ctrl+V', disabled: !clipboard || isRoot, onClick: () => onPaste(id) },
      { divider: true, label: '', onClick: () => {} },
      { label: '删除节点', shortcut: 'Delete', disabled: isRoot, onClick: () => onDelete(id) },
      { label: '删除子树', shortcut: 'Ctrl+Delete', disabled: isRoot, onClick: () => onDeleteSubtree(id) },
      { label: '折叠/展开', shortcut: 'Space', disabled: !hasChildren, onClick: () => onToggle(id) },
      { label: '样式', onClick: () => setStylePanelNodeId(id) },
      { divider: true, label: '', onClick: () => {} },
      { label: '撤销', shortcut: 'Ctrl+Z', onClick: onUndo },
      { label: '重做', shortcut: 'Ctrl+Y', onClick: onRedo },
    ];
  })();

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'auto',
        background: '#f8f9fa',
        cursor: 'default',
        outline: 'none',
      }}
      onClick={(e) => {
        containerRef.current?.focus();
        onClick(e, containerRef.current);
      }}
      onDoubleClick={(e) => onDoubleClick(e, containerRef.current)}
      onKeyDown={handleKeyDown}
    >
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '2000px',
          height: '2000px',
        }}
      >
        {renderConnections(data, visibleNodes)}
      </svg>
      {visibleNodes.map((node) => (
        <NodeView
          key={node.id}
          node={node}
          selected={selectedId === node.id}
          editing={editingId === node.id}
          onSelect={onSelect}
          onCommitEdit={onCommitEdit}
          onContextMenu={handleNodeContextMenu}
        />
      ))}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      )}
      {stylePanelNodeId && (
      <NodeStylePanel
        style={data.nodes[stylePanelNodeId]?.style}
        icon={data.nodes[stylePanelNodeId]?.icon}
        tags={data.nodes[stylePanelNodeId]?.tags}
        priority={data.nodes[stylePanelNodeId]?.priority}
        progress={data.nodes[stylePanelNodeId]?.progress}
        note={data.nodes[stylePanelNodeId]?.note}
        hyperlink={data.nodes[stylePanelNodeId]?.hyperlink}
        onChange={(patch) => onChangeStyle(stylePanelNodeId, patch)}
        onClose={closeStylePanel}
      />
      )}
    </div>
  );
}

function NodeView({
  node,
  selected,
  editing,
  onSelect,
  onCommitEdit,
  onContextMenu,
}: {
  node: MindNode;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string) => void;
  onCommitEdit: (id: string, label: string) => void;
  onContextMenu: (nodeId: string, x: number, y: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const left = node.x ?? 0;
  const top = node.y ?? 0;
  const width = node.width ?? 120;
  const height = node.height ?? 40;

  return (
    <div
    onClick={(e) => {
      e.stopPropagation();
      onSelect(node.id);
    }}
    onContextMenu={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(node.id, e.clientX, e.clientY);
    }}
    style={{
      position: 'absolute',
      left,
      top,
      width,
      height,
      background: node.style?.background ?? '#fff',
      color: node.style?.color ?? '#333',
      border: selected ? `2px solid ${node.style?.borderColor || '#4ECDC4'}` : `1px solid ${node.style?.borderColor || '#ddd'}`,
      borderRadius: node.style?.shape === 'rectangle' ? 2 : node.style?.shape === 'ellipse' ? 999 : 8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 12px',
      boxShadow: selected ? '0 0 0 2px rgba(78, 205, 196, 0.3)' : '0 2px 4px rgba(0,0,0,0.1)',
      fontSize: node.style?.fontSize ?? 14,
      fontWeight: node.style?.fontWeight ?? 'normal',
      fontStyle: node.style?.fontStyle ?? 'normal',
      textDecoration: node.style?.textDecoration ?? 'none',
      zIndex: selected ? 10 : 1,
    }}
    >
      {editing ? (
        <input
          ref={inputRef}
          defaultValue={node.label}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            textAlign: 'center',
            fontSize: node.style?.fontSize ?? 14,
            fontWeight: node.style?.fontWeight ?? 'normal',
            fontStyle: node.style?.fontStyle ?? 'normal',
            textDecoration: node.style?.textDecoration ?? 'none',
          }}
          onBlur={(e) => onCommitEdit(node.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onCommitEdit(node.id, e.currentTarget.value);
            } else if (e.key === 'Escape') {
              onCommitEdit(node.id, node.label);
            } else if (e.key === 'Tab') {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <NodeContent node={node} />
          {node.hyperlink && (
            <span style={{ marginLeft: 4, fontSize: 10, color: '#4ECDC4' }}>🔗</span>
          )}
          {node.priority ? (
            <PriorityBadge priority={node.priority} />
          ) : null}
          {node.progress !== undefined && node.progress > 0 ? (
            <ProgressBadge progress={node.progress} />
          ) : null}
          {node.tags && node.tags.length > 0 ? (
            <div style={{ display: 'flex', gap: 2, marginLeft: 6 }}>
              {node.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: 9,
                    padding: '1px 4px',
                    borderRadius: 3,
                    background: '#e9ecef',
                    color: '#495057',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function renderConnections(data: MindMapData, visibleNodes: MindNode[]) {
  const visibleSet = new Set(visibleNodes.map((n) => n.id));
  const lines: React.JSX.Element[] = [];
  visibleNodes.forEach((node) => {
    if (!node.children || node.children.length === 0) return;
    const parentX = (node.x ?? 0) + (node.width ?? 120);
    const parentY = (node.y ?? 0) + (node.height ?? 40) / 2;

    node.children.forEach((childId) => {
      const child = data.nodes[childId];
      if (!child || !visibleSet.has(childId)) return;
      const childX = child.x ?? 0;
      const childY = (child.y ?? 0) + (child.height ?? 40) / 2;
      const midX = (parentX + childX) / 2;
      const path = `M ${parentX} ${parentY} C ${midX} ${parentY}, ${midX} ${childY}, ${childX} ${childY}`;
      lines.push(
        <path
          key={`${node.id}-${childId}`}
          d={path}
          fill="none"
          stroke="#999"
          strokeWidth={1.5}
        />
      );
    });
  });
  return lines;
}

function NodeContent({ node }: { node: MindNode }) {
  const icon = node.icon ? `${node.icon} ` : '';
  return (
    <span
      style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      title={node.note ? `${node.label}\n\n${node.note}` : node.label}
    >
      {icon}
      {node.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: number }) {
  return (
    <span
      style={{
        marginLeft: 4,
        width: 16,
        height: 16,
        borderRadius: 8,
        background: priority === 1 ? '#ff6b6b' : priority === 2 ? '#ff9f43' : priority === 3 ? '#ffd93d' : '#95a5a6',
        color: '#fff',
        fontSize: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {priority}
    </span>
  );
}

function ProgressBadge({ progress }: { progress: number }) {
  return (
    <span
      style={{
        marginLeft: 4,
        fontSize: 10,
        color: '#6bcb77',
      }}
    >
      {progress}%
    </span>
  );
}

function getVisibleNodes(data: MindMapData): MindNode[] {
  const root = data.nodes[data.rootId];
  if (!root) return [];
  const result: MindNode[] = [root];
  const queue: MindNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.collapsed) continue;
    node.children.forEach((childId) => {
      const child = data.nodes[childId];
      if (child) {
        result.push(child);
        queue.push(child);
      }
    });
  }
  return result;
}
