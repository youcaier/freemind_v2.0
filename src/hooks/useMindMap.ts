import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MindMapData,
  MindNode,
  NodeID,
  MindRelation,
} from '@/types/mindmap';
import {
  createEmptyMindMap,
  addNode,
  addSiblingNode as addSiblingNodeEngine,
  removeNode,
  calculateTreeLayout,
  recomputeCanvasBounds,
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

// 收集节点及其所有后代 id：删除节点/子树时联动清理附属便签
function collectSubtreeIds(data: MindMapData, id: NodeID): Set<NodeID> {
  const result = new Set<NodeID>();
  const walk = (nid: NodeID) => {
    if (result.has(nid)) return;
    result.add(nid);
    data.nodes[nid]?.children.forEach(walk);
  };
  walk(id);
  return result;
}

export function useMindMap() {  const [data, setData] = useState<MindMapData>(() => calculateTreeLayout(createEmptyMindMap()));
  const [selectedId, setSelectedId] = useState<NodeID | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<NodeID>>(new Set());
  const [editingId, setEditingId] = useState<NodeID | null>(null);
  const editingRef = useRef<HTMLInputElement | null>(null);

  // 撤销/重做历史栈：保存完整状态序列，historyIndex 指向当前状态在栈中的位置
  const [history, setHistory] = useState<MindMapData[]>(() => [data]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const canUndo = historyIndex > 0;
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
      // 只有影响节点测量的字段（宽高/字号）才需要重排，其余装饰性修改走轻路径
      const affectsMeasurement = !!patch.style && (
        patch.style.width !== undefined || patch.style.height !== undefined || patch.style.fontSize !== undefined
      );
      return affectsMeasurement ? calculateTreeLayout(next) : next;
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
      // 先收集将被删除的节点 id，再联动移除其附属便签
      const removedIds = new Set<NodeID>();
      ids.forEach((id) => collectSubtreeIds(prev, id).forEach((i) => removedIds.add(i)));
      ids.forEach((id) => removeNode(next, id));
      if (next.cards) next.cards = next.cards.filter((c) => !removedIds.has(c.nodeId));
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
      const removedIds = new Set<NodeID>();
      ids.forEach((id) => collectSubtreeIds(prev, id).forEach((i) => removedIds.add(i)));
      ids.forEach((id) => removeNode(next, id));
      if (next.cards) next.cards = next.cards.filter((c) => !removedIds.has(c.nodeId));
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
    if (id === data.rootId) return;
    const node = data.nodes[id];
    const subtree = cloneSubtree(data, id);
    if (!subtree) {
      const fallback = { nodes: { [id]: { ...node, id, children: [] } }, rootId: id };
      clipboardRef.current = fallback;
      setClipboard(fallback);
      return;
    }
    const next = { nodes: subtree.nodes, rootId: subtree.node.id };
    clipboardRef.current = next;
    setClipboard(next);
  }, [data, data.rootId]);

  const cutNode = useCallback((id: NodeID) => {
    if (id === data.rootId) return;
    copyNode(id);
    setData((prev) => {
      const target = prev.nodes[id];
      if (!target) return prev;
      const next: MindMapData = { ...prev, nodes: { ...prev.nodes } };
      const removedIds = collectSubtreeIds(prev, id);
      removeNode(next, id);
      if (next.cards) next.cards = next.cards.filter((c) => !removedIds.has(c.nodeId));
      return calculateTreeLayout(next);
    });
    if (selectedId === id) {
      setSelectedId(null);
      setEditingId(null);
    }
  }, [copyNode, data.rootId, selectedId]);

  const pasteNode = useCallback((parentId: NodeID) => {
    const current = clipboardRef.current;
    if (!current) return;
    let newId: NodeID | null = null;
    setData((prev) => {
      const next: MindMapData = { ...prev, nodes: { ...prev.nodes } };
      try {
        newId = insertSubtree(next, parentId, current, current.rootId);
      } catch (e) {
        console.error('[pasteNode] error=', e);
      }
      return calculateTreeLayout(next);
    });
    if (newId) {
      setSelectedId(newId);
      setEditingId(null);
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

  // 设置节点的手动偏移（自由拖拽松手提交，单步进历史栈）。
  // x/y 存的是有效位置（基础坐标 + 累计偏移），因此只需把偏移变化量平移到整个子树，
  // 无需重跑测量+布局；切勿改成重算偏移，否则偏移会被重复累加。
  const setNodeOffset = useCallback((id: NodeID, offsetX: number, offsetY: number) => {
    setData((prev) => {
      const target = prev.nodes[id];
      if (!target) return prev;
      const dX = offsetX - (target.offsetX ?? 0);
      const dY = offsetY - (target.offsetY ?? 0);
      if (dX === 0 && dY === 0) return prev;
      const next: MindMapData = { ...prev, nodes: { ...prev.nodes } };
      const shift = (nid: NodeID) => {
        const n = next.nodes[nid];
        if (!n) return;
        next.nodes[nid] = nid === id
          ? { ...n, offsetX, offsetY, x: (n.x ?? 0) + dX, y: (n.y ?? 0) + dY }
          : { ...n, x: (n.x ?? 0) + dX, y: (n.y ?? 0) + dY };
        n.children.forEach(shift);
      };
      shift(id);
      recomputeCanvasBounds(next);
      return next;
    });
  }, []);

  // 清空所有节点的手动偏移，回到纯自动布局（可撤销）
  const resetOffsets = useCallback(() => {
    setData((prev) => {
      if (!Object.values(prev.nodes).some((n) => (n.offsetX ?? 0) !== 0 || (n.offsetY ?? 0) !== 0)) return prev;
      const nodes: Record<NodeID, MindNode> = {};
      Object.values(prev.nodes).forEach((n) => {
        nodes[n.id] = { ...n, offsetX: 0, offsetY: 0 };
      });
      return calculateTreeLayout({ ...prev, nodes });
    });
  }, []);

  // 重新执行自动布局（保留所有手动偏移）
  const relayout = useCallback(() => {
    setData((prev) => calculateTreeLayout({ ...prev }));
  }, []);

  // 撤销/重做
  const undo = useCallback(() => {
    if (!canUndo) return;
    isHistoryActionRef.current = true;
    setData(history[historyIndex - 1]);
    setHistoryIndex((i) => i - 1);
  }, [canUndo, history, historyIndex]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    isHistoryActionRef.current = true;
    setData(history[historyIndex + 1]);
    setHistoryIndex((i) => i + 1);
  }, [canRedo, history, historyIndex]);

  // 记录操作历史：data 变化后把新状态追加到历史栈（截断重做尾部）
  const prevDataRef = useRef<MindMapData>(data);
  useEffect(() => {
    if (prevDataRef.current !== data) {
      if (isHistoryActionRef.current) {
        isHistoryActionRef.current = false;
      } else {
        // 必须先把快照存到局部变量：setHistory 的 updater 可能延迟到下次渲染才执行，
        // 直接读闭包外的可变量会拿到错误的状态
        const snapshot = data;
        setHistory((prev) => [...prev.slice(0, historyIndex + 1), snapshot]);
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
    // 连线样式只影响绘制，不参与测量与布局，跳过重排
    setData((prev) => ({ ...prev, connectionStyle }));
  }, []);

  const changeConnectionColor = useCallback((connectionColor: string) => {
    setData((prev) => ({ ...prev, connectionColor }));
  }, []);

  const changeConnectionWidth = useCallback((connectionWidth: number) => {
    setData((prev) => ({ ...prev, connectionWidth }));
  }, []);

  // ---------- 节点附属便签操作 ----------
  // 便签数据挂在 MindMapData.cards 上，撤销/重做历史栈自动覆盖便签操作

  // 新建便签：id 在 updater 外预生成并返回，便于画布立即进入编辑态
  const addCard = useCallback((nodeId: NodeID, dx: number, dy: number): string => {
    const id = `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setData((prev) => {
      if (!prev.nodes[nodeId]) return prev;
      return {
        ...prev,
        cards: [...(prev.cards ?? []), { id, nodeId, text: '', dx, dy }],
      };
    });
    return id;
  }, []);

  const updateCardText = useCallback((id: string, text: string) => {
    setData((prev) => {
      const cards = prev.cards ?? [];
      const target = cards.find((c) => c.id === id);
      if (!target || target.text === text) return prev;
      return { ...prev, cards: cards.map((c) => (c.id === id ? { ...c, text } : c)) };
    });
  }, []);

  // 拖拽便签只改变其相对所属节点的偏移
  const moveCard = useCallback((id: string, dx: number, dy: number) => {
    setData((prev) => {
      const cards = prev.cards ?? [];
      const target = cards.find((c) => c.id === id);
      if (!target || (target.dx === dx && target.dy === dy)) return prev;
      return { ...prev, cards: cards.map((c) => (c.id === id ? { ...c, dx, dy } : c)) };
    });
  }, []);

  const deleteCards = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setData((prev) => ({
      ...prev,
      cards: (prev.cards ?? []).filter((c) => !idSet.has(c.id)),
    }));
  }, []);

  const setCardColor = useCallback((id: string, color: string) => {
    setData((prev) => {
      const cards = prev.cards ?? [];
      const target = cards.find((c) => c.id === id);
      if (!target || target.color === color) return prev;
      return { ...prev, cards: cards.map((c) => (c.id === id ? { ...c, color } : c)) };
    });
  }, []);

  const addRelation = useCallback((source: NodeID, target: NodeID, label?: string) => {    setData((prev) => {
      if (!prev.nodes[source] || !prev.nodes[target] || source === target) return prev;
      const relation: MindRelation = {
        id: `${source}-${target}-${Date.now()}`,
        source,
        target,
        label,
        color: '#FF6B6B',
        style: 'dashed',
      };
      // 关系线不参与布局，跳过重排
      const relations = [...(prev.relations ?? []), relation];
      return { ...prev, relations };
    });
  }, []);

  const removeRelation = useCallback((relationId: string) => {
    setData((prev) => {
      const relations = (prev.relations ?? []).filter((r) => r.id !== relationId);
      return { ...prev, relations };
    });
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
    setNodeOffset,
    resetOffsets,
    relayout,
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
    addRelation,
    removeRelation,
    addCard,
    updateCardText,
    moveCard,
    deleteCards,
    setCardColor,
    setData,
  };
}
