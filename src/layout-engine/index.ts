import type { NodeID, MindNode, NodeStyle, MindMapLayout, ConnectionStyle } from '@/types/mindmap';

/** 布局引擎统一主题配置 */
export interface Theme {
  siblingGap: number;
  levelGap: number;
  paddingX: number;
  paddingY: number;
  lineStyle: 'bezier' | 'polyline' | 'straight';
  direction: 'right' | 'left' | 'top' | 'bottom' | 'radial';
}

/** 单个节点边界框 */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 布局引擎输入：树形节点 */
export interface LayoutNode {
  id: NodeID;
  text: string;
  children: LayoutNode[];
  collapsed?: boolean;
  style?: NodeStyle;
}

/** 布局结果 */
export interface LayoutResult {
  nodes: Array<{
    id: NodeID;
    x: number;
    y: number;
    width: number;
    height: number;
    level: number;
    branchIndex: number;
  }>;
  edges: Array<{
    from: NodeID;
    to: NodeID;
    path: string;
  }>;
  canvasBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
}

/** 内部工作节点 */
export interface WorkingNode {
  id: NodeID;
  text: string;
  children: WorkingNode[];
  collapsed: boolean;
  style?: NodeStyle;
  bbox: BBox;
  level: number;
  branchIndex: number;
  branchSide?: 'left' | 'right';
  parent?: WorkingNode;
}

/** 默认主题 */
export const DEFAULT_THEME: Theme = {
  siblingGap: 24,
  levelGap: 80,
  paddingX: 16,
  paddingY: 10,
  lineStyle: 'bezier',
  direction: 'right',
};

/** 层级样式（文档 7.1） */
export const LEVEL_STYLES = [
  { fontSize: 24, fontWeight: 'bold' as const, paddingX: 20, paddingY: 12, borderRadius: 6 },
  { fontSize: 18, fontWeight: 'bold' as const, paddingX: 16, paddingY: 10, borderRadius: 5 },
  { fontSize: 14, fontWeight: 'normal' as const, paddingX: 12, paddingY: 6, borderRadius: 4 },
];

/** 主干分支配色 */
export const BRANCH_COLORS = [
  '#4A90D9', '#E74C3C', '#2ECC71', '#F39C12', '#9B59B6',
  '#1ABC9C', '#34495E', '#E91E63', '#00BCD4', '#FF5722',
];

export function createTheme(partial?: Partial<Theme>): Theme {
  return { ...DEFAULT_THEME, ...partial };
}

/** 将 MindNode 的 Record 结构转换为树形结构 */
export function convertToLayoutTree(
  rootId: NodeID,
  nodes: Record<NodeID, MindNode>,
  parent?: WorkingNode,
  level = 0,
  branchIndex = 0
): WorkingNode {
  const node = nodes[rootId];
  const working: WorkingNode = {
    id: node.id,
    text: node.label,
    children: [],
    collapsed: !!node.collapsed,
    style: node.style,
    bbox: { x: 0, y: 0, width: 0, height: 0 },
    level,
    branchIndex,
    branchSide: node.branchSide,
    parent,
  };
  if (!node.collapsed && node.children) {
    working.children = node.children.map((childId, idx) =>
      convertToLayoutTree(childId, nodes, working, level + 1, level === 0 ? idx : branchIndex)
    );
  }
  return working;
}

/** 计算节点尺寸：自底向上 */
export function measureNode(node: WorkingNode, theme: Theme): void {
  if (node.children && node.children.length > 0) {
    node.children.forEach((child) => measureNode(child, theme));
  }

  if (node.style?.width && node.style?.height) {
    node.bbox.width = node.style.width;
    node.bbox.height = node.style.height;
  } else {
    const levelStyle = LEVEL_STYLES[Math.min(node.level, LEVEL_STYLES.length - 1)];
    const fontSize = node.style?.fontSize ?? levelStyle.fontSize;
    // 与 MindMapCanvas 中 NodeView 的 CSS padding 保持一致
    const paddingX = node.style?.width ? 0 : 12;
    const paddingY = node.style?.height ? 0 : levelStyle.paddingY;
    // 中文等宽字符按 fontSize 估算，ASCII 按 0.6 估算
    const chars = Array.from(node.text);
    const wideCount = chars.filter((ch) => ch.charCodeAt(0) > 127).length;
    const narrowCount = chars.length - wideCount;
    const textWidth = wideCount * fontSize + narrowCount * fontSize * 0.6;
    node.bbox.width = Math.max(80, textWidth + paddingX * 2 + 8);
    node.bbox.height = fontSize + paddingY * 2;
  }
}

/** 重新向上回溯测量尺寸 */
export function reMeasureUpward(node: WorkingNode, theme: Theme): void {
  measureNode(node, theme);
  let current: WorkingNode | undefined = node.parent;
  while (current) {
    measureNode(current, theme);
    current = current.parent;
  }
}

/** 计算所有节点的边界 */
export function computeCanvasBounds(roots: WorkingNode[]): LayoutResult['canvasBounds'] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visit = (node: WorkingNode) => {
    minX = Math.min(minX, node.bbox.x);
    minY = Math.min(minY, node.bbox.y);
    maxX = Math.max(maxX, node.bbox.x + node.bbox.width);
    maxY = Math.max(maxY, node.bbox.y + node.bbox.height);
    if (!node.collapsed) node.children.forEach(visit);
  };
  roots.forEach(visit);

  if (minX === Infinity) {
    minX = minY = 0;
    maxX = maxY = 0;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** 把工作节点转换回布局结果 */
export function toLayoutResult(root: WorkingNode, theme: Theme): LayoutResult {
  const nodes: LayoutResult['nodes'] = [];
  const edges: LayoutResult['edges'] = [];

  const visit = (node: WorkingNode) => {
    nodes.push({
      id: node.id,
      x: node.bbox.x,
      y: node.bbox.y,
      width: node.bbox.width,
      height: node.bbox.height,
      level: node.level,
      branchIndex: node.branchIndex,
    });
    if (!node.collapsed) {
      node.children.forEach((child) => {
        edges.push({
          from: node.id,
          to: child.id,
          path: buildEdgePath(node.bbox, child.bbox, theme),
        });
        visit(child);
      });
    }
  };
  visit(root);

  return {
    nodes,
    edges,
    canvasBounds: computeCanvasBounds([root]),
  };
}

/** 计算锚点 */
export function getAnchor(
  bbox: BBox,
  direction: 'right' | 'left' | 'top' | 'bottom'
): { x: number; y: number } {
  switch (direction) {
    case 'right':
      return { x: bbox.x + bbox.width, y: bbox.y + bbox.height / 2 };
    case 'left':
      return { x: bbox.x, y: bbox.y + bbox.height / 2 };
    case 'bottom':
      return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height };
    case 'top':
      return { x: bbox.x + bbox.width / 2, y: bbox.y };
  }
}

/** 构建连线路径 */
export function buildEdgePath(
  parentBBox: BBox,
  childBBox: BBox,
  theme: Theme
): string {
  const direction = inferDirection(parentBBox, childBBox);
  const start = getAnchor(parentBBox, direction);
  const end = getAnchor(childBBox, oppositeDirection(direction));
  const style = theme.lineStyle;

  switch (style) {
    case 'straight':
      return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    case 'polyline': {
      const midX = (start.x + end.x) / 2;
      return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
    }
    case 'bezier':
    default: {
      const midX = (start.x + end.x) / 2;
      return `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
    }
  }
}

export function inferDirection(
  parentBBox: BBox,
  childBBox: BBox
): 'right' | 'left' | 'top' | 'bottom' {
  const dx = childBBox.x + childBBox.width / 2 - (parentBBox.x + parentBBox.width / 2);
  const dy = childBBox.y + childBBox.height / 2 - (parentBBox.y + parentBBox.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

function oppositeDirection(
  dir: 'right' | 'left' | 'top' | 'bottom'
): 'right' | 'left' | 'top' | 'bottom' {
  switch (dir) {
    case 'right': return 'left';
    case 'left': return 'right';
    case 'top': return 'bottom';
    case 'bottom': return 'top';
  }
}

/** 根据 MindMapLayout + ConnectionStyle 映射为 Theme */
export function toTheme(layout: MindMapLayout | undefined, connectionStyle: ConnectionStyle | undefined): Theme {
  const mapLayoutToDirection: Record<MindMapLayout, Theme['direction']> = {
    balanced: 'radial',
    fishbone: 'right',
    timeline: 'bottom',
    org: 'bottom',
    leftTree: 'left',
    rightTree: 'right',
  };
  return {
    ...DEFAULT_THEME,
    direction: mapLayoutToDirection[layout ?? 'balanced'],
    lineStyle: (connectionStyle === 'orthogonal' || connectionStyle === 'rounded') ? 'polyline' : (connectionStyle ?? 'bezier'),
  };
}

/** 节点级别样式计算：根据层级和分支 */
export function computeEffectiveStyle(node: WorkingNode): Partial<NodeStyle> {
  const levelStyle = LEVEL_STYLES[Math.min(node.level, LEVEL_STYLES.length - 1)];
  const branchColor = node.level > 0 ? BRANCH_COLORS[node.branchIndex % BRANCH_COLORS.length] : undefined;
  return {
    fontSize: levelStyle.fontSize,
    fontWeight: levelStyle.fontWeight,
    color: node.level > 0 ? branchColor : undefined,
    borderColor: node.level > 0 ? branchColor : undefined,
  };
}

/** 获取布局结果中节点应该应用的样式 */
export function getLayoutStyles(root: WorkingNode): Record<NodeID, Partial<NodeStyle>> {
  const styles: Record<NodeID, Partial<NodeStyle>> = {};
  const visit = (node: WorkingNode) => {
    styles[node.id] = computeEffectiveStyle(node);
    if (!node.collapsed) node.children.forEach(visit);
  };
  visit(root);
  return styles;
}
