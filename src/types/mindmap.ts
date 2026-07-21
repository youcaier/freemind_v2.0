export type NodeID = string;

export interface MindNode {
  id: NodeID;
  label: string;
  children: NodeID[];
  collapsed?: boolean;
  style?: NodeStyle;
  icon?: string;
  tags?: string[];
  priority?: number;
  progress?: number;
  note?: string;
  hyperlink?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parentId?: NodeID;
  /** 平衡布局下该节点所在侧（仅根节点子节点有意义，其余继承父节点） */
  branchSide?: 'left' | 'right';
}

export interface NodeStyle {
  background?: string;
  color?: string;
  borderColor?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline' | 'line-through';
  shape?: 'rectangle' | 'rounded' | 'ellipse';
  width?: number;
  height?: number;
}

export interface MindRelation {
  id: string;
  source: NodeID;
  target: NodeID;
  label?: string;
  color?: string;
  style?: 'solid' | 'dashed' | 'dotted';
}

/** 便签：挂在某个导图节点上的附属物，坐标为相对节点左上角的偏移，跟随节点移动 */
export interface StickyCard {
  id: string;
  nodeId: NodeID;      // 所属节点
  text: string;
  color?: string;      // 便签底色，预设色板
  dx: number;          // 相对节点左上角的偏移（画布坐标）
  dy: number;
}

export interface MindMapData {
  rootId: NodeID;
  nodes: Record<NodeID, MindNode>;
  relations?: MindRelation[];
  /** 节点附属便签（可选字段，保证旧 .freemind 文件兼容） */
  cards?: StickyCard[];
  version: number;
  layout?: MindMapLayout;
  connectionStyle?: ConnectionStyle;
  connectionColor?: string;
  connectionWidth?: number;
  canvasBounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
}

export type MindMapLayout = 'balanced' | 'fishbone' | 'timeline' | 'org' | 'leftTree' | 'rightTree';

export type ConnectionStyle = 'bezier' | 'straight' | 'orthogonal' | 'rounded';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
