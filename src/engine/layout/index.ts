import type { MindMapData, MindNode, NodeID } from '@/types/mindmap';

export interface LayoutConfig {
  siblingGap: number; // 同级节点间距
  levelGap: number;   // 层级间距
  paddingX: number;   // 节点水平内边距
  paddingY: number;   // 节点垂直内边距
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  siblingGap: 24,
  levelGap: 80,
  paddingX: 16,
  paddingY: 10,
};

/**
 * 自底向上测量节点尺寸。
 * 如果节点有自定义 style.width/style.height 则使用，否则按文字长度估算。
 */
export function measureNodes(data: MindMapData, config: LayoutConfig = DEFAULT_LAYOUT_CONFIG): void {
  const root = data.nodes[data.rootId];
  if (!root) return;
  const measure = (node: MindNode) => {
    if (node.style?.width && node.style?.height) {
      node.width = node.style.width;
      node.height = node.style.height;
    } else {
      const fontSize = node.style?.fontSize ?? 14;
      // 估算：每个字符约 fontSize * 0.6 宽，加上 padding
      node.width = Math.max(80, node.label.length * fontSize * 0.6 + config.paddingX * 2);
      node.height = fontSize + config.paddingY * 2;
    }
    if (!node.collapsed) {
      node.children.forEach((childId) => {
        const child = data.nodes[childId];
        if (child) measure(child);
      });
    }
  };
  measure(root);
}

/**
 * 主入口：计算整个树的布局。
 */
export function calculateLayout(data: MindMapData, config: LayoutConfig = DEFAULT_LAYOUT_CONFIG): MindMapData {
  measureNodes(data, config);

  const root = data.nodes[data.rootId];
  if (!root) return data;

  // 重置坐标
  Object.values(data.nodes).forEach((node) => {
    node.x = undefined;
    node.y = undefined;
  });

  switch (data.layout) {
    case 'org':
      layoutOrg(data, root, 0, 0, config);
      break;
    case 'timeline':
      layoutTimeline(data, root, 0, 0, config);
      break;
    case 'fishbone':
      layoutFishbone(data, root, 0, 0, config);
      break;
    case 'balanced':
    default:
      layoutBalanced(data, root, 0, 0, config);
      break;
  }

  return data;
}

// ============================================================
// 平衡图：根在中心，一级子节点左右交替；子树内部仍按右侧树逻辑垂直居中
// ============================================================
function layoutBalanced(
  data: MindMapData,
  node: MindNode,
  x: number,
  y: number,
  config: LayoutConfig
): { width: number; height: number } {
  node.x = x;
  node.y = y;

  if (node.collapsed || node.children.length === 0) {
    return { width: node.width ?? 0, height: node.height ?? 0 };
  }

  // 递归计算每个子树占用的尺寸
  const childBoxes = node.children.map((childId) => {
    const child = data.nodes[childId];
    if (!child) return null;
    return layoutRightTree(data, child, 0, 0, config);
  }).filter(Boolean) as { id: NodeID; box: Box }[];

  // 分配左右两侧，使两侧总高度尽量均衡
  const { left, right } = partitionByHeight(childBoxes);

  const placeSide = (
    ids: NodeID[],
    sign: 1 | -1,
    startY: number
  ): { placed: PlacedChild[]; totalHeight: number } => {
    let currentY = startY;
    const placed: PlacedChild[] = [];
    ids.forEach((childId, index) => {
      const child = data.nodes[childId];
      if (!child) return;
      const box = childBoxes.find((b) => b.id === childId)?.box ?? { width: child.width ?? 0, height: child.height ?? 0 };
      // 第一个子节点以 startY 为自身中点，后续按间距递增
      const childCenterY = index === 0 ? startY : currentY + box.height / 2;
      child.x = x + sign * ((node.width ?? 0) + config.levelGap + box.width / 2) - (sign === 1 ? box.width : 0);
      child.y = childCenterY - box.height / 2;
      // 递归真正布局子树（以 child 左上角为原点重新算）
      layoutRightTreeAtOrigin(data, child, child.x, child.y, config);
      placed.push({ id: childId, centerY: childCenterY, box });
      currentY = childCenterY + box.height / 2 + config.siblingGap;
    });
    const totalHeight = placed.length > 0
      ? placed[placed.length - 1].centerY + placed[placed.length - 1].box.height / 2 - placed[0].centerY + placed[0].box.height / 2
      : 0;
    return { placed, totalHeight };
  };

  // 先用右侧总高度估算中心，再放置两侧
  const rightIds = right;
  const leftIds = left;

  const rightHeight = rightIds.reduce((sum, id) => {
    const box = childBoxes.find((b) => b.id === id)?.box;
    return sum + (box?.height ?? 0) + config.siblingGap;
  }, 0) - (rightIds.length > 0 ? config.siblingGap : 0);
  const leftHeight = leftIds.reduce((sum, id) => {
    const box = childBoxes.find((b) => b.id === id)?.box;
    return sum + (box?.height ?? 0) + config.siblingGap;
  }, 0) - (leftIds.length > 0 ? config.siblingGap : 0);

  const rootCenterY = y + Math.max(rightHeight, leftHeight) / 2;
  node.y = rootCenterY - (node.height ?? 0) / 2;

  if (rightIds.length > 0) {
    const firstBox = childBoxes.find((b) => b.id === rightIds[0])?.box ?? { width: 0, height: 0 };
    const startY = node.y + (node.height ?? 0) / 2 - rightHeight / 2 + firstBox.height / 2;
    placeSide(rightIds, 1, startY);
  }
  if (leftIds.length > 0) {
    const firstBox = childBoxes.find((b) => b.id === leftIds[0])?.box ?? { width: 0, height: 0 };
    const startY = node.y + (node.height ?? 0) / 2 - leftHeight / 2 + firstBox.height / 2;
    placeSide(leftIds, -1, startY);
  }

  const maxHeight = Math.max(rightHeight, leftHeight, node.height ?? 0);
  const maxWidth = Math.max(
    ...childBoxes.map((b) => (node.width ?? 0) + config.levelGap + b.box.width)
  );

  return { width: maxWidth, height: maxHeight };
}

interface Box {
  width: number;
  height: number;
}
interface PlacedChild {
  id: NodeID;
  centerY: number;
  box: Box;
}

// 右侧展开树：父在左，子在右，父节点垂直居中于子树
function layoutRightTree(
  data: MindMapData,
  node: MindNode,
  _x: number,
  _y: number,
  config: LayoutConfig
): { id: NodeID; box: Box } {
  const box = computeRightTreeBox(data, node, config);
  return { id: node.id, box };
}

// 自底向上计算右侧展开子树包围盒
function computeRightTreeBox(data: MindMapData, node: MindNode, config: LayoutConfig): Box {
  if (node.collapsed || node.children.length === 0) {
    return { width: node.width ?? 0, height: node.height ?? 0 };
  }
  let totalHeight = 0;
  let maxChildWidth = 0;
  node.children.forEach((childId, index) => {
    const child = data.nodes[childId];
    if (!child) return;
    const childBox = computeRightTreeBox(data, child, config);
    totalHeight += childBox.height;
    if (index < node.children.length - 1) totalHeight += config.siblingGap;
    maxChildWidth = Math.max(maxChildWidth, childBox.width);
  });
  return {
    width: (node.width ?? 0) + config.levelGap + maxChildWidth,
    height: Math.max(node.height ?? 0, totalHeight),
  };
}

// 以给定左上角坐标为原点，重新布局一个右侧展开子树
function layoutRightTreeAtOrigin(
  data: MindMapData,
  node: MindNode,
  x: number,
  y: number,
  config: LayoutConfig
): void {
  node.x = x;
  node.y = y;

  if (node.collapsed || node.children.length === 0) return;

  const childBoxes = node.children.map((childId) => {
    const child = data.nodes[childId];
    if (!child) return null;
    return { id: childId, child, box: computeRightTreeBox(data, child, config) };
  }).filter(Boolean) as { id: NodeID; child: MindNode; box: Box }[];

  const totalHeight = childBoxes.reduce((sum, cb, index) => {
    return sum + cb.box.height + (index < childBoxes.length - 1 ? config.siblingGap : 0);
  }, 0);

  const rootCenterY = y + Math.max(totalHeight, node.height ?? 0) / 2;
  node.y = rootCenterY - (node.height ?? 0) / 2;

  let currentY = rootCenterY - totalHeight / 2;
  childBoxes.forEach(({ child, box }) => {
    const childY = currentY + box.height / 2 - (child.height ?? 0) / 2;
    layoutRightTreeAtOrigin(
      data,
      child,
      x + (node.width ?? 0) + config.levelGap,
      childY,
      config
    );
    currentY += box.height + config.siblingGap;
  });
}

// 按子树高度贪心分配到左右两侧，使两侧总高度尽量均衡
function partitionByHeight(childBoxes: { id: NodeID; box: Box }[]): { left: NodeID[]; right: NodeID[] } {
  const sorted = [...childBoxes].sort((a, b) => b.box.height - a.box.height);
  const left: NodeID[] = [];
  const right: NodeID[] = [];
  let leftHeight = 0;
  let rightHeight = 0;

  sorted.forEach((cb) => {
    if (leftHeight <= rightHeight) {
      left.push(cb.id);
      leftHeight += cb.box.height + DEFAULT_LAYOUT_CONFIG.siblingGap;
    } else {
      right.push(cb.id);
      rightHeight += cb.box.height + DEFAULT_LAYOUT_CONFIG.siblingGap;
    }
  });

  // 让左侧为上方/上方索引，右侧为下方；这里 left 对应上侧还是下侧由调用方决定 sign
  // 保持原始顺序：按原 children 顺序归入 left/right
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const originalLeft: NodeID[] = [];
  const originalRight: NodeID[] = [];
  childBoxes.forEach((cb) => {
    if (leftSet.has(cb.id)) originalLeft.push(cb.id);
    else if (rightSet.has(cb.id)) originalRight.push(cb.id);
  });

  return { left: originalLeft, right: originalRight };
}

// ============================================================
// 组织结构图：根在上，子节点在下水平排列，父节点水平居中
// ============================================================
function layoutOrg(
  data: MindMapData,
  node: MindNode,
  x: number,
  y: number,
  config: LayoutConfig
): Box {
  node.x = x;
  node.y = y;

  if (node.collapsed || node.children.length === 0) {
    return { width: node.width ?? 0, height: node.height ?? 0 };
  }

  const childBoxes = node.children.map((childId) => {
    const child = data.nodes[childId];
    if (!child) return null;
    return { id: childId, child, box: layoutOrg(data, child, 0, 0, config) };
  }).filter(Boolean) as { id: NodeID; child: MindNode; box: Box }[];

  const totalWidth = childBoxes.reduce((sum, cb, index) => {
    return sum + cb.box.width + (index < childBoxes.length - 1 ? config.siblingGap : 0);
  }, 0);
  const maxChildHeight = Math.max(...childBoxes.map((cb) => cb.box.height));

  let currentX = x + (node.width ?? 0) / 2 - totalWidth / 2;
  const childY = y + (node.height ?? 0) + config.levelGap;
  childBoxes.forEach(({ child, box }) => {
    layoutOrgAt(data, child, currentX, childY, box, config);
    currentX += box.width + config.siblingGap;
  });

  return {
    width: Math.max(node.width ?? 0, totalWidth),
    height: (node.height ?? 0) + config.levelGap + maxChildHeight,
  };
}

function layoutOrgAt(
  data: MindMapData,
  node: MindNode,
  x: number,
  y: number,
  _box: Box,
  config: LayoutConfig
): void {
  node.x = x;
  node.y = y;

  if (node.collapsed || node.children.length === 0) return;

  const childBoxes = node.children.map((childId) => {
    const child = data.nodes[childId];
    if (!child) return null;
    return { id: childId, child, box: layoutOrg(data, child, 0, 0, config) };
  }).filter(Boolean) as { id: NodeID; child: MindNode; box: Box }[];

  const totalWidth = childBoxes.reduce((sum, cb, index) => {
    return sum + cb.box.width + (index < childBoxes.length - 1 ? config.siblingGap : 0);
  }, 0);
  let currentX = x + ((node.width ?? 0) / 2) - totalWidth / 2;
  const childY = y + (node.height ?? 0) + config.levelGap;
  childBoxes.forEach(({ child, box }) => {
    layoutOrgAt(data, child, currentX, childY, box, config);
    currentX += box.width + config.siblingGap;
  });
}

// ============================================================
// 时间轴：根在上，一级子节点沿 X 轴排列， deeper 节点在下方垂直展开
// ============================================================
function layoutTimeline(
  data: MindMapData,
  node: MindNode,
  x: number,
  y: number,
  config: LayoutConfig
): Box {
  node.x = x;
  node.y = y;

  if (node.collapsed || node.children.length === 0) {
    return { width: node.width ?? 0, height: node.height ?? 0 };
  }

  const childBoxes = node.children.map((childId) => {
    const child = data.nodes[childId];
    if (!child) return null;
    return { id: childId, child, box: layoutTimelineSubtree(data, child, config) };
  }).filter(Boolean) as { id: NodeID; child: MindNode; box: Box }[];

  const totalWidth = childBoxes.reduce((sum, cb, index) => {
    return sum + cb.box.width + (index < childBoxes.length - 1 ? config.siblingGap : 0);
  }, 0);

  let currentX = x + (node.width ?? 0) / 2 - totalWidth / 2;
  const childY = y + (node.height ?? 0) + config.levelGap;
  childBoxes.forEach(({ child, box }) => {
    layoutTimelineAt(data, child, currentX, childY, box, config);
    currentX += box.width + config.siblingGap;
  });

  const maxChildHeight = Math.max(...childBoxes.map((cb) => cb.box.height));
  return {
    width: Math.max(node.width ?? 0, totalWidth),
    height: (node.height ?? 0) + config.levelGap + maxChildHeight,
  };
}

function layoutTimelineSubtree(data: MindMapData, node: MindNode, config: LayoutConfig): Box {
  if (node.collapsed || node.children.length === 0) {
    return { width: node.width ?? 0, height: node.height ?? 0 };
  }
  const childBoxes = node.children.map((childId) => {
    const child = data.nodes[childId];
    if (!child) return null;
    return { id: childId, child, box: layoutTimelineSubtree(data, child, config) };
  }).filter(Boolean) as { id: NodeID; child: MindNode; box: Box }[];

  const totalWidth = childBoxes.reduce((sum, cb, index) => {
    return sum + cb.box.width + (index < childBoxes.length - 1 ? config.siblingGap : 0);
  }, 0);
  const maxChildHeight = Math.max(...childBoxes.map((cb) => cb.box.height));
  return {
    width: totalWidth,
    height: (node.height ?? 0) + config.levelGap + maxChildHeight,
  };
}

function layoutTimelineAt(
  data: MindMapData,
  node: MindNode,
  x: number,
  y: number,
  _box: Box,
  config: LayoutConfig
): void {
  node.x = x;
  node.y = y;

  if (node.collapsed || node.children.length === 0) return;

  const childBoxes = node.children.map((childId) => {
    const child = data.nodes[childId];
    if (!child) return null;
    return { id: childId, child, box: layoutTimelineSubtree(data, child, config) };
  }).filter(Boolean) as { id: NodeID; child: MindNode; box: Box }[];

  const totalWidth = childBoxes.reduce((sum, cb, index) => {
    return sum + cb.box.width + (index < childBoxes.length - 1 ? config.siblingGap : 0);
  }, 0);
  let currentX = x + ((node.width ?? 0) / 2) - totalWidth / 2;
  const childY = y + (node.height ?? 0) + config.levelGap;
  childBoxes.forEach(({ child, box }) => {
    layoutTimelineAt(data, child, currentX, childY, box, config);
    currentX += box.width + config.siblingGap;
  });
}

// ============================================================
// 鱼骨图：根水平，子节点按上下斜向展开
// ============================================================
function layoutFishbone(
  data: MindMapData,
  node: MindNode,
  x: number,
  y: number,
  config: LayoutConfig
): Box {
  node.x = x;
  node.y = y;

  if (node.collapsed || node.children.length === 0) {
    return { width: node.width ?? 0, height: node.height ?? 0 };
  }

  const childX = x + (node.width ?? 0) + config.levelGap;
  const diagY = 40;

  const upper: MindNode[] = [];
  const lower: MindNode[] = [];
  node.children.forEach((childId, idx) => {
    const child = data.nodes[childId];
    if (!child) return;
    if (idx % 2 === 0) upper.push(child);
    else lower.push(child);
  });

  const upperBox = layoutFishboneSide(data, upper, childX, y - diagY, -1, config);
  const lowerBox = layoutFishboneSide(data, lower, childX, y + (node.height ?? 0) + diagY, 1, config);

  const minY = Math.min(upperBox?.minY ?? y, y);
  const maxY = Math.max(lowerBox?.maxY ?? y + (node.height ?? 0), y + (node.height ?? 0));
  node.y = (minY + maxY) / 2 - (node.height ?? 0) / 2;

  const farX = Math.max(
    upperBox?.maxX ?? childX,
    lowerBox?.maxX ?? childX
  );

  return {
    width: farX - x,
    height: maxY - minY,
  };
}

function layoutFishboneSide(
  data: MindMapData,
  children: MindNode[],
  startX: number,
  startY: number,
  direction: 1 | -1,
  config: LayoutConfig
): { minY: number; maxY: number; maxX: number } | null {
  if (children.length === 0) return null;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxX = -Infinity;
  let currentY = startY;
  children.forEach((child) => {
    const diagX = 40;
    const diagY = 30;
    child.x = startX + diagX;
    child.y = currentY + direction * diagY - (child.height ?? 0) / 2;
    layoutFishboneSubtree(data, child, child.x + (child.width ?? 0) + config.levelGap, child.y + (child.height ?? 0) / 2, direction, config);
    minY = Math.min(minY, child.y);
    maxY = Math.max(maxY, child.y + (child.height ?? 0));
    maxX = Math.max(maxX, child.x + (child.width ?? 0));
    // 下一节点Y间距
    const boxHeight = (child.height ?? 0) + config.siblingGap;
    currentY += direction * boxHeight;
  });
  return { minY, maxY, maxX };
}

function layoutFishboneSubtree(
  data: MindMapData,
  node: MindNode,
  x: number,
  yCenter: number,
  direction: 1 | -1,
  config: LayoutConfig
): void {
  node.x = x;
  node.y = yCenter - (node.height ?? 0) / 2;

  if (node.collapsed || node.children.length === 0) return;

  let currentY = yCenter;
  node.children.forEach((childId) => {
    const child = data.nodes[childId];
    if (!child) return;
    child.x = x + (node.width ?? 0) + config.levelGap;
    child.y = currentY + direction * ((child.height ?? 0) / 2 + config.siblingGap) - (child.height ?? 0) / 2;
    layoutFishboneSubtree(data, child, child.x + (child.width ?? 0) + config.levelGap, child.y + (child.height ?? 0) / 2, direction, config);
    currentY += direction * ((child.height ?? 0) + config.siblingGap);
  });
}
