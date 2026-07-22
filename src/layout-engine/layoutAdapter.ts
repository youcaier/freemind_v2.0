import type { WorkingNode, Theme } from './index';
import {
  convertToLayoutTree,
  computeCanvasBounds,
  getLayoutStyles,
} from './index';
import { layoutBalanced } from './layouts/balanced';
import { layoutOrgChart } from './layouts/orgchart';
import { layoutTimeline } from './layouts/timeline';
import { layoutFishbone } from './layouts/fishbone';
import { layoutLeftTree } from './layouts/leftTree';
import { layoutRightTree } from './layouts/rightTree';
import type { MindMapData, MindMapLayout, ConnectionStyle } from '@/types/mindmap';

/** 根据布局类型选择对应算法 */
export function calculateLayout(data: MindMapData, startX = 0, startY = 0): MindMapData {
  // 复制 nodes 映射：布局结果以克隆节点的方式写回，不能污染与历史快照共享的对象
  const next: MindMapData = { ...data, nodes: { ...data.nodes } };
  const theme = toTheme(next.layout, next.connectionStyle);
  const root = convertToLayoutTree(next.rootId, next.nodes, undefined, 0, 0);

  runLayout(root, next.layout, startX, startY, theme);

  // 将 WorkingNode 的 bbox 写回 nodes（克隆节点对象）
  applyLayoutResult(next, root);

  // 将自动层级/分支配色样式合并到节点（不覆盖用户已设置的样式）
  applyComputedStyles(next, root);

  return next;
}

function runLayout(
  root: WorkingNode,
  layout: MindMapData['layout'],
  startX: number,
  startY: number,
  theme: Theme
): void {
  switch (layout) {
    case 'org':
      layoutOrgChart(root, startX, startY, theme);
      break;
    case 'timeline':
      layoutTimeline(root, startX, startY, theme);
      break;
    case 'fishbone':
      layoutFishbone(root, startX, startY, theme);
      break;
    case 'leftTree':
      layoutLeftTree(root, startX, startY, theme);
      break;
    case 'rightTree':
      layoutRightTree(root, startX, startY, theme);
      break;
    case 'balanced':
    default:
      layoutBalanced(root, startX, startY, theme);
      break;
  }
}

function applyLayoutResult(data: MindMapData, root: WorkingNode): void {
  const visit = (node: WorkingNode) => {
    const target = data.nodes[node.id];
    if (target) {
      // 写时复制：替换为带坐标的新节点对象，不原地修改共享对象
      data.nodes[node.id] = {
        ...target,
        x: node.bbox.x,
        y: node.bbox.y,
        width: node.bbox.width,
        height: node.bbox.height,
      };
    }
    if (!node.collapsed) node.children.forEach(visit);
  };
  visit(root);

  const bounds = computeCanvasBounds([root]);
  data.canvasBounds = bounds;
}

function applyComputedStyles(data: MindMapData, root: WorkingNode): void {
  const styles = getLayoutStyles(root);
  Object.entries(styles).forEach(([id, computedStyle]) => {
    const s = computedStyle as { fontSize?: number; fontWeight?: string; color?: string; borderColor?: string };
    const target = data.nodes[id];
    if (!target) return;
    const merged = { ...(target.style ?? {}) };
    let changed = false;
    if (s.fontSize && merged.fontSize === undefined) {
      merged.fontSize = s.fontSize;
      changed = true;
    }
    if (s.fontWeight && merged.fontWeight === undefined) {
      merged.fontWeight = s.fontWeight as any;
      changed = true;
    }
    if (s.color && merged.color === undefined) {
      merged.color = s.color;
      changed = true;
    }
    if (s.borderColor && merged.borderColor === undefined) {
      merged.borderColor = s.borderColor;
      changed = true;
    }
    // 有新增计算样式时才克隆节点，避免无意义的引用变化
    if (changed) {
      data.nodes[id] = { ...target, style: merged };
    }
  });
}

/** 将 ConnectionStyle 映射为 Theme（连线样式只影响绘制，不影响布局；layout 参数保留以兼容调用方） */
export function toTheme(_layout: MindMapLayout | undefined, connectionStyle: ConnectionStyle | undefined): Theme {
  return {
    siblingGap: 24,
    levelGap: 80,
    paddingX: 16,
    paddingY: 10,
    lineStyle: (connectionStyle === 'orthogonal' || connectionStyle === 'rounded') ? 'polyline' : (connectionStyle ?? 'bezier'),
  };
}
