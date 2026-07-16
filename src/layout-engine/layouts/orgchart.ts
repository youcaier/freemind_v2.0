import type { WorkingNode, Theme } from '../index';
import { measureNode } from '../index';

interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
  totalHeight: number;
  totalWidth: number;
}

/** 组织结构图：根在上，子节点在下水平排列 */
export function layoutOrgChart(node: WorkingNode, startX: number, startY: number, theme: Theme): LayoutBox {
  measureNode(node, theme);
  return layoutNodeDown(node, startX, startY, theme);
}

function layoutNodeDown(node: WorkingNode, startX: number, startY: number, theme: Theme): LayoutBox {
  node.bbox.x = startX;
  node.bbox.y = startY;

  if (node.collapsed || node.children.length === 0) {
    return {
      x: startX,
      y: startY,
      width: node.bbox.width,
      height: node.bbox.height,
      totalHeight: node.bbox.height,
      totalWidth: node.bbox.width,
    };
  }

  // 先递归计算所有子节点尺寸
  const childBoxes: { child: WorkingNode; box: LayoutBox }[] = [];
  for (const child of node.children) {
    const box = layoutNodeDown(child, 0, 0, theme);
    childBoxes.push({ child, box });
  }

  const totalChildrenWidth = childBoxes.reduce((acc, cb, idx) => acc + cb.box.totalWidth + (idx < childBoxes.length - 1 ? theme.siblingGap : 0), 0
  );
  const offset = (totalChildrenWidth - node.bbox.width) / 2;
  node.bbox.x = startX + offset;
  node.bbox.y = startY;

  // 放置子节点
  let currentX = startX;
  const childY = startY + node.bbox.height + theme.levelGap;
  childBoxes.forEach(({ child, box }) => {
    shiftSubtree(child, currentX - box.x, childY - box.y);
    currentX += box.totalWidth + theme.siblingGap;
  });

  return {
    x: startX,
    y: startY,
    width: Math.max(node.bbox.width, totalChildrenWidth),
    height: node.bbox.height + theme.levelGap + Math.max(...childBoxes.map((cb) => cb.box.totalHeight)),
    totalHeight: node.bbox.height + theme.levelGap + Math.max(...childBoxes.map((cb) => cb.box.totalHeight)),
    totalWidth: Math.max(node.bbox.width, totalChildrenWidth),
  };
}

function shiftSubtree(node: WorkingNode, dx: number, dy: number): void {
  node.bbox.x += dx;
  node.bbox.y += dy;
  if (!node.collapsed) {
    node.children.forEach((child) => shiftSubtree(child, dx, dy));
  }
}

/** 获取子树的总宽度 */
export function subtreeWidth(node: WorkingNode, theme: Theme): number {
  if (node.collapsed || node.children.length === 0) return node.bbox.width;
  const childrenWidth = node.children.reduce((sum, c) => sum + subtreeWidth(c, theme), 0) + (node.children.length - 1) * theme.siblingGap;
  return Math.max(node.bbox.width, childrenWidth);
}

/** 获取子树的总高度 */
export function subtreeHeight(node: WorkingNode, theme: Theme): number {
  if (node.collapsed || node.children.length === 0) return node.bbox.height;
  return node.bbox.height + theme.levelGap + Math.max(...node.children.map((c) => subtreeHeight(c, theme)));
}
