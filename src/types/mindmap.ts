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
}

export interface MindMapData {
  rootId: NodeID;
  nodes: Record<NodeID, MindNode>;
  version: number;
}

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
