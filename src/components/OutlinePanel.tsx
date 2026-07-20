import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { MindMapData, MindNode, NodeID } from '@/types/mindmap';

interface OutlineTreeNode {
  id: NodeID;
  node: MindNode;
  depth: number;
  parentId: NodeID | null;
  hasChildren: boolean;
  index: number;
}

export interface OutlinePanelProps {
  data: MindMapData;
  selectedId: NodeID | null;
  editingId: NodeID | null;
  onSelect: (id: NodeID) => void;
  onStartEdit: (id: NodeID) => void;
  onCommitEdit: (id: NodeID, label: string) => void;
  onAddChild: (id: NodeID) => void;
  onAddSibling: (id: NodeID) => void;
  onDelete: () => void;
  onDeleteSubtree: () => void;
  onToggle: (id: NodeID) => void;
  onMoveNode: (nodeId: NodeID, targetParentId: NodeID) => void;
  onReorderNode: (nodeId: NodeID, insertBeforeSiblingId: NodeID | null) => void;
  onClose: () => void;
  theme: 'light' | 'dark';
}

export function OutlinePanel({
  data,
  selectedId,
  editingId: _editingId,
  onSelect,
  onStartEdit: _onStartEdit,
  onCommitEdit,
  onAddChild,
  onAddSibling,
  onDelete: _onDelete,
  onDeleteSubtree,
  onToggle: _onToggleNode,
  onMoveNode,
  onReorderNode,
  onClose,
  theme,
}: OutlinePanelProps) {
  const [expanded, setExpanded] = useState<Set<NodeID>>(() => new Set([data.rootId]));
  const [editValue, setEditValue] = useState('');
  const [localEditingId, setLocalEditingId] = useState<NodeID | null>(null);
  const [draggingId, setDraggingId] = useState<NodeID | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: NodeID; position: 'before' | 'after' | 'child' } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const editInputRef = useRef<HTMLInputElement>(null);
  const editValueRef = useRef('');

  const startEditing = useCallback((id: NodeID) => {
    const node = data.nodes[id];
    if (!node) return;
    const value = node.label ?? '';
    setEditValue(value);
    editValueRef.current = value;
    setLocalEditingId(id);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }, [data.nodes]);

  const commit = useCallback(() => {
    if (localEditingId) {
      onCommitEdit(localEditingId, editValueRef.current.trim() || '分支主题');
    }
    setLocalEditingId(null);
  }, [localEditingId, onCommitEdit]);

  const cancel = useCallback(() => {
    if (localEditingId) {
      onCommitEdit(localEditingId, data.nodes[localEditingId]?.label ?? '');
    }
    setLocalEditingId(null);
  }, [localEditingId, data.nodes, onCommitEdit]);

  useEffect(() => {
    editValueRef.current = editValue;
  }, [editValue]);

  // 新节点展开父级
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      Object.values(data.nodes).forEach((node) => {
        if (node.parentId && !prev.has(node.parentId)) {
          next.add(node.parentId);
        }
      });
      return next;
    });
  }, [data.nodes]);

  const flattenTree = useMemo(() => {
    const result: OutlineTreeNode[] = [];
    const visit = (id: NodeID, depth: number, parentId: NodeID | null) => {
      const node = data.nodes[id];
      if (!node) return;
      const visibleChildren = node.children.filter((childId) => data.nodes[childId]);
      const item: OutlineTreeNode = {
        id,
        node,
        depth,
        parentId,
        hasChildren: visibleChildren.length > 0,
        index: result.length,
      };
      result.push(item);
      if (expanded.has(id)) {
        visibleChildren.forEach((childId) => {
          visit(childId, depth + 1, id);
        });
      }
    };
    visit(data.rootId, 0, null);
    return result;
  }, [data, expanded]);

  const toggleExpand = (id: NodeID) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const lastClickRef = useRef<{ id: NodeID; time: number } | null>(null);
  const DBL_CLICK_INTERVAL = 300;

  const handleRowClick = (id: NodeID) => {
    if (localEditingId) return;
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.id === id && now - last.time < DBL_CLICK_INTERVAL) {
      lastClickRef.current = null;
      startEditing(id);
      return;
    }
    lastClickRef.current = { id, time: now };
    onSelect(id);
  };

  const handleDragStart = (e: React.DragEvent, id: NodeID) => {
    if (id === data.rootId) {
      e.preventDefault();
      return;
    }
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent, target: OutlineTreeNode) => {
    e.preventDefault();
    if (!draggingId || draggingId === target.id) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    let position: 'before' | 'after' | 'child';
    if (target.id === data.rootId) {
      position = 'child';
    } else if (y < height * 0.25) {
      position = 'before';
    } else if (y > height * 0.75) {
      position = 'after';
    } else {
      position = 'child';
    }
    setDropTarget({ id: target.id, position });
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
  };

  const handleDrop = (e: React.DragEvent, target: OutlineTreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dropTarget || !draggingId || draggingId === target.id) {
      setDropTarget(null);
      setDraggingId(null);
      return;
    }

    const draggedNode = data.nodes[draggingId];
    const targetNode = data.nodes[dropTarget.id];
    if (!draggedNode || !targetNode) {
      setDropTarget(null);
      setDraggingId(null);
      return;
    }

    // 不能拖到自身后代上
    const isDescendant = (ancestorId: NodeID, descendantId: NodeID): boolean => {
      const node = data.nodes[descendantId];
      if (!node) return false;
      if (node.parentId === ancestorId) return true;
      if (!node.parentId) return false;
      return isDescendant(ancestorId, node.parentId);
    };

    if (isDescendant(draggingId, dropTarget.id)) {
      setDropTarget(null);
      setDraggingId(null);
      return;
    }

    const targetParentId = targetNode.parentId;
    if (dropTarget.position === 'child') {
      if (draggingId !== dropTarget.id) {
        onMoveNode(draggingId, dropTarget.id);
      }
    } else if (dropTarget.position === 'before') {
      if (targetParentId && targetParentId !== draggingId) {
        onMoveNode(draggingId, targetParentId);
        onReorderNode(draggingId, dropTarget.id);
      } else if (!targetParentId && dropTarget.id === data.rootId) {
        // 拖到根节点之前，不处理
      }
    } else if (dropTarget.position === 'after') {
      if (targetParentId && targetParentId !== draggingId) {
        onMoveNode(draggingId, targetParentId);
        const targetIndex = data.nodes[targetParentId].children.indexOf(dropTarget.id);
        const insertBeforeId = targetIndex < data.nodes[targetParentId].children.length - 1
          ? data.nodes[targetParentId].children[targetIndex + 1]
          : null;
        onReorderNode(draggingId, insertBeforeId);
      } else if (!targetParentId && dropTarget.id === data.rootId) {
        // 拖到根节点之后，作为根节点子节点
        onMoveNode(draggingId, data.rootId);
      }
    }

    setDropTarget(null);
    setDraggingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, item: OutlineTreeNode) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (item.id === data.rootId) return;
      const parent = data.nodes[item.parentId!];
      if (!parent) return;
      const currentIndex = parent.children.indexOf(item.id);
      if (e.shiftKey) {
        // 反缩进：成为祖父的子节点
        if (item.parentId && item.parentId !== data.rootId) {
          const grandParent = data.nodes[item.parentId]!.parentId;
          if (grandParent) {
            onMoveNode(item.id, grandParent);
            onReorderNode(item.id, null);
          }
        }
      } else {
        // 缩进：成为前一个兄弟的子节点
        if (currentIndex > 0) {
          const prevSiblingId = parent.children[currentIndex - 1];
          onMoveNode(item.id, prevSiblingId);
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      startEditing(item.id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (item.id === data.rootId) return;
      onSelect(item.id);
      onDeleteSubtree();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const currentIndex = flattenTree.findIndex((n) => n.id === item.id);
      const nextIndex = e.key === 'ArrowUp' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex >= 0 && nextIndex < flattenTree.length) {
        onSelect(flattenTree[nextIndex].id);
      }
    }
  };

  return (
    <div className="outline-panel" data-theme={theme}>
      <div className="outline-header">
        <span className="outline-title">大纲视图</span>
        <button className="outline-close" onClick={onClose} title="关闭">×</button>
      </div>
      <div className="outline-toolbar">
        <button
          onClick={() => selectedId && onAddChild(selectedId)}
          disabled={!selectedId}
          title="添加子节点"
        >
          添加子节点
        </button>
        <button
          onClick={() => selectedId && onAddSibling(selectedId)}
          disabled={!selectedId || selectedId === data.rootId}
          title="添加同级节点"
        >
          添加同级
        </button>
        <button
          onClick={() => {
            if (selectedId && selectedId !== data.rootId) {
              onDeleteSubtree();
            }
          }}
          disabled={!selectedId || selectedId === data.rootId}
          title="删除节点"
        >
          删除
        </button>
      </div>
      <div className="outline-list" ref={listRef}>
        {flattenTree.map((item) => {
          const isSelected = selectedId === item.id;
          const isEditing = localEditingId === item.id;
          const isDragging = draggingId === item.id;
          const isDropTarget = dropTarget?.id === item.id;
          const dropClass = isDropTarget ? `drop-${dropTarget.position}` : '';

          return (
            <div
              key={item.id}
              className={[
                'outline-item',
                isSelected ? 'selected' : '',
                isDragging ? 'dragging' : '',
                dropClass,
              ].join(' ')}
              style={{ paddingLeft: `${item.depth * 20 + 8}px` }}
              draggable={item.id !== data.rootId}
              onDragStart={(e) => handleDragStart(e, item.id)}
              onDragOver={(e) => handleDragOver(e, item)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, item)}
              onClick={() => handleRowClick(item.id)}
              onKeyDown={(e) => handleKeyDown(e, item)}
              tabIndex={0}
              data-node-id={item.id}
            >
              <span
                className={['outline-expand', item.hasChildren ? 'has-children' : ''].join(' ')}
                onClick={(e) => {
                  if (item.hasChildren) {
                    e.stopPropagation();
                    toggleExpand(item.id);
                  }
                }}
              >
                {item.hasChildren ? (expanded.has(item.id) ? '▼' : '▶') : ''}
              </span>
              {isEditing ? (
                <input
                  ref={editInputRef}
                  className="outline-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commit();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancel();
                    }
                  }}
                />
              ) : (
                <span className="outline-label">{item.node.label || ' '}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
