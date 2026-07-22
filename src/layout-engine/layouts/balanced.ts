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

/** 平衡图：根节点在中心，一级子节点按奇偶索引交替分配到左右两侧，
 *  左侧分支整体向左展开，右侧分支整体向右展开，做到上下有序、左右平衡。
 */
export function layoutBalanced(node: WorkingNode, startX: number, startY: number, theme: Theme): LayoutBox {
  measureNode(node, theme);
  return layoutBalancedNode(node, startX, startY, theme, 'right');
}

function layoutBalancedNode(
  node: WorkingNode,
  startX: number,
  startY: number,
  theme: Theme,
  side: 'left' | 'right'
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

  // 非根节点：保持所在侧的方向展开（左分支向左，右分支向右）
  if (node.level !== 0) {
    return layoutDirectionalSubtree(node, startX, startY, theme, side);
  }

  // 根节点：把一级子节点按 branchSide 分配到左右两侧，未指定 side 的默认按索引奇偶兜底
  const leftChildren = node.children.filter((child) => child.branchSide === 'left' || (child.branchSide === undefined && node.children.indexOf(child) % 2 === 0));
  const rightChildren = node.children.filter((child) => child.branchSide === 'right' || (child.branchSide === undefined && node.children.indexOf(child) % 2 === 1));

  const leftBoxes = leftChildren.map((child) => ({
    child,
    box: layoutDirectionalSubtree(child, 0, 0, theme, 'left'),
  }));
  const rightBoxes = rightChildren.map((child) => ({
    child,
    box: layoutDirectionalSubtree(child, 0, 0, theme, 'right'),
  }));

  const leftHeight = leftBoxes.reduce(
    (sum, cb, idx) => sum + cb.box.totalHeight + (idx < leftBoxes.length - 1 ? theme.siblingGap : 0),
    0
  );
  const rightHeight = rightBoxes.reduce(
    (sum, cb, idx) => sum + cb.box.totalHeight + (idx < rightBoxes.length - 1 ? theme.siblingGap : 0),
    0
  );
  const maxHeight = Math.max(leftHeight, rightHeight, node.bbox.height);

  const leftWidth = leftBoxes.length > 0 ? Math.max(...leftBoxes.map((cb) => cb.box.totalWidth)) + theme.levelGap : 0;
  const rightWidth = rightBoxes.length > 0 ? Math.max(...rightBoxes.map((cb) => cb.box.totalWidth)) + theme.levelGap : 0;

  const centerX = startX + leftWidth;
  node.bbox.x = centerX;
  node.bbox.y = startY + (maxHeight - node.bbox.height) / 2;

  // 放置右侧子节点（从上到下）
  let currentY = startY + (maxHeight - rightHeight) / 2;
  rightBoxes.forEach(({ child, box }) => {
    const childX = centerX + node.bbox.width + theme.levelGap;
    const childY = currentY + (box.totalHeight - child.bbox.height) / 2;
    shiftSubtree(child, childX - child.bbox.x, childY - child.bbox.y);
    currentY += box.totalHeight + theme.siblingGap;
  });

  // 放置左侧子节点（从上到下）
  currentY = startY + (maxHeight - leftHeight) / 2;
  leftBoxes.forEach(({ child, box }) => {
    const childX = centerX - theme.levelGap - child.bbox.width;
    const childY = currentY + (box.totalHeight - child.bbox.height) / 2;
    shiftSubtree(child, childX - child.bbox.x, childY - child.bbox.y);
    currentY += box.totalHeight + theme.siblingGap;
  });

  return {
    x: startX,
    y: startY,
    width: leftWidth + node.bbox.width + rightWidth,
    height: maxHeight,
    totalHeight: maxHeight,
    totalWidth: leftWidth + node.bbox.width + rightWidth,
  };
}

/** 单向展开子树：按指定方向（left/right）水平展开 */
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

  // 子节点统一沿指定方向排列，Y 方向垂直堆叠，且以父节点为中心对称分布
  const childX =
    direction === 'right'
      ? startX + node.bbox.width + theme.levelGap
      : startX - theme.levelGap - Math.max(...childBoxes.map((cb) => cb.child.bbox.width));

  let currentY = startY;
  childBoxes.forEach(({ child, box }) => {
    const childY = currentY + (box.totalHeight - child.bbox.height) / 2;
    shiftSubtree(child, childX - child.bbox.x, childY - child.bbox.y);
    currentY += box.totalHeight + theme.siblingGap;
  });

  const maxChildWidth = Math.max(...childBoxes.map((cb) => cb.box.totalWidth));
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
