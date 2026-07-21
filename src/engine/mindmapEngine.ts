import type { MindMapData, MindNode, NodeID } from '@/types/mindmap';
import { calculateLayout as newCalculateLayout } from '@/layout-engine/layoutAdapter';

export { newCalculateLayout as calculateLayout };
export type { LayoutConfig } from './layout';
export { DEFAULT_LAYOUT_CONFIG } from './layout';

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
    layout: 'balanced',
    connectionStyle: 'bezier',
  };
}

export function addNode(data: MindMapData, parentId: NodeID, label = '分支主题', forcedId?: NodeID): MindNode {
  const id = forcedId ?? `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const parent = data.nodes[parentId];
  if (!parent) throw new Error(`Parent not found: ${parentId}`);

  // 平衡布局：根节点子节点根据当前左右数量分配到少的一侧
  let branchSide: 'left' | 'right' | undefined;
  if (parentId === data.rootId) {
    const leftCount = parent.children.filter((childId) => data.nodes[childId]?.branchSide === 'left').length;
    const rightCount = parent.children.filter((childId) => data.nodes[childId]?.branchSide === 'right').length;
    branchSide = leftCount <= rightCount ? 'left' : 'right';
  }

  const node: MindNode = {
    id,
    label,
    children: [],
    collapsed: false,
    parentId,
    branchSide,
  };
  data.nodes = { ...data.nodes, [id]: node };
  data.nodes[parentId] = { ...parent, children: [...parent.children, id] };
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
  // 写时复制：parent 对象可能与历史快照共享，不能原地 push
  data.nodes[parentId] = { ...parent, children: [...parent.children, newRootId] };
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

export function moveNodeToParent(data: MindMapData, nodeId: NodeID, targetParentId: NodeID): void {
  const node = data.nodes[nodeId];
  const targetParent = data.nodes[targetParentId];
  if (!node || !targetParent) return;
  if (nodeId === targetParentId) return;
  if (node.id === data.rootId) return;
  // 避免把祖先拖到后代下形成环
  if (isDescendant(data, nodeId, targetParentId)) return;

  if (node.parentId) {
    const parent = data.nodes[node.parentId];
    if (parent) {
      // 写时复制：避免原地修改与历史快照共享的节点对象
      data.nodes[node.parentId] = {
        ...parent,
        children: parent.children.filter((childId) => childId !== nodeId),
      };
    }
  }
  data.nodes[nodeId] = { ...node, parentId: targetParentId };
  // 上一步可能已替换过 targetParent（父即目标时），需重新读取
  const tp = data.nodes[targetParentId];
  data.nodes[targetParentId] = { ...tp, children: [...tp.children, nodeId] };
  data.version++;
}

export function reorderNode(data: MindMapData, nodeId: NodeID, insertBeforeSiblingId: NodeID | null): void {
  const node = data.nodes[nodeId];
  if (!node || !node.parentId) return;
  const parent = data.nodes[node.parentId];
  if (!parent) return;
  const siblings = [...parent.children];
  const currentIndex = siblings.indexOf(nodeId);
  if (currentIndex === -1) return;
  siblings.splice(currentIndex, 1);
  if (insertBeforeSiblingId) {
    const targetIndex = siblings.indexOf(insertBeforeSiblingId);
    if (targetIndex === -1) siblings.push(nodeId);
    else siblings.splice(targetIndex, 0, nodeId);
  } else {
    siblings.push(nodeId);
  }
  // 写时复制：避免原地 splice 与历史快照共享的 children 数组
  data.nodes[node.parentId] = { ...parent, children: siblings };
  data.version++;
}

function isDescendant(data: MindMapData, ancestorId: NodeID, targetId: NodeID): boolean {
  const node = data.nodes[targetId];
  if (!node) return false;
  if (node.parentId === ancestorId) return true;
  if (!node.parentId) return false;
  return isDescendant(data, ancestorId, node.parentId);
}

export function removeNode(data: MindMapData, id: NodeID): void {
  const node = data.nodes[id];
  if (!node) return;
  if (node.id === data.rootId) return;

  // remove from parent's children（不可变更新：直接改 parent.children 会污染历史栈里共享的节点对象）
  if (node.parentId) {
    const parent = data.nodes[node.parentId];
    if (parent) {
      data.nodes[node.parentId] = {
        ...parent,
        children: parent.children.filter((childId) => childId !== id),
      };
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
  // 写时复制：避免原地修改与历史快照共享的节点对象
  data.nodes[id] = { ...node, label };
  data.version++;
}

export function toggleCollapsed(data: MindMapData, id: NodeID): void {
  const node = data.nodes[id];
  if (!node || node.children.length === 0) return;
  // 写时复制：避免原地修改与历史快照共享的节点对象
  data.nodes[id] = { ...node, collapsed: !node.collapsed };
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
  return newCalculateLayout(data);
}

export function calculateBalancedTreeLayout(data: MindMapData): MindMapData {
  return { ...data, layout: 'balanced' };
}

export function calculateOrgLayout(data: MindMapData): MindMapData {
  return { ...data, layout: 'org' };
}

export function calculateTimelineLayout(data: MindMapData): MindMapData {
  return { ...data, layout: 'timeline' };
}

export function calculateFishboneLayout(data: MindMapData): MindMapData {
  return { ...data, layout: 'fishbone' };
}

export function setLayout(data: MindMapData, layout: MindMapData['layout']): MindMapData {
  return { ...data, layout };
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
