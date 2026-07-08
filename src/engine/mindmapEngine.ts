import type { MindMapData, MindNode, NodeID } from '@/types/mindmap';

const DEFAULT_NODE_WIDTH = 120;
const DEFAULT_NODE_HEIGHT = 40;
const HORIZONTAL_GAP = 80;
const VERTICAL_GAP = 20;

export function createEmptyMindMap(): MindMapData {
  const rootId = 'root';
  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId,
        label: '中心主题',
        children: [],
        collapsed: false,
      },
    },
    version: 1,
  };
}

export function addNode(data: MindMapData, parentId: NodeID, label = '分支主题'): MindNode {
  const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const parent = data.nodes[parentId];
  if (!parent) throw new Error(`Parent not found: ${parentId}`);

  const node: MindNode = {
    id,
    label,
    children: [],
    collapsed: false,
    parentId,
  };
  data.nodes[id] = node;
  parent.children.push(id);
  data.version++;
  return node;
}

export function addSiblingNode(data: MindMapData, siblingId: NodeID, label = '分支主题'): MindNode {
  const sibling = data.nodes[siblingId];
  if (!sibling) throw new Error(`Sibling not found: ${siblingId}`);
  if (!sibling.parentId) throw new Error(`Cannot add sibling to root: ${siblingId}`);
  return addNode(data, sibling.parentId, label);
}

export function cloneSubtree(data: MindMapData, id: NodeID): { node: MindNode; nodes: Record<NodeID, MindNode> } | null {
  const node = data.nodes[id];
  if (!node) return null;
  const nodes: Record<NodeID, MindNode> = {};
  let counter = 0;
  const visited = new Set<NodeID>();
  const clone = (nodeId: NodeID): MindNode | null => {
    if (visited.has(nodeId)) return null; // 防御循环引用：跳过
    visited.add(nodeId);
    const n = data.nodes[nodeId];
    if (!n) return null; // 防御缺失子节点引用：跳过
    const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${counter++}-${nodeId.slice(0, 8)}`;
    const cloned: MindNode = { ...n, id: newId, children: [] };
    nodes[newId] = cloned;
    n.children.forEach((childId) => {
      const child = clone(childId);
      if (child) cloned.children.push(child.id);
    });
    return cloned;
  };
  const clonedRoot = clone(id);
  if (!clonedRoot) return null;
  return { node: clonedRoot, nodes };
}

export function insertSubtree(data: MindMapData, parentId: NodeID, subtree: { nodes: Record<NodeID, MindNode> }, rootId: NodeID): NodeID {
  const parent = data.nodes[parentId];
  if (!parent) throw new Error(`Parent not found: ${parentId}`);
  const idMap = new Map<NodeID, NodeID>();
  let counter = 0;
  Object.values(subtree.nodes).forEach((node) => {
    const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${counter++}-${node.id.slice(0, 8)}`;
    idMap.set(node.id, newId);
    data.nodes[newId] = { ...node, id: newId, children: [], parentId: undefined };
  });
  Object.values(subtree.nodes).forEach((node) => {
    const newId = idMap.get(node.id)!;
    const newNode = data.nodes[newId];
    // 只连接存在于 subtree 中的子节点，避免指向外部节点或形成环
    newNode.children = node.children
      .map((childId) => idMap.get(childId))
      .filter((childId): childId is NodeID => childId !== undefined);
    newNode.children.forEach((childId) => {
      data.nodes[childId].parentId = newId;
    });
  });
  const newRootId = idMap.get(rootId)!;
  data.nodes[newRootId].parentId = parentId;
  parent.children.push(newRootId);
  data.version++;
  return newRootId;
}

export function findNextSibling(data: MindMapData, id: NodeID): NodeID | null {
  const node = data.nodes[id];
  if (!node || !node.parentId) return null;
  const siblings = data.nodes[node.parentId].children;
  const index = siblings.indexOf(id);
  if (index === -1 || index === siblings.length - 1) return null;
  return siblings[index + 1];
}

export function findPrevSibling(data: MindMapData, id: NodeID): NodeID | null {
  const node = data.nodes[id];
  if (!node || !node.parentId) return null;
  const siblings = data.nodes[node.parentId].children;
  const index = siblings.indexOf(id);
  if (index <= 0) return null;
  return siblings[index - 1];
}

export function findFirstChild(data: MindMapData, id: NodeID): NodeID | null {
  const node = data.nodes[id];
  if (!node || node.collapsed || node.children.length === 0) return null;
  return node.children[0];
}

export function findParent(data: MindMapData, id: NodeID): NodeID | null {
  return data.nodes[id]?.parentId ?? null;
}

export function findLastLeaf(data: MindMapData, id: NodeID): NodeID | null {
  const node = data.nodes[id];
  if (!node) return null;
  let current = node;
  while (!current.collapsed && current.children.length > 0) {
    const child = data.nodes[current.children[current.children.length - 1]];
    if (!child) return current.id;
    current = child;
  }
  return current.id;
}

export function findLastSiblingOfRoot(data: MindMapData): NodeID | null {
  const root = data.nodes[data.rootId];
  if (!root || root.children.length === 0) return data.rootId;
  let current = root.children[root.children.length - 1];
  let lastLeaf: NodeID = current;
  while (true) {
    const node = data.nodes[current];
    if (!node) break;
    lastLeaf = findLastLeaf(data, current) ?? current;
    if (node.collapsed || node.children.length === 0) break;
    current = node.children[node.children.length - 1];
  }
  return lastLeaf;
}

export function removeNode(data: MindMapData, id: NodeID): void {
  const node = data.nodes[id];
  if (!node) return;
  if (node.id === data.rootId) return;

  // remove from parent's children
  if (node.parentId) {
    const parent = data.nodes[node.parentId];
    if (parent) {
      parent.children = parent.children.filter((childId) => childId !== id);
    }
  }

  // recursively remove descendants
  const toRemove = collectDescendants(data, id);
  toRemove.forEach((descId) => delete data.nodes[descId]);
  delete data.nodes[id];
  data.version++;
}

export function updateNodeLabel(data: MindMapData, id: NodeID, label: string): void {
  const node = data.nodes[id];
  if (!node) return;
  node.label = label;
  data.version++;
}

export function toggleCollapsed(data: MindMapData, id: NodeID): void {
  const node = data.nodes[id];
  if (!node || node.children.length === 0) return;
  node.collapsed = !node.collapsed;
  data.version++;
}

export function findNodeAt(data: MindMapData, x: number, y: number): MindNode | null {
  for (const node of Object.values(data.nodes)) {
    if (
      node.x !== undefined &&
      node.y !== undefined &&
      node.width !== undefined &&
      node.height !== undefined &&
      x >= node.x &&
      x <= node.x + node.width &&
      y >= node.y &&
      y <= node.y + node.height
    ) {
      return node;
    }
  }
  return null;
}

export function calculateTreeLayout(data: MindMapData): MindMapData {
  const root = data.nodes[data.rootId];
  if (!root) return data;

  // measure text-based sizes (simplified: fixed now, later measure via canvas)
  Object.values(data.nodes).forEach((node: MindNode) => {
    node.width = Math.max(DEFAULT_NODE_WIDTH, node.label.length * 14 + 24);
    node.height = DEFAULT_NODE_HEIGHT;
  });

  layoutNode(data, root, 0, 0);
  return data;
}

function layoutNode(data: MindMapData, node: MindNode, x: number, y: number): number {
  node.x = x;
  node.y = y;

  if (node.collapsed || node.children.length === 0) {
    return node.height ?? DEFAULT_NODE_HEIGHT;
  }

  let currentY = y;
  let totalHeight = 0;

  node.children.forEach((childId: NodeID) => {
    const child = data.nodes[childId];
    if (!child) return;
    const childHeight = layoutNode(
      data,
      child,
      x + (node.width ?? DEFAULT_NODE_WIDTH) + HORIZONTAL_GAP,
      currentY
    );
    currentY += childHeight + VERTICAL_GAP;
    totalHeight += childHeight + VERTICAL_GAP;
  });

  totalHeight -= VERTICAL_GAP;

  // center parent vertically relative to its children
  const firstChild = data.nodes[node.children[0]];
  const lastChild = data.nodes[node.children[node.children.length - 1]];
  if (firstChild && lastChild && firstChild.y !== undefined && lastChild.y !== undefined) {
    node.y = (firstChild.y + lastChild.y) / 2;
  }

  return totalHeight;
}

function collectDescendants(data: MindMapData, id: NodeID): NodeID[] {
  const node = data.nodes[id];
  if (!node) return [];
  const result: NodeID[] = [];
  node.children.forEach((childId: NodeID) => {
    result.push(childId);
    result.push(...collectDescendants(data, childId));
  });
  return result;
}
