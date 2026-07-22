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

/** 鱼骨图：根水平，一级子节点按上下斜向展开 */
export function layoutFishbone(node: WorkingNode, startX: number, startY: number, theme: Theme): LayoutBox {
  measureNode(node, theme);
  return layoutFishboneNode(node, startX, startY, theme);
}

function layoutFishboneNode(node: WorkingNode, startX: number, startY: number, theme: Theme): LayoutBox {
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

  const upper: WorkingNode[] = [];
  const lower: WorkingNode[] = [];
  node.children.forEach((child, idx) => {
    if (idx % 2 === 0) upper.push(child);
    else lower.push(child);
  });

  const upperBox = layoutFishboneSide(upper, startX + node.bbox.width + theme.levelGap, startY - 40, -1, theme);
  const lowerBox = layoutFishboneSide(lower, startX + node.bbox.width + theme.levelGap, startY + node.bbox.height + 40, 1, theme);

  const minY = Math.min(upperBox?.minY ?? startY, startY);
  const maxY = Math.max(lowerBox?.maxY ?? startY + node.bbox.height, startY + node.bbox.height);
  node.bbox.y = (minY + maxY) / 2 - node.bbox.height / 2;

  const farX = Math.max(upperBox?.maxX ?? startX, lowerBox?.maxX ?? startX);

  return {
    x: startX,
    y: minY,
    width: farX - startX,
    height: maxY - minY,
    totalHeight: maxY - minY,
    totalWidth: farX - startX,
  };
}

function layoutFishboneSide(
  children: WorkingNode[],
  startX: number,
  startY: number,
  direction: 1 | -1,
  theme: Theme
): { minY: number; maxY: number; maxX: number } | null {
  if (children.length === 0) return null;

  let minY = Infinity;
  let maxY = -Infinity;
  let maxX = -Infinity;
  let currentY = startY;

  children.forEach((child) => {
    const diagX = 40;
    const diagY = 30;

    child.bbox.x = startX + diagX;
    child.bbox.y = currentY + direction * diagY - child.bbox.height / 2;

    const box = layoutRightSubtree(
      child,
      child.bbox.x + child.bbox.width + theme.levelGap,
      child.bbox.y + child.bbox.height / 2,
      theme,
      direction
    );

    minY = Math.min(minY, child.bbox.y);
    maxY = Math.max(maxY, child.bbox.y + child.bbox.height);
    maxX = Math.max(maxX, child.bbox.x + child.bbox.width);

    // 一级子节点之间的间距应基于整个子树的高度，而不是单个节点高度
    currentY += direction * (box.totalHeight + theme.siblingGap);
  });

  return { minY, maxY, maxX };
}

function layoutRightSubtree(
  node: WorkingNode,
  startX: number,
  startY: number,
  theme: Theme,
  expandDirection: 1 | -1 = 1
): LayoutBox {
  // 入口 layoutFishbone 已递归测量全树，这里直接定位即可，避免每个节点重复 O(子树) 测量
  node.bbox.x = startX;
  node.bbox.y = startY - node.bbox.height / 2;

  if (node.collapsed || node.children.length === 0) {
    return {
      x: startX,
      y: node.bbox.y,
      width: node.bbox.width,
      height: node.bbox.height,
      totalHeight: node.bbox.height,
      totalWidth: node.bbox.width,
    };
  }

  const childBoxes: { child: WorkingNode; box: LayoutBox }[] = [];
  let maxChildWidth = 0;

  for (const child of node.children) {
    const box = layoutRightSubtree(child, 0, 0, theme, expandDirection);
    childBoxes.push({ child, box });
    maxChildWidth = Math.max(maxChildWidth, box.totalWidth);
  }

  const childX = startX + node.bbox.width + theme.levelGap;
  const childrenTotalHeight =
    childBoxes.reduce((sum, { box }) => sum + box.totalHeight, 0) +
    (childBoxes.length - 1) * theme.siblingGap;

  // 子节点从父节点中心线开始向 expandDirection 方向（上/下）依次展开，
  // 这样上侧分支继续向上，下侧分支继续向下，不会互相穿插导致重叠。
  let currentOffset = 0;
  childBoxes.forEach(({ child, box }) => {
    const childCenterY = startY + expandDirection * (currentOffset + box.totalHeight / 2);
    const childY = childCenterY - child.bbox.height / 2;
    shiftSubtree(child, childX - child.bbox.x, childY - child.bbox.y);
    currentOffset += box.totalHeight + theme.siblingGap;
  });

  // 子树总高度：父节点中心到子节点展开末端的距离 + 父节点自身高度的一半
  const totalHeight = node.bbox.height / 2 + childrenTotalHeight;

  return {
    x: startX,
    y: node.bbox.y,
    width: node.bbox.width + theme.levelGap + maxChildWidth,
    height: totalHeight,
    totalHeight,
    totalWidth: node.bbox.width + theme.levelGap + maxChildWidth,
  };
}
