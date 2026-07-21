import { useRef, useEffect, useState, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import type { MindMapData, MindNode, NodeID, StickyCard } from '@/types/mindmap';
import { findNodeAt } from '@/engine/mindmapEngine';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { NodeStylePanel } from './NodeStylePanel';

/** 便签预设色板（6 色），点击便签上的色块循环切换 */
const CARD_COLORS = ['#FFF9C4', '#FFCCBC', '#F8BBD0', '#C8E6C9', '#B3E5FC', '#E1BEE7'];
const DEFAULT_CARD_COLOR = CARD_COLORS[0];
/** 便签最小高度，用于新建时垂直居中定位（与 App.css 中 .sticky-card 保持一致） */
const STICKY_MIN_HEIGHT = 70;
/** 便签宽度（与 App.css 中 .sticky-card 保持一致），用于从属连线锚点计算 */
const STICKY_WIDTH = 140;
/** 双击判定间隔（不用原生 dblclick，Tauri WebView 里不稳定） */
const CARD_DBL_CLICK_INTERVAL = 300;

interface MindMapCanvasProps {
  data: MindMapData;
  selectedId: string | null;
  selectedIds: Set<string>;
  editingId: string | null;
  onSelect: (id: string | null, mode?: 'replace' | 'toggle') => void;
  onSelectNodes: (ids: Set<string>) => void;
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
  onMoveNode: (nodeId: string, targetParentId: string) => void;
  onReorderNode: (nodeId: string, insertBeforeSiblingId: string | null) => void;
  onChangeStyle: (id: string, patch: Partial<Pick<MindNode, 'style' | 'icon' | 'tags' | 'priority' | 'progress' | 'note' | 'hyperlink'>>) => void;
  clipboard: { nodes: Record<string, MindNode>; rootId: string } | null;
  onUndo: () => void;
  onRedo: () => void;
  onAddCard: (nodeId: NodeID, dx: number, dy: number) => string;
  onUpdateCardText: (id: string, text: string) => void;
  onMoveCard: (id: string, dx: number, dy: number) => void;
  onDeleteCards: (ids: string[]) => void;
  onSetCardColor: (id: string, color: string) => void;
  connectionStyle?: 'bezier' | 'straight' | 'orthogonal' | 'rounded';
  highlightedIds?: string[];
  onScaleChange?: (scale: number) => void;
}

export interface MindMapCanvasRef {
  centerView: () => void;
  centerOnNode: (nodeId: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  toggleMinimap: () => void;
}

export const MindMapCanvas = forwardRef<MindMapCanvasRef, MindMapCanvasProps>(function MindMapCanvas({
  data,
  selectedId,
  selectedIds,
  editingId,
  onSelect,
  onSelectNodes,
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
  onMoveNode,
  onReorderNode,
  onChangeStyle,
  clipboard,
  onUndo,
  onRedo,
  onAddCard,
  onUpdateCardText,
  onMoveCard,
  onDeleteCards,
  onSetCardColor,
  connectionStyle = 'bezier',
  highlightedIds = [],
  onScaleChange,
}: MindMapCanvasProps,
ref: React.ForwardedRef<MindMapCanvasRef>
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);
  const [stylePanelNodeId, setStylePanelNodeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{
    nodeId: string;
    offsetX: number;
    offsetY: number;
    pointerOffsetX: number;
    pointerOffsetY: number;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const dragRef = useRef(dragging);
  dragRef.current = dragging;

  // 记录鼠标按下时的候选拖拽信息，只有移动超过阈值才真正开始拖拽，
  // 避免普通点击被当成拖拽处理，导致某些环境下 click 事件丢失。
  const dragStartRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    pointerOffsetX: number;
    pointerOffsetY: number;
  } | null>(null);

  const DRAG_THRESHOLD = 3;

  // ---------- 节点附属便签的画布本地状态 ----------
  // 编辑中的便签 id（与节点编辑状态 editingId 相互独立）
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  // 便签拖拽中的临时偏移（仅本地预览，松手才提交到数据层）
  const [cardDrag, setCardDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const cardDragRef = useRef(cardDrag);
  cardDragRef.current = cardDrag;
  // mousedown 时只记录候选拖拽信息，移动超过阈值才真正进入拖拽
  const cardDragStartRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
  } | null>(null);
  // 拖拽刚结束时抑制紧随的 click，避免拖拽被当成双击进入编辑
  const suppressCardClickRef = useRef(false);
  // hover 中的便签 id：用于加深其从属连线颜色，强化关联感
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);

  const handleCardMouseDown = (card: StickyCard, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // 阻止冒泡：便签的按下不能触发节点选中/画布框选/平移
    e.stopPropagation();
    if (editingCardId) return;
    const { x, y } = toCanvas(e.clientX, e.clientY);
    cardDragStartRef.current = { id: card.id, startX: x, startY: y, baseDx: card.dx, baseDy: card.dy };
  };

  // 在节点右侧新建便签：默认放在右边缘外 16px、垂直居中，并立即进入编辑
  const handleAddCard = useCallback(
    (nodeId: NodeID) => {
      const node = dataRef.current.nodes[nodeId];
      if (!node) return;
      const dx = (node.width ?? 120) + 16;
      const dy = Math.round(((node.height ?? 40) - STICKY_MIN_HEIGHT) / 2);
      const id = onAddCard(nodeId, dx, dy);
      setEditingCardId(id);
    },
    [onAddCard]
  );

  // 提交便签编辑：空文本直接删除该便签（常见于便签交互）
  const commitCardEdit = useCallback(
    (id: string, text: string) => {
      const trimmed = text.trim();
      if (trimmed) onUpdateCardText(id, trimmed);
      else onDeleteCards([id]);
      setEditingCardId(null);
    },
    [onUpdateCardText, onDeleteCards]
  );

  // 点击色块循环切换预设色
  const cycleCardColor = useCallback(
    (card: StickyCard) => {
      const index = CARD_COLORS.indexOf(card.color || DEFAULT_CARD_COLOR);
      onSetCardColor(card.id, CARD_COLORS[(index + 1) % CARD_COLORS.length]);
    },
    [onSetCardColor]
  );

  const [view, setView] = useState({ scale: 1, panX: 0, panY: 0 });

  const dataRef = useRef(data);
  dataRef.current = data;

  // 将根节点居中到画布中央
  const centerView = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const root = dataRef.current.nodes[dataRef.current.rootId];
    if (!root) return;
    const rootW = root.width ?? 120;
    const rootH = root.height ?? 40;
    const panX = rect.width / 2 - rootW / 2 - (root.x ?? 0);
    const panY = rect.height / 2 - rootH / 2 - (root.y ?? 0);
    setView({ scale: 1, panX, panY });
  }, []);

  // 将指定节点居中到画布中央
  const centerOnNode = useCallback((nodeId: string) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const node = dataRef.current.nodes[nodeId];
    if (!node) return;
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    const nw = node.width ?? 120;
    const nh = node.height ?? 40;
    const panX = rect.width / 2 - nw / 2 - nx;
    const panY = rect.height / 2 - nh / 2 - ny;
    setView({ scale: 1, panX, panY });
  }, []);

  // 以画布中心为锚点缩放
  const zoomIn = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const oldScale = viewRef.current.scale;
    const newScale = Math.min(oldScale + 0.1, 4);
    const panX = cx - ((cx - viewRef.current.panX) / oldScale) * newScale;
    const panY = cy - ((cy - viewRef.current.panY) / oldScale) * newScale;
    setView({ scale: newScale, panX, panY });
  }, []);

  const zoomOut = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const oldScale = viewRef.current.scale;
    const newScale = Math.max(oldScale - 0.1, 0.2);
    const panX = cx - ((cx - viewRef.current.panX) / oldScale) * newScale;
    const panY = cy - ((cy - viewRef.current.panY) / oldScale) * newScale;
    setView({ scale: newScale, panX, panY });
  }, []);

  const resetZoom = useCallback(() => {
    centerView();
  }, [centerView]);

  const toggleMinimap = useCallback(() => {
    setShowMinimap((v) => !v);
  }, []);

  useImperativeHandle(ref, () => ({ centerView, centerOnNode, zoomIn, zoomOut, resetZoom, toggleMinimap }), [centerView, centerOnNode, zoomIn, zoomOut, resetZoom, toggleMinimap]);

  useEffect(() => {
    onScaleChange?.(view.scale);
  }, [view.scale, onScaleChange]);

  // 初始化以及切换布局时自动居中
  useEffect(() => {
    centerView();
  }, [data.rootId, data.layout, centerView]);
  const [panning, setPanning] = useState<{ startX: number; startY: number; initialPanX: number; initialPanY: number } | null>(null);
  const panningRef = useRef(panning);
  panningRef.current = panning;
  const viewRef = useRef(view);
  viewRef.current = view;
  const [spacePressed, setSpacePressed] = useState(false);
  const spacePressedRef = useRef(spacePressed);
  spacePressedRef.current = spacePressed;

  const closeContextMenu = () => setContextMenu(null);
  const closeStylePanel = () => setStylePanelNodeId(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spacePressedRef.current) {
        setSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    // 应用启动后让画布容器获得焦点，确保 macOS Tauri WebView 能正常接收键盘事件
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  const handleCanvasKeyDown = (_e: React.KeyboardEvent) => {
    // 空格键状态由 window 监听维护，这里保留 focus 行为
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!containerRef.current) return;
    if (!e.ctrlKey && !e.metaKey) {
      // 普通滚轮由浏览器处理（滚动条）
      return;
    }
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const zoomIntensity = 0.001;
    const delta = -e.deltaY * zoomIntensity;
    const scale = Math.min(Math.max(viewRef.current.scale + delta, 0.2), 4);
    const panX = x - (x - viewRef.current.panX) * (scale / viewRef.current.scale);
    const panY = y - (y - viewRef.current.panY) * (scale / viewRef.current.scale);
    setView({ scale, panX, panY });
  };

  const handleNodeContextMenu = (nodeId: string, x: number, y: number) => {
    onSelect(nodeId);
    setContextMenu({ x, y, nodeId });
  };

  const handleNodeMouseDown = (nodeId: string, e: React.MouseEvent) => {
    if (editingId) return;
    if (e.button !== 0) return;
    // 不要 e.preventDefault()，否则 WebKit 会阻止后续 double click 事件。
    // 用 CSS user-select: none 避免文本选中。
    e.stopPropagation();

    // 选择逻辑交给 click 事件处理，避免 mousedown 中立即重渲染破坏双击事件。
    // 这里只记录拖拽起点。
    if (nodeId !== data.rootId) {
      const node = data.nodes[nodeId];
      const { x, y } = toCanvas(e.clientX, e.clientY);
      const pointerOffsetX = node && node.x !== undefined ? x - node.x : 0;
      const pointerOffsetY = node && node.y !== undefined ? y - node.y : 0;
      dragStartRef.current = { nodeId, startX: x, startY: y, pointerOffsetX, pointerOffsetY };
    }
  };

  const handleNodeMouseMove = (nodeId: string, e: React.MouseEvent) => {
    // 拖拽过程中节点的 pointerEvents 保持 auto，mousemove 会同时在容器上处理，
    // 这里只负责从候选拖拽启动真正的拖拽，避免重复更新。
    if (dragRef.current) return;
    if (!dragStartRef.current || dragStartRef.current.nodeId !== nodeId) return;
    const node = data.nodes[nodeId];
    if (!node || node.x === undefined || node.y === undefined) return;
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const dx = Math.abs(x - dragStartRef.current.startX);
    const dy = Math.abs(y - dragStartRef.current.startY);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
      setDragging({
        nodeId,
        offsetX: 0,
        offsetY: 0,
        pointerOffsetX: dragStartRef.current.pointerOffsetX,
        pointerOffsetY: dragStartRef.current.pointerOffsetY,
      });
    }
  };

  const handleNodeMouseUp = (nodeId: string) => {
    if (dragRef.current && dragRef.current.nodeId === nodeId) {
      handleMouseUp();
      return;
    }
    if (dragStartRef.current && dragStartRef.current.nodeId === nodeId) {
      dragStartRef.current = null;
    }
  };

  const [boxSelect, setBoxSelect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const boxSelectRef = useRef(boxSelect);
  boxSelectRef.current = boxSelect;

  const toCanvas = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - viewRef.current.panX) / viewRef.current.scale,
      y: (clientY - rect.top - viewRef.current.panY) / viewRef.current.scale,
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.target !== containerRef.current && e.target !== innerRef.current) return;
    if (e.ctrlKey || e.metaKey || spacePressedRef.current) {
      e.preventDefault();
      setPanning({ startX: e.clientX, startY: e.clientY, initialPanX: viewRef.current.panX, initialPanY: viewRef.current.panY });
      return;
    }
    if (!e.metaKey && !e.shiftKey && !e.ctrlKey) {
      onSelect(null);
    }
    const { x, y } = toCanvas(e.clientX, e.clientY);
    setBoxSelect({ startX: x, startY: y, endX: x, endY: y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // 便签拖拽：更新相对所属节点的偏移预览
    const cardStart = cardDragStartRef.current;
    if (cardStart) {
      const { x, y } = toCanvas(e.clientX, e.clientY);
      const dx = x - cardStart.startX;
      const dy = y - cardStart.startY;
      if (!cardDragRef.current && Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
      setCardDrag({ id: cardStart.id, dx: cardStart.baseDx + dx, dy: cardStart.baseDy + dy });
      return;
    }
    if (boxSelectRef.current) {
      const { x, y } = toCanvas(e.clientX, e.clientY);
      setBoxSelect({ ...boxSelectRef.current, endX: x, endY: y });
      return;
    }
    if (panningRef.current && containerRef.current) {
      const dx = e.clientX - panningRef.current.startX;
      const dy = e.clientY - panningRef.current.startY;
      setView({
        scale: viewRef.current.scale,
        panX: panningRef.current.initialPanX + dx,
        panY: panningRef.current.initialPanY + dy,
      });
      return;
    }
    if (!dragRef.current || !containerRef.current) return;
    const node = data.nodes[dragRef.current.nodeId];
    if (!node || node.x === undefined || node.y === undefined) return;
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const offsetX = x - node.x - dragRef.current.pointerOffsetX;
    const offsetY = y - node.y - dragRef.current.pointerOffsetY;
    setDragging({ ...dragRef.current, offsetX, offsetY });

    const target = findNodeAtCenter(
      data,
      visibleNodes,
      x,
      y,
      dragRef.current.nodeId
    );
    setDropTarget(target);
  };

  const handleMouseUp = () => {
    // 便签拖拽结束：提交新偏移到数据层
    if (cardDragStartRef.current) {
      const drag = cardDragRef.current;
      if (drag) {
        onMoveCard(drag.id, Math.round(drag.dx), Math.round(drag.dy));
        suppressCardClickRef.current = true;
        setCardDrag(null);
      }
      cardDragStartRef.current = null;
      return;
    }
    if (boxSelectRef.current) {
      const { startX, startY, endX, endY } = boxSelectRef.current;
      const minX = Math.min(startX, endX);
      const minY = Math.min(startY, endY);
      const maxX = Math.max(startX, endX);
      const maxY = Math.max(startY, endY);
      const next = new Set<string>();
      visibleNodes.forEach((node) => {
        if (node.id === data.rootId) return;
        if (node.x === undefined || node.y === undefined) return;
        const cx = node.x + (node.width ?? 120) / 2;
        const cy = node.y + (node.height ?? 40) / 2;
        if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
          next.add(node.id);
        }
      });
      if (next.size > 0) onSelectNodes(next);
      setBoxSelect(null);
      return;
    }
    if (panningRef.current) {
      setPanning(null);
      return;
    }
    if (!dragRef.current || !containerRef.current) {
      setDragging(null);
      setDropTarget(null);
      dragStartRef.current = null;
      return;
    }
    const { nodeId, offsetX, offsetY } = dragRef.current;
    const node = data.nodes[nodeId];
    if (node && node.x !== undefined && node.y !== undefined) {
      const finalX = node.x + offsetX + (node.width ?? 120) / 2;
      const finalY = node.y + offsetY + (node.height ?? 40) / 2;
      const targetId = findNodeAtCenter(
        data,
        visibleNodes,
        finalX,
        finalY,
        nodeId
      );
      if (targetId && targetId !== data.rootId) {
        onMoveNode(nodeId, targetId);
      } else if (node.parentId) {
        const insertBefore = findInsertBeforeSibling(
          data,
          node.parentId,
          nodeId,
          finalY
        );
        onReorderNode(nodeId, insertBefore);
      }
    }
    // 拖拽结束后确保被拖拽节点保持选中
    onSelect(nodeId, 'replace');
    setDragging(null);
    setDropTarget(null);
    dragStartRef.current = null;
  };

  const visibleNodes = getVisibleNodes(data);

  // 只渲染所属节点当前可见的便签（折叠隐藏节点的便签不显示）
  const visibleNodeIdSet = new Set(visibleNodes.map((n) => n.id));
  const visibleCards = (data.cards ?? []).filter((c) => visibleNodeIdSet.has(c.nodeId));

  // 便签及其所属节点的布局信息：渲染便签和从属连线共用，保证节点拖拽、便签拖拽、布局重算时同步跟随
  const visibleCardLayouts = visibleCards.flatMap((card) => {
    const node = data.nodes[card.nodeId];
    if (!node || node.x === undefined || node.y === undefined) return [];
    // 节点拖拽中便签跟随节点一起移动；便签自身拖拽时用本地预览偏移
    const nodeOffsetX = dragging?.nodeId === card.nodeId ? dragging.offsetX : 0;
    const nodeOffsetY = dragging?.nodeId === card.nodeId ? dragging.offsetY : 0;
    const preview = cardDrag?.id === card.id ? cardDrag : null;
    return [{
      card,
      nodeX: node.x + nodeOffsetX,
      nodeY: node.y + nodeOffsetY,
      nodeW: node.width ?? 120,
      nodeH: node.height ?? 40,
      left: node.x + nodeOffsetX + (preview ? preview.dx : card.dx),
      top: node.y + nodeOffsetY + (preview ? preview.dy : card.dy),
    }];
  });

  // 根据节点内容动态扩展画布尺寸，至少保留 2000×2000 的基础空间
  const canvasSize = useMemo(() => {
    const bounds = data.canvasBounds;
    const padding = 2000;
    const minSize = 2000;
    if (!bounds) {
      return { width: minSize, height: minSize };
    }
    return {
      width: Math.max(minSize, bounds.maxX + padding),
      height: Math.max(minSize, bounds.maxY + padding),
    };
  }, [data.canvasBounds, data.version]);

  const contextMenuItems: ContextMenuItem[] = (() => {
    if (!contextMenu) return [];
    const id = contextMenu.nodeId;
    const isRoot = id === data.rootId;
    const hasChildren = (data.nodes[id]?.children?.length ?? 0) > 0;
    return [
      { label: '编辑', shortcut: 'Enter', onClick: () => onStartEdit(id) },
      { label: '添加子主题', shortcut: 'Tab/Insert', onClick: () => onAddChild(id) },
      { label: '添加同级主题', shortcut: 'Ctrl+Enter', disabled: isRoot, onClick: () => onAddSibling(id) },
      { label: '添加便签', onClick: () => handleAddCard(id) },
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
        background: 'var(--bg-secondary)',
        cursor: 'default',
        outline: 'none',
      }}
      onClick={(e) => {
        containerRef.current?.focus();
        if (e.target !== containerRef.current && e.target !== innerRef.current) return;
        const { x, y } = toCanvas(e.clientX, e.clientY);
        const node = findNodeAt(data, x, y);
        if (node) {
          onSelect(node.id, e.metaKey || e.shiftKey ? 'toggle' : 'replace');
        } else if (!e.metaKey && !e.shiftKey) {
          onSelect(null);
        }
      }}
      onDoubleClick={(e) => {
        if (e.target !== containerRef.current && e.target !== innerRef.current) return;
        const { x, y } = toCanvas(e.clientX, e.clientY);
        const node = findNodeAt(data, x, y);
        if (node) onStartEdit(node.id);
      }}
      onKeyDown={handleCanvasKeyDown}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      <div
        ref={innerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${canvasSize.width}px`,
          height: `${canvasSize.height}px`,
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`,
          transformOrigin: '0 0',
          cursor: spacePressed ? 'grab' : 'default',
        }}
        onMouseDown={handleCanvasMouseDown}
      >
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 0,
            overflow: 'visible',
          }}
        >
          {renderConnections(data, visibleNodes, connectionStyle, data.layout ?? 'balanced')}
          {renderRelations(data, visibleNodes)}
          {renderStickyLinks(visibleCardLayouts, hoveredCardId)}
        </svg>
          {visibleNodes.map((node) => (
          <NodeView
            key={node.id}
            node={node}
            selected={selectedId === node.id || selectedIds.has(node.id)}
            editing={editingId === node.id}
            highlighted={highlightedIds.includes(node.id)}
            dragging={dragging?.nodeId === node.id}
            offsetX={dragging?.nodeId === node.id ? dragging.offsetX : 0}
            offsetY={dragging?.nodeId === node.id ? dragging.offsetY : 0}
            dropTarget={dropTarget === node.id}
            onSelect={onSelect}
            onStartEdit={onStartEdit}
            onCommitEdit={onCommitEdit}
            onContextMenu={handleNodeContextMenu}
            onMouseDown={handleNodeMouseDown}
            onMouseMove={handleNodeMouseMove}
            onMouseUp={handleNodeMouseUp}
          />
        ))}
        {visibleCardLayouts.map(({ card, left, top }) => (
          <StickyNoteView
            key={card.id}
            card={card}
            left={left}
            top={top}
            editing={editingCardId === card.id}
            dragging={cardDrag?.id === card.id}
            suppressClickRef={suppressCardClickRef}
            onMouseDown={handleCardMouseDown}
            onStartEdit={setEditingCardId}
            onCommitEdit={commitCardEdit}
            onDelete={onDeleteCards}
            onCycleColor={cycleCardColor}
            onHoverChange={setHoveredCardId}
          />
        ))}
        {boxSelect && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(boxSelect.startX, boxSelect.endX),
              top: Math.min(boxSelect.startY, boxSelect.endY),
              width: Math.abs(boxSelect.endX - boxSelect.startX),
              height: Math.abs(boxSelect.endY - boxSelect.startY),
              border: '1px dashed #1890ff',
              background: 'rgba(24, 144, 255, 0.1)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
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
      {showMinimap && (
        <Minimap
          data={data}
          visibleNodes={visibleNodes}
          view={view}
          containerRef={containerRef}
          onChangeView={setView}
          onClose={() => setShowMinimap(false)}
        />
      )}
    </div>
  );
});

function NodeView({
  node,
  selected,
  editing,
  highlighted,
  dragging,
  offsetX,
  offsetY,
  dropTarget,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onContextMenu,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}: {
  node: MindNode;
  selected: boolean;
  editing: boolean;
  highlighted: boolean;
  dragging: boolean;
  offsetX: number;
  offsetY: number;
  dropTarget: boolean;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, label: string) => void;
  onContextMenu: (nodeId: string, x: number, y: number) => void;
  onMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onMouseMove: (nodeId: string, e: React.MouseEvent) => void;
  onMouseUp: (nodeId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const editValueRef = useRef(node.label);
  const lastClickRef = useRef<{ nodeId: string; time: number } | null>(null);
  const DBL_CLICK_INTERVAL = 300;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      editValueRef.current = node.label;
    }
    return () => {
      // 编辑状态被卸载（例如点击外部、切换节点）时，如果还没有保存，则通过 cleanup 保存。
      // 通过 ref 保存而不是依赖 onBlur，因为 React 卸载 input 时不一定触发 onBlur。
      if (editing) {
        onCommitEdit(node.id, editValueRef.current);
      }
    };
  }, [editing, node.id, node.label, onCommitEdit]);

  const left = (node.x ?? 0) + (dragging ? offsetX : 0);
  const top = (node.y ?? 0) + (dragging ? offsetY : 0);
  const width = node.width ?? 120;
  const height = node.height ?? 40;

    const borderColor = node.style?.borderColor || 'var(--node-border)';
    const selectedBorder = `2px solid ${node.style?.borderColor || 'var(--accent-color)'}`;
    const highlightedBorder = '2px solid var(--highlight-border)';
    const border = selected
      ? selectedBorder
      : highlighted
      ? highlightedBorder
      : dropTarget
      ? `2px dashed var(--accent-color)`
      : `1px solid ${borderColor}`;

    const background = node.style?.background ?? 'var(--node-bg)';
    const highlightedBackground = highlighted && !selected ? 'var(--highlight-bg)' : background;

    return (
    <div
    data-node-id={node.id}
    onClick={(e) => {
      e.stopPropagation();
      const now = Date.now();
      const last = lastClickRef.current;
      // 同一节点在 300ms 内第二次点击，视为双击，进入编辑状态。
      if (last && last.nodeId === node.id && now - last.time < DBL_CLICK_INTERVAL) {
        lastClickRef.current = null;
        onStartEdit(node.id);
        return;
      }
      lastClickRef.current = { nodeId: node.id, time: now };
      onSelect(node.id);
    }}
    onDoubleClick={(e) => {
      e.stopPropagation();
      onStartEdit(node.id);
    }}
    onMouseDown={(e) => onMouseDown(node.id, e)}
    onMouseMove={(e) => onMouseMove(node.id, e)}
    onMouseUp={() => onMouseUp(node.id)}
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
      background: highlightedBackground,
      color: node.style?.color ?? 'var(--node-text)',
      border,
      borderRadius: node.style?.shape === 'rectangle' ? 2 : node.style?.shape === 'ellipse' ? 999 : 8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 12px',
      boxShadow: selected ? '0 0 0 2px var(--accent-shadow)' : dragging ? '0 8px 16px rgba(0,0,0,0.35)' : '0 2px 4px rgba(0,0,0,0.2)',
      fontSize: node.style?.fontSize ?? 14,
      fontWeight: node.style?.fontWeight ?? 'normal',
      fontStyle: node.style?.fontStyle ?? 'normal',
      textDecoration: node.style?.textDecoration ?? 'none',
      zIndex: dragging ? 100 : selected ? 10 : highlighted ? 5 : 1,
      opacity: dragging ? 0.8 : 1,
      cursor: dragging ? 'grabbing' : 'grab',
      pointerEvents: 'auto',
      userSelect: 'none',
      WebkitUserSelect: 'none',
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
          onChange={(e) => {
            editValueRef.current = e.target.value;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              // 先 blur 确保 onBlur 触发保存；cleanup 中会再次保存，但为幂等调用。
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              editValueRef.current = node.label;
              e.currentTarget.blur();
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

/** 节点附属便签：位置 = 所属节点坐标 + 相对偏移，跟随画布缩放/平移 */
function StickyNoteView({
  card,
  left,
  top,
  editing,
  dragging,
  suppressClickRef,
  onMouseDown,
  onStartEdit,
  onCommitEdit,
  onDelete,
  onCycleColor,
  onHoverChange,
}: {
  card: StickyCard;
  left: number;
  top: number;
  editing: boolean;
  dragging: boolean;
  suppressClickRef: React.MutableRefObject<boolean>;
  onMouseDown: (card: StickyCard, e: React.MouseEvent) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, text: string) => void;
  onDelete: (ids: string[]) => void;
  onCycleColor: (card: StickyCard) => void;
  onHoverChange: (id: string | null) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editValueRef = useRef(card.text);
  // 进入编辑时的原文本，Esc 取消时恢复（新建空便签因此提交空文本被删除）
  const originalTextRef = useRef(card.text);
  const lastClickRef = useRef(0);

  useEffect(() => {
    if (editing && textareaRef.current) {
      originalTextRef.current = card.text;
      editValueRef.current = card.text;
      textareaRef.current.focus();
      textareaRef.current.select();
    }
    return () => {
      // 编辑状态被卸载（例如撤销删除便签）时兜底提交，通过 ref 保存而不是依赖 onBlur。
      // 仅在内容确实被修改过时提交：StrictMode 会重复挂载/卸载 effect，
      // 无条件提交会把刚新建的空便签当作“空文本提交”误删。
      if (editing && editValueRef.current !== originalTextRef.current) {
        onCommitEdit(card.id, editValueRef.current);
      }
    };
  }, [editing, card.id, card.text, onCommitEdit]);

  // 单击选中/拖拽，双击进入编辑（click 时间戳双击检测，同节点交互）
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (editing) return;
    const now = Date.now();
    if (now - lastClickRef.current < CARD_DBL_CLICK_INTERVAL) {
      lastClickRef.current = 0;
      onStartEdit(card.id);
      return;
    }
    lastClickRef.current = now;
  };

  return (
    <div
      className={['sticky-card', editing ? 'editing' : '', dragging ? 'dragging' : ''].join(' ')}
      style={{ left, top, background: card.color || DEFAULT_CARD_COLOR }}
      data-card-id={card.id}
      onMouseDown={(e) => onMouseDown(card, e)}
      onClick={handleClick}
      onMouseEnter={() => onHoverChange(card.id)}
      onMouseLeave={() => onHoverChange(null)}
      onContextMenu={(e) => {
        // 便签上不弹浏览器默认菜单，也不冒泡到节点右键菜单
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          className="sticky-card-textarea"
          defaultValue={card.text}
          onChange={(e) => {
            editValueRef.current = e.target.value;
          }}
          onBlur={() => onCommitEdit(card.id, editValueRef.current)}
          onKeyDown={(e) => {
            // 阻止冒泡：编辑时不触发画布的节点快捷键
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              // 先 blur 确保 onBlur 触发提交；cleanup 中会再次提交，但为幂等调用
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              editValueRef.current = originalTextRef.current;
              e.currentTarget.blur();
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <div className="sticky-card-text">{card.text || ' '}</div>
          <button
            className="sticky-card-close"
            title="删除便签"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete([card.id]);
            }}
          >
            ×
          </button>
          <button
            className="sticky-card-swatch"
            style={{ background: card.color || DEFAULT_CARD_COLOR }}
            title="切换颜色"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onCycleColor(card);
            }}
          />
        </>
      )}
    </div>
  );
}

/** 便签从属连线的布局信息（与渲染便签共用同一份计算结果） */
interface StickyLinkLayout {
  card: StickyCard;
  nodeX: number;
  nodeY: number;
  nodeW: number;
  nodeH: number;
  left: number;
  top: number;
}

/** 中心指向目标的连线与矩形边缘的交点（连线锚点） */
function edgeAnchor(
  rect: { cx: number; cy: number; hw: number; hh: number },
  towardX: number,
  towardY: number
) {
  const dx = towardX - rect.cx;
  const dy = towardY - rect.cy;
  if (dx === 0 && dy === 0) return { x: rect.cx, y: rect.cy };
  const t = Math.min(
    dx !== 0 ? rect.hw / Math.abs(dx) : Infinity,
    dy !== 0 ? rect.hh / Math.abs(dy) : Infinity
  );
  return { x: rect.cx + dx * t, y: rect.cy + dy * t };
}

/** 绘制便签与所属节点之间的从属连线：细虚线、低对比灰色，与节点间连线区分 */
function renderStickyLinks(layouts: StickyLinkLayout[], hoveredCardId: string | null) {
  if (layouts.length === 0) return null;
  return layouts.map(({ card, nodeX, nodeY, nodeW, nodeH, left, top }) => {
    // 起止点取“节点中心 → 便签中心”连线与各自边缘的交点；
    // 便签实际高度随文本变化，这里按最小高度近似，多出的线头会被卡片遮住
    const nodeRect = { cx: nodeX + nodeW / 2, cy: nodeY + nodeH / 2, hw: nodeW / 2, hh: nodeH / 2 };
    const cardRect = { cx: left + STICKY_WIDTH / 2, cy: top + STICKY_MIN_HEIGHT / 2, hw: STICKY_WIDTH / 2, hh: STICKY_MIN_HEIGHT / 2 };
    const start = edgeAnchor(nodeRect, cardRect.cx, cardRect.cy);
    const end = edgeAnchor(cardRect, nodeRect.cx, nodeRect.cy);
    return (
      <line
        key={card.id}
        className={`sticky-link${hoveredCardId === card.id ? ' hovered' : ''}`}
        data-card-id={card.id}
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        strokeWidth={1}
        strokeDasharray="4,4"
      />
    );
  });
}

function renderConnections(  data: MindMapData,
  visibleNodes: MindNode[],
  connectionStyle: 'bezier' | 'straight' | 'orthogonal' | 'rounded',
  layout: string
) {
  // 组织结构图：正交/圆角风格使用垂直树连线；贝塞尔/直线风格用通用连线，让样式变化可见
  if (layout === 'org') {
    if (connectionStyle === 'orthogonal' || connectionStyle === 'rounded') {
      return renderTopDownTreeConnections(data, visibleNodes, () => true, connectionStyle);
    }
    return renderDefaultConnections(data, visibleNodes, connectionStyle, layout);
  }

  // 时间轴布局：正交/圆角风格时根节点到一级子节点使用垂直树连线；其余样式走通用连线以支持样式变化
  if (layout === 'timeline') {
    if (connectionStyle === 'orthogonal' || connectionStyle === 'rounded') {
      return renderTopDownTreeConnections(data, visibleNodes, (parent) => parent.id === data.rootId, connectionStyle)
        .concat(renderDefaultConnections(data, visibleNodes, connectionStyle, layout, true));
    }
    return renderDefaultConnections(data, visibleNodes, connectionStyle, layout);
  }

  return renderDefaultConnections(data, visibleNodes, connectionStyle, layout);
}

const getConnectionStroke = (data: MindMapData) => data.connectionColor ?? 'var(--connection-color)';
const getConnectionStrokeWidth = (data: MindMapData) => data.connectionWidth ?? 1.5;

function renderDefaultConnections(
  data: MindMapData,
  visibleNodes: MindNode[],
  connectionStyle: 'bezier' | 'straight' | 'orthogonal' | 'rounded',
  layout: string,
  excludeRootChildren: boolean = false
) {
  const visibleSet = new Set(visibleNodes.map((n) => n.id));
  const lines: React.JSX.Element[] = [];
  visibleNodes.forEach((node) => {
    if (!node.children || node.children.length === 0) return;
    if (excludeRootChildren && node.id === data.rootId) return;

    node.children.forEach((childId) => {
      const child = data.nodes[childId];
      if (!child || !visibleSet.has(childId)) return;
      if (
        node.x === undefined ||
        node.y === undefined ||
        child.x === undefined ||
        child.y === undefined
      ) {
        return;
      }

      const { x1, y1, x2, y2 } = connectionAnchors(node, child, layout, data.rootId);
      const path = buildConnectionPath(x1, y1, x2, y2, connectionStyle);
      lines.push(
        <path
          key={`${node.id}-${childId}`}
          d={path}
          fill="none"
          stroke={getConnectionStroke(data)}
          strokeWidth={getConnectionStrokeWidth(data)}
        />
      );
    });
  });
  return lines;
}

/** 绘制跨层级关联线（自由连线） */
function renderRelations(data: MindMapData, visibleNodes: MindNode[]) {
  const relations = data.relations ?? [];
  if (relations.length === 0) return null;
  const visibleSet = new Set(visibleNodes.map((n) => n.id));
  const lines: React.JSX.Element[] = [];

  relations.forEach((relation) => {
    const source = data.nodes[relation.source];
    const target = data.nodes[relation.target];
    if (!source || !target || !visibleSet.has(source.id) || !visibleSet.has(target.id)) return;
    if (
      source.x === undefined ||
      source.y === undefined ||
      target.x === undefined ||
      target.y === undefined
    ) {
      return;
    }

    const { x1, y1, x2, y2 } = connectionAnchors(source, target, 'balanced', data.rootId);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

    lines.push(
      <path
        key={relation.id}
        d={path}
        fill="none"
        stroke={relation.color || '#FF6B6B'}
        strokeWidth={2}
        strokeDasharray={relation.style === 'dashed' ? '6,4' : relation.style === 'dotted' ? '2,4' : undefined}
      />
    );

    if (relation.label) {
      lines.push(
        <text
          key={`${relation.id}-label`}
          x={midX}
          y={midY - 4}
          textAnchor="middle"
          fontSize={11}
          fill={relation.color || '#FF6B6B'}
          style={{ pointerEvents: 'none' }}
        >
          {relation.label}
        </text>
      );
    }
  });

  return lines;
}

/** 绘制标准“上-垂-水平-垂-下”的垂直树连线 */
function renderTopDownTreeConnections(
  data: MindMapData,
  visibleNodes: MindNode[],
  shouldRender: (parent: MindNode) => boolean,
  connectionStyle: 'bezier' | 'straight' | 'orthogonal' | 'rounded'
) {
  const visibleSet = new Set(visibleNodes.map((n) => n.id));
  const lines: React.JSX.Element[] = [];
  const stroke = getConnectionStroke(data);
  const strokeWidth = getConnectionStrokeWidth(data);

  visibleNodes.forEach((parent) => {
    if (!shouldRender(parent)) return;
    if (!parent.children || parent.children.length === 0) return;

    const children = parent.children
      .map((id) => data.nodes[id])
      .filter((child): child is MindNode => !!child && visibleSet.has(child.id));
    if (children.length === 0) return;
    if (parent.x === undefined || parent.y === undefined) return;

    const px = parent.x;
    const py = parent.y;
    const pw = parent.width ?? 120;
    const ph = parent.height ?? 40;
    const pcx = px + pw / 2;
    const pBottom = py + ph;

    const childTops = children.map((child) => {
      const cx = child.x ?? 0;
      const cy = child.y ?? 0;
      const cw = child.width ?? 120;
      return { x: cx + cw / 2, y: cy, id: child.id };
    });

    const minX = Math.min(...childTops.map((c) => c.x));
    const maxX = Math.max(...childTops.map((c) => c.x));
    const childY = childTops[0].y;
    const midY = (pBottom + childY) / 2;

    // 父节点底部 -> 水平主干中点（垂直段）
    lines.push(
      <path
        key={`${parent.id}-trunk`}
        d={buildConnectionPath(pcx, pBottom, pcx, midY, connectionStyle)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );

    // 水平主干（连接最左和最右子节点的上方）
    if (children.length > 1) {
      lines.push(
        <path
          key={`${parent.id}-bar`}
          d={buildConnectionPath(minX, midY, maxX, midY, connectionStyle)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    }

    // 每个子节点顶部 -> 水平主干（垂直段）
    childTops.forEach((childTop) => {
      lines.push(
        <path
          key={`${parent.id}-${childTop.id}-stem`}
          d={buildConnectionPath(childTop.x, midY, childTop.x, childTop.y, connectionStyle)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    });
  });

  return lines;
}

function connectionAnchors(
  parent: MindNode,
  child: MindNode,
  layout: string,
  rootId: NodeID
): { x1: number; y1: number; x2: number; y2: number } {
  const px = parent.x ?? 0;
  const py = parent.y ?? 0;
  const pw = parent.width ?? 120;
  const ph = parent.height ?? 40;
  const cx = child.x ?? 0;
  const cy = child.y ?? 0;
  const cw = child.width ?? 120;
  const ch = child.height ?? 40;

  const pcx = px + pw / 2;
  const pcy = py + ph / 2;
  const ccx = cx + cw / 2;
  const ccy = cy + ch / 2;

  const isRootChild = parent.id === rootId;

  // 组织结构图：所有层级都是垂直分布
  if (layout === 'org') {
    return ccy >= pcy
      ? { x1: pcx, y1: py + ph, x2: ccx, y2: cy }
      : { x1: pcx, y1: py, x2: ccx, y2: cy + ch };
  }

  // 时间轴布局：根节点到一级子节点固定使用垂直连接（避免根节点被水平线穿过）
  if (layout === 'timeline' && isRootChild) {
    return ccy >= pcy
      ? { x1: pcx, y1: py + ph, x2: ccx, y2: cy }
      : { x1: pcx, y1: py, x2: ccx, y2: cy + ch };
  }

  // 平衡树、鱼骨图、时间轴的非根层级：统一使用水平连接
  return ccx >= pcx
    ? { x1: px + pw, y1: pcy, x2: cx, y2: ccy }
    : { x1: px, y1: pcy, x2: cx + cw, y2: ccy };
}

function buildConnectionPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: 'bezier' | 'straight' | 'orthogonal' | 'rounded'
): string {
  // 退化线段（垂直或水平）直接用直线，避免 orthogonal/rounded 出现零长度折段
  if (x1 === x2 || y1 === y2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  switch (style) {
    case 'straight':
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    case 'orthogonal': {
      const midX = (x1 + x2) / 2;
      return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
    }
    case 'rounded': {
      const midX = (x1 + x2) / 2;
      const radius = 12;
      const dirX = x2 > x1 ? 1 : -1;
      const dirY = y2 > y1 ? 1 : -1;
      const rx = Math.min(radius, Math.abs(midX - x1) / 2, Math.abs(x2 - midX) / 2);
      const ry = Math.min(radius, Math.abs(y2 - y1) / 2);
      return `M ${x1} ${y1} L ${midX - dirX * rx} ${y1} Q ${midX} ${y1} ${midX} ${y1 + dirY * ry} L ${midX} ${y2 - dirY * ry} Q ${midX} ${y2} ${midX + dirX * rx} ${y2} L ${x2} ${y2}`;
    }
    case 'bezier':
    default: {
      const midX = (x1 + x2) / 2;
      return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    }
  }
}

function NodeContent({ node }: { node: MindNode }) {
  const icon = node.icon ? `${node.icon} ` : '';
  const html = markdownToHtml(`${icon}${node.label}`);
  return (
    <span
      style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      title={node.note ? `${node.label}\n\n${node.note}` : node.label}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function markdownToHtml(text: string): string {
  return (
    text
      // 转义 HTML 特殊字符
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // 加粗 **text**
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // 斜体 *text* 或 _text_
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      // 删除线 ~~text~~
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      // 行内代码 `text`
      .replace(/`(.+?)`/g, '<code style="background:rgba(0,0,0,0.06);padding:1px 4px;border-radius:3px;">$1</code>')
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

function findNodeAtCenter(
  _data: MindMapData,
  visibleNodes: MindNode[],
  x: number,
  y: number,
  excludeId: string
): string | null {
  for (const node of visibleNodes) {
    if (node.id === excludeId) continue;
    const cx = (node.x ?? 0) + (node.width ?? 120) / 2;
    const cy = (node.y ?? 0) + (node.height ?? 40) / 2;
    const rx = (node.width ?? 120) / 2;
    const ry = (node.height ?? 40) / 2;
    if (x >= cx - rx && x <= cx + rx && y >= cy - ry && y <= cy + ry) {
      return node.id;
    }
  }
  return null;
}

function findInsertBeforeSibling(
  data: MindMapData,
  parentId: string,
  nodeId: string,
  y: number
): string | null {
  const parent = data.nodes[parentId];
  if (!parent) return null;
  const siblings = parent.children.filter((id) => id !== nodeId);
  for (const siblingId of siblings) {
    const sibling = data.nodes[siblingId];
    if (!sibling || sibling.y === undefined) continue;
    if (y < sibling.y + (sibling.height ?? 40) / 2) {
      return siblingId;
    }
  }
  return null;
}

interface MinimapProps {
  data: MindMapData;
  visibleNodes: MindNode[];
  view: { scale: number; panX: number; panY: number };
  containerRef: React.RefObject<HTMLDivElement | null>;
  onChangeView: (view: { scale: number; panX: number; panY: number }) => void;
  onClose: () => void;
}

const MAP_WIDTH = 200;
const MAP_HEIGHT = 150;
const MAP_PADDING = 400;

function Minimap({ data, visibleNodes, view, containerRef, onChangeView, onClose }: MinimapProps) {
  const rect = containerRef.current?.getBoundingClientRect();
  const containerWidth = rect?.width ?? 0;
  const containerHeight = rect?.height ?? 0;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  visibleNodes.forEach((node) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const w = node.width ?? 120;
    const h = node.height ?? 40;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  // 包含当前可视区域
  const viewportLeft = -view.panX / view.scale;
  const viewportTop = -view.panY / view.scale;
  const viewportRight = viewportLeft + containerWidth / view.scale;
  const viewportBottom = viewportTop + containerHeight / view.scale;
  minX = Math.min(minX, viewportLeft);
  minY = Math.min(minY, viewportTop);
  maxX = Math.max(maxX, viewportRight);
  maxY = Math.max(maxY, viewportBottom);

  if (minX === Infinity) {
    minX = 0;
    minY = 0;
    maxX = 2000;
    maxY = 2000;
  }

  minX -= MAP_PADDING;
  minY -= MAP_PADDING;
  maxX += MAP_PADDING;
  maxY += MAP_PADDING;

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const scale = Math.min(MAP_WIDTH / contentWidth, MAP_HEIGHT / contentHeight);
  const offsetX = (MAP_WIDTH - contentWidth * scale) / 2;
  const offsetY = (MAP_HEIGHT - contentHeight * scale) / 2;

  const toMapX = (x: number) => (x - minX) * scale + offsetX;
  const toMapY = (y: number) => (y - minY) * scale + offsetY;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const canvasX = (mx - offsetX) / scale + minX;
    const canvasY = (my - offsetY) / scale + minY;
    const newPanX = containerWidth / 2 - canvasX * view.scale;
    const newPanY = containerHeight / 2 - canvasY * view.scale;
    onChangeView({ scale: view.scale, panX: newPanX, panY: newPanY });
  };

  return (
    <div
      style={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        background: 'var(--bg-toolbar)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        overflow: 'hidden',
        zIndex: 1000,
        cursor: 'pointer',
      }}
      onClick={handleClick}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 18,
          height: 18,
          border: 'none',
          background: 'transparent',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 12,
          lineHeight: '18px',
          textAlign: 'center',
          zIndex: 10,
        }}
      >
        ×
      </button>
      <svg width={MAP_WIDTH} height={MAP_HEIGHT}>
        {visibleNodes.map((node) => {
          const x = toMapX(node.x ?? 0);
          const y = toMapY(node.y ?? 0);
          const w = Math.max(2, (node.width ?? 120) * scale);
          const h = Math.max(2, (node.height ?? 40) * scale);
          return (
            <rect
              key={node.id}
              x={x}
              y={y}
              width={w}
              height={h}
              fill={node.id === data.rootId ? 'var(--accent-color)' : 'var(--text-secondary)'}
              opacity={0.6}
              rx={2}
            />
          );
        })}
        <rect
          x={toMapX(viewportLeft)}
          y={toMapY(viewportTop)}
          width={(containerWidth / view.scale) * scale}
          height={(containerHeight / view.scale) * scale}
          fill="none"
          stroke="var(--accent-color)"
          strokeWidth={2}
        />
      </svg>
    </div>
  );
}

