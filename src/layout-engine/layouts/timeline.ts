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
    // 二级及以下：子节点排在节点右侧，沿 Y 方向按层数交替向下/向上展开
    const direction = depth % 2 === 1 ? 1 : -1; // 奇数层向下，偶数层向上（相对父节点）
    const childX = startX + node.bbox.width + theme.levelGap;

    // 先递归布局每个子节点，拿到各子树的真实 Y 占用区间（含更深层反向展开的过界部分）
    let maxChildHeight = 0;
    for (const child of node.children) {
      const box = layoutTimelineNode(child, 0, 0, theme, depth + 1);
      childBoxes.push({ child, box });
      maxChildHeight = Math.max(maxChildHeight, box.totalHeight);
      totalWidth = Math.max(totalWidth, box.totalWidth);
    }

    // 堆叠步长取「父节点高 + levelGap」与「最高子树 + siblingGap」的较大值：
    // 简单树保持原有均匀间距的外观；某个分支子孙较多时步长随之增大，不再互相压叠
    const stepY = Math.max(node.bbox.height + theme.levelGap, maxChildHeight + theme.siblingGap) * direction;
    const centerY = startY + node.bbox.height / 2;
    // totalHeight 必须反映子树的完整 Y 展开（自身 bbox 与所有子树占用区间的并集），
    // 否则上层按被低估的值排间距，三级以上必然重叠。
    // 注意：box 里存的是临时原点的坐标，平移后的实际位置要用本次计算出的 subtreeTop 累计
    let top = startY;
    let bottom = startY + node.bbox.height;
    childBoxes.forEach(({ child, box }, idx) => {
      // 向下：第 i 个子树的上边缘从父节点中心线起排；向上：下边缘从中心线起排
      const subtreeTop = direction > 0 ? centerY + idx * stepY : centerY + idx * stepY - box.totalHeight;
      shiftSubtree(child, childX - box.x, subtreeTop - box.y);
      top = Math.min(top, subtreeTop);
      bottom = Math.max(bottom, subtreeTop + box.totalHeight);
    });

    const subtreeWidth = node.bbox.width + theme.levelGap + totalWidth;

    return {
      x: startX,
      y: top,
      width: subtreeWidth,
      height: bottom - top,
      totalHeight: bottom - top,
      totalWidth: subtreeWidth,
    };
  }
}
