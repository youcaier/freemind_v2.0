import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MindMapData,
  MindNode,
  NodeID,
} from '@/types/mindmap';
import {
  createEmptyMindMap,
  addNode,
  addSiblingNode as addSiblingNodeEngine,
  removeNode,
  calculateTreeLayout,
  cloneSubtree,
  insertSubtree,
  findNextSibling,
  findPrevSibling,
  findFirstChild,
  findParent,
  findLastLeaf,
  moveNodeToParent,
  reorderNode as reorderNodeEngine,
} from '@/engine/mindmapEngine';

export function useMindMap() {
  const [data, setData] = useState<MindMapData>(() => calculateTreeLayout(createEmptyMindMap()));
  const [selectedId, setSelectedId] = useState<NodeID | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<NodeID>>(new Set());
  const [editingId, setEditingId] = useState<NodeID | null>(null);
  const editingRef = useRef<HTMLInputElement | null>(null);

  // 撤销/重做历史栈
  const [history, setHistory] = useState<MindMapData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < history.length - 1;
  const isHistoryActionRef = useRef(false);

  const setSingleSelect = (id: NodeID | null) => {
    setSelectedId(id);
    setSelectedIds(id ? new Set([id]) : new Set());
  };

  const selectNode = useCallback((id: NodeID | null, mode: 'replace' | 'toggle' = 'replace') => {
    if (mode === 'replace') {
      setSingleSelect(id);
    } else if (id) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedId(next.size === 1 ? Array.from(next)[0] : next.size > 1 ? id : null);
        return next;
      });
    }
    setEditingId(null);
  }, []);

  const selectNodes = useCallback((ids: Set<NodeID>) => {
    setSelectedIds(ids);
    setSelectedId(ids.size === 1 ? Array.from(ids)[0] : null);
    setEditingId(null);
  }, []);

  const startEdit = useCallback((id: NodeID) => {
    setSelectedId(id);
    setSelectedIds(new Set([id]));
    setEditingId(id);
  }, []);

  const commitEdit = useCallback(
    (id: NodeID, label: string) => {
      setData((prev) => {
        const target = prev.nodes[id];
        if (!target || target.label === label) return prev;
        const next: MindMapData = {
          ...prev,
          nodes: { ...prev.nodes, [id]: { ...target, label } },
        };
        return calculateTreeLayout(next);
      });
      setEditingId(null);
    },
    []
  );

  const changeNodeStyle = useCallback((id: NodeID, patch: Partial<Pick<MindNode, 'style' | 'icon' | 'tags' | 'priority' | 'progress' | 'note' | 'hyperlink'>>) => {
    setData((prev) => {
      const target = prev.nodes[id];
      if (!target) return prev;
      const next: MindMapData = {
        ...prev,
        nodes: {
          ...prev.nodes,
          [id]: {
            ...target,
            style: patch.style ? { ...target.style, ...patch.style } : target.style,
            icon: patch.icon !== undefined ? patch.icon : target.icon,
            tags: patch.tags !== undefined ? patch.tags : target.tags,
            priority: patch.priority !== undefined ? patch.priority : target.priority,
            progress: patch.progress !== undefined ? patch.progress : target.progress,
            note: patch.note !== undefined ? patch.note : target.note,
            hyperlink: patch.hyperlink !== undefined ? patch.hyperlink : target.hyperlink,
          },
        },
      };
      return calculateTreeLayout(next);
    });
  }, []);

  const addChildNodes = useCallback(
    (parentIds: Set<NodeID>) => {
      setData((prev) => {
        const ids = Array.from(parentIds).filter((id) => prev.nodes[id]);
        if (ids.length === 0) return prev;
        const next: MindMapData = { ...prev, nodes: { ...prev.nodes } };
        ids.forEach((parentId) => {
          addNode(next, parentId, '分支主题');
        });
        return calculateTreeLayout(next);
      });
    },
    []
  );

  const addChildNode = useCallback(
    (parentId: NodeID) => {
      addChildNodes(new Set([parentId]));
    },
    [addChildNodes]
  );

  const addSiblingNode = useCallback(
    (siblingId: NodeID) => {
      setData((prev) => {
        const sibling = prev.nodes[siblingId];
        if (!sibling || !sibling.parentId) return prev;
        const next: MindMapData = { ...prev, nodes: { ...prev.nodes } };
        addSiblingNodeEngine(next, siblingId, '分支主题');
        return calculateTreeLayout(next);
      });
    },
    []
  );

  const deleteSelected = useCallback(() => {
    const ids = Array.from(selectedIds).filter((id) => id !== data.rootId && !data.nodes[id]?.children.length);
    if (ids.length === 0) return;
    setData((prev) => {
      const next: MindMapData = { ...prev, nodes: { ...prev.nodes } };
      ids.forEach((id) => removeNode(next, id));
      return calculateTreeLayout(next);
    });
    setSelectedId(null);
    setSelectedIds(new Set());
    setEditingId(null);
  }, [selectedIds, data.rootId, data.nodes]);

  const deleteSubtree = useCallback(() => {
    const ids = Array.from(selectedIds).filter((id) => id !== data.rootId);
    if (ids.length === 0) return;
    setData((prev) => {
      const next: MindMapData = { ...prev, nodes: { ...prev.nodes } };
      ids.forEach((id) => removeNode(next, id));
      return calculateTreeLayout(next);
    });
    setSelectedId(null);
    setSelectedIds(new Set());
    setEditingId(null);
  }, [selectedIds, data.rootId]);

  const toggleSelected = useCallback(() => {
    if (!selectedId) return;
    setData((prev) => {
      const target = prev.nodes[selectedId];
      if (!target || target.children.length === 0) return prev;
      const next: MindMapData = {
        ...prev,
        nodes: {
          ...prev.nodes,
          [selectedId]: { ...target, collapsed: !target.collapsed },
        },
      };
      return calculateTreeLayout(next);
    });
  }, [selectedId]);

  // 复制/剪切/粘贴
  const [clipboard, setClipboard] = useState<{ nodes: Record<NodeID, MindNode>; rootId: NodeID } | null>(null);
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;

  const copyNode = useCallback((id: NodeID) => {
    console.log('[copyNode] id=', id, 'rootId=', data.rootId);
    if (id === data.rootId) {
      console.log('[copyNode] skipped root');
      return;
    }
    const node = data.nodes[id];
    console.log('[copyNode] targetNode=', node);
    const subtree = cloneSubtree(data, id);
    console.log('[copyNode] subtree=', subtree ? { nodeId: subtree.node.id, nodeCount: Object.keys(subtree.nodes).length } : null);
    if (!subtree) {
      console.log('[copyNode] subtree null, using fallback');
      const fallback = { nodes: { [id]: { ...node, id, children: [] } }, rootId: id };
      clipboardRef.current = fallback;
      setClipboard(fallback);
      return;
    }
    const next = { nodes: subtree.nodes, rootId: subtree.node.id };
    clipboardRef.current = next;
    setClipboard(next);
    console.log('[copyNode] clipboard set nodeCount=', Object.keys(next.nodes).length);
  }, [data, data.rootId]);

  const cutNode = useCallback((id: NodeID) => {
    if (id === data.rootId) return;
    copyNode(id);
    setData((prev) => {
      const target = prev.nodes[id];
      if (!target) return prev;
      const next: MindMapData = { ...prev, nodes: { ...prev.nodes } };
      removeNode(next, id);
      return calculateTreeLayout(next);
    });
    if (selectedId === id) {
      setSelectedId(null);
      setEditingId(null);
    }
  }, [copyNode, data.rootId, selectedId]);

  const pasteNode = useCallback((parentId: NodeID) => {
    const current = clipboardRef.current;
    console.log('[pasteNode] parentId=', parentId, 'current=', current ? { rootId: current.rootId, nodeCount: Object.keys(current.nodes).length } : null);
    if (!current) return;
    let newId: NodeID | null = null;
    setData((prev) => {
      console.log('[pasteNode setData] before nodeCount=', Object.keys(prev.nodes).length);
      const next: MindMapData = { ...prev, nodes: { ...prev.nodes } };
      try {
        newId = insertSubtree(next, parentId, current, current.rootId);
        console.log('[pasteNode setData] newId=', newId, 'after nodeCount=', Object.keys(next.nodes).length);
      } catch (e) {
        console.error('[pasteNode setData] error=', e);
      }
      return calculateTreeLayout(next);
    });
    if (newId) {
      setSelectedId(newId);
      setEditingId(null);
      console.log('[pasteNode] selected newId=', newId);
    }
  }, []);

  const moveNode = useCallback((nodeId: NodeID, targetParentId: NodeID) => {
    setData((prev) => {
      const node = prev.nodes[nodeId];
      const target = prev.nodes[targetParentId];
      if (!node || !target || nodeId === targetParentId || node.id === prev.rootId) return prev;
      if (node.parentId === targetParentId) return prev;
      const next: MindMapData = { ...prev, nodes: { ...prev.nodes } };
      moveNodeToParent(next, nodeId, targetParentId);
      return calculateTreeLayout(next);
    });
  }, []);

  const reorderNode = useCallback((nodeId: NodeID, insertBeforeSiblingId: NodeID | null) => {
    setData((prev) => {
      const node = prev.nodes[nodeId];
      if (!node || !node.parentId) return prev;
      const next: MindMapData = { ...prev, nodes: { ...prev.nodes } };
      reorderNodeEngine(next, nodeId, insertBeforeSiblingId);
      return calculateTreeLayout(next);
    });
  }, []);

  // 撤销/重做
  const undo = useCallback(() => {
    if (!canUndo) return;
    isHistoryActionRef.current = true;
    setData(history[historyIndex]);
    setHistoryIndex((i) => i - 1);
  }, [canUndo, history, historyIndex]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    isHistoryActionRef.current = true;
    setData(history[historyIndex + 1]);
    setHistoryIndex((i) => i + 1);
  }, [canRedo, history, historyIndex]);

  // 记录操作历史：在 data 变化后自动保存前一个状态
  const prevDataRef = useRef<MindMapData>(data);
  useEffect(() => {
    if (prevDataRef.current !== data) {
      if (isHistoryActionRef.current) {
        isHistoryActionRef.current = false;
      } else {
        setHistory((prev) => [...prev.slice(0, historyIndex + 1), prevDataRef.current]);
        setHistoryIndex((i) => i + 1);
      }
      prevDataRef.current = data;
    }
  }, [data, historyIndex]);

  // 方向键导航
  const moveSelection = useCallback((direction: 'up' | 'down' | 'left' | 'right' | 'home' | 'end') => {
    if (!selectedId) {
      setSelectedId(data.rootId);
      setSelectedIds(new Set([data.rootId]));
      return;
    }
    let nextId: NodeID | null = null;
    switch (direction) {
      case 'home':
        nextId = data.rootId;
        break;
      case 'end':
        nextId = findLastLeaf(data, selectedId) || selectedId;
        break;
      case 'right':
        nextId = findFirstChild(data, selectedId);
        break;
      case 'left':
        nextId = findParent(data, selectedId);
        break;
      case 'down':
        nextId = findNextSibling(data, selectedId);
        break;
      case 'up':
        nextId = findPrevSibling(data, selectedId);
        break;
    }
    if (nextId) {
      setSelectedId(nextId);
      setSelectedIds(new Set([nextId]));
    }
  }, [data, selectedId]);

  const changeLayout = useCallback((layout: MindMapData['layout']) => {
    setData((prev) => calculateTreeLayout({ ...prev, layout }));
  }, []);

  const changeConnectionStyle = useCallback((connectionStyle: MindMapData['connectionStyle']) => {
    setData((prev) => calculateTreeLayout({ ...prev, connectionStyle }));
  }, []);

  const changeConnectionColor = useCallback((connectionColor: string) => {
    setData((prev) => calculateTreeLayout({ ...prev, connectionColor }));
  }, []);

  const changeConnectionWidth = useCallback((connectionWidth: number) => {
    setData((prev) => calculateTreeLayout({ ...prev, connectionWidth }));
  }, []);

  return {
    data,
    selectedId,
    editingId,
    editingRef,
    selectNode,
    startEdit,
    commitEdit,
    changeNodeStyle,
    addChildNode,
    addChildNodes,
    addSiblingNode,
    deleteSelected,
    deleteSubtree,
    toggleSelected,
    copyNode,
    cutNode,
    pasteNode,
    moveNode,
    reorderNode,
    selectedIds,
    selectNodes,
    clipboard,
    undo,
    redo,
    canUndo,
    canRedo,
    moveSelection,
    changeLayout,
    changeConnectionStyle,
    changeConnectionColor,
    changeConnectionWidth,
    setData,
  };
}
