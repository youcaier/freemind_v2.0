import type { WorkingNode, Theme } from '../index';
import { measureNode, shiftSubtree } from '../index';

interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
  totalHeight: number;
  totalWidth: number;
}

/** 右树：根节点在左侧，所有子节点统一向右展开 */
export function layoutRightTree(node: WorkingNode, startX: number, startY: number, theme: Theme): LayoutBox {
  measureNode(node, theme);
  return layoutDirectionalSubtree(node, startX, startY, theme, 'right');
}

function layoutDirectionalSubtree(
  node: WorkingNode,
  startX: number,
  startY: number,
  theme: Theme,
  direction: 'left' | 'right'
): LayoutBox {
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

  const childBoxes = node.children.map((child) => ({
    child,
    box: layoutDirectionalSubtree(child, 0, 0, theme, direction),
  }));

  const totalChildrenHeight = childBoxes.reduce(
    (sum, cb, idx) => sum + cb.box.totalHeight + (idx < childBoxes.length - 1 ? theme.siblingGap : 0),
    0
  );
  const offset = (totalChildrenHeight - node.bbox.height) / 2;
  node.bbox.y = startY + offset;

  const maxChildWidth = Math.max(...childBoxes.map((cb) => cb.box.totalWidth));
  const childX =
    direction === 'right'
      ? startX + node.bbox.width + theme.levelGap
      : startX - theme.levelGap - maxChildWidth;

  let currentY = startY;
  childBoxes.forEach(({ child, box }) => {
    const childY = currentY + (box.totalHeight - child.bbox.height) / 2;
    shiftSubtree(child, childX - child.bbox.x, childY - child.bbox.y);
    currentY += box.totalHeight + theme.siblingGap;
  });

  const totalWidth = node.bbox.width + theme.levelGap + maxChildWidth;
  const height = Math.max(node.bbox.height, totalChildrenHeight);

  return {
    x: startX,
    y: startY + offset,
    width: totalWidth,
    height,
    totalHeight: height,
    totalWidth,
  };
}
