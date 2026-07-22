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

/** 时间轴：一级节点沿 X 轴排列，二级及以下在 Y 方向交替上下分布 */
export function layoutTimeline(node: WorkingNode, startX: number, startY: number, theme: Theme): LayoutBox {
  measureNode(node, theme);
  return layoutTimelineNode(node, startX, startY, theme, 0);
}

function layoutTimelineNode(node: WorkingNode, startX: number, startY: number, theme: Theme, depth: number): LayoutBox {
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

  // 时间轴：一级节点（depth 0）沿 X 轴排列，二级节点在 Y 方向上下交替
  const isHorizontal = depth === 0;
  let totalWidth = 0;
  let totalHeight = 0;

  const childBoxes: { child: WorkingNode; box: LayoutBox }[] = [];

  if (isHorizontal) {
    // 一级节点沿 X 轴排列
    for (const child of node.children) {
      const box = layoutTimelineNode(child, 0, 0, theme, depth + 1);
      childBoxes.push({ child, box });
      totalWidth += box.totalWidth + theme.siblingGap;
      totalHeight = Math.max(totalHeight, box.totalHeight);
    }
    totalWidth -= theme.siblingGap; // 最后一个不需要间距

    // 将根节点放在子节点总宽度的中间
    const offsetX = (totalWidth - node.bbox.width) / 2;
    node.bbox.x = startX + offsetX;
    node.bbox.y = startY;

    let currentX2 = startX;
    childBoxes.forEach(({ child, box }) => {
      shiftSubtree(child, currentX2 - box.x, startY + node.bbox.height + theme.levelGap - box.y);
      currentX2 += box.totalWidth + theme.siblingGap;
    });

    return {
      x: startX,
      y: startY,
      width: Math.max(node.bbox.width, totalWidth),
      height: node.bbox.height + theme.levelGap + totalHeight,
      totalHeight: node.bbox.height + theme.levelGap + totalHeight,
      totalWidth: Math.max(node.bbox.width, totalWidth),
    };
  } else {
    // 二级及以下：沿 Y 方向上下交替分布
    const direction = depth % 2 === 1 ? 1 : -1; // 奇数层向下，偶数层向上（相对父节点）
    let currentY = startY + node.bbox.height / 2;

    for (const child of node.children) {
      const box = layoutTimelineNode(child, 0, 0, theme, depth + 1);
      childBoxes.push({ child, box });
      totalWidth = Math.max(totalWidth, box.totalWidth);
    }

    const stepY = (node.bbox.height + theme.levelGap) * direction;
    childBoxes.forEach(({ child, box }, idx) => {
      const childY = currentY + idx * stepY + (direction > 0 ? 0 : -box.totalHeight);
      const childX = startX + node.bbox.width + theme.levelGap;
      shiftSubtree(child, childX - box.x, childY - box.y);
    });

    return {
      x: startX,
      y: startY,
      width: node.bbox.width + theme.levelGap + totalWidth,
      height: node.bbox.height,
      totalHeight: node.bbox.height,
      totalWidth: node.bbox.width + theme.levelGap + totalWidth,
    };
  }
}
