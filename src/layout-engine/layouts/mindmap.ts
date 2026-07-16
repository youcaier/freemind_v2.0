import type { WorkingNode, Theme } from '../index';
import { measureNode } from '../index';

interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
  totalHeight: number;
}

/** 逻辑图：右侧展开 */
export function layoutMindMap(node: WorkingNode, startX: number, startY: number, theme: Theme): LayoutBox {
  measureNode(node, theme);
  return layoutNodeRight(node, startX, startY, theme);
}

function layoutNodeRight(node: WorkingNode, startX: number, startY: number, theme: Theme): LayoutBox {
  // 1. 先递归布局所有子节点，收集子树尺寸
  const childBoxes: { child: WorkingNode; box: LayoutBox }[] = [];

  if (!node.collapsed && node.children.length > 0) {
    let currentY = startY;
    for (const child of node.children) {
      const childBox = layoutNodeRight(child, startX + node.bbox.width + theme.levelGap, currentY, theme);
      childBoxes.push({ child, box: childBox });
      currentY += childBox.totalHeight + theme.siblingGap;
    }
  }

  // 2. 计算子节点总高度
  const correctedTotalHeight = childBoxes.length > 0
    ? childBoxes.reduce((sum, cb) => sum + cb.box.totalHeight, 0) + (childBoxes.length - 1) * theme.siblingGap
    : 0;

  // 3. 垂直居中：父节点 Y = startY + 偏移量
  const offset = (correctedTotalHeight - node.bbox.height) / 2;
  node.bbox.y = startY + offset;
  node.bbox.x = startX;

  // 4. 修正子节点 Y 坐标（整体平移）
  const shiftY = node.bbox.y - startY;
  if (shiftY !== 0) {
    childBoxes.forEach(({ child }) => {
      shiftSubtree(child, 0, shiftY);
    });
  }

  // 5. 返回本节点及子树占用的包围盒
  return {
    x: startX,
    y: node.bbox.y,
    width: node.bbox.width + (childBoxes.length > 0 ? theme.levelGap + Math.max(...childBoxes.map(cb => cb.box.width)) : 0),
    height: Math.max(node.bbox.height, correctedTotalHeight),
    totalHeight: Math.max(node.bbox.height, correctedTotalHeight),
  };
}

function shiftSubtree(node: WorkingNode, dx: number, dy: number): void {
  node.bbox.x += dx;
  node.bbox.y += dy;
  if (!node.collapsed) {
    node.children.forEach((child) => shiftSubtree(child, dx, dy));
  }
}

/** 获取某个子树的最大宽度 */
export function subtreeWidth(node: WorkingNode, theme: Theme): number {
  if (node.collapsed || node.children.length === 0) return node.bbox.width;
  return node.bbox.width + theme.levelGap + Math.max(...node.children.map((c) => subtreeWidth(c, theme)));
}

/** 获取某个子树的总高度 */
export function subtreeHeight(node: WorkingNode, theme: Theme): number {
  if (node.collapsed || node.children.length === 0) return node.bbox.height;
  const total = node.children.reduce((sum, c) => sum + subtreeHeight(c, theme), 0) + (node.children.length - 1) * theme.siblingGap;
  return Math.max(node.bbox.height, total);
}
