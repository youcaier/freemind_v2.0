import type { WorkingNode, Theme, LayoutResult } from './index';
import {
  convertToLayoutTree,
  toLayoutResult,
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
  const theme = toTheme(data.layout, data.connectionStyle);
  const root = convertToLayoutTree(data.rootId, data.nodes, undefined, 0, 0);

  runLayout(root, data.layout, startX, startY, theme);

  // 将 WorkingNode 的 bbox 写回 data.nodes
  applyLayoutResult(data, root);

  // 将自动层级/分支配色样式合并到节点（不覆盖用户已设置的样式）
  applyComputedStyles(data, root);

  return data;
}

export function toLayoutResultFromData(data: MindMapData, startX = 0, startY = 0): LayoutResult {
  const theme = toTheme(data.layout, data.connectionStyle);
  const root = convertToLayoutTree(data.rootId, data.nodes, undefined, 0, 0);
  runLayout(root, data.layout, startX, startY, theme);
  return toLayoutResult(root, theme);
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
      target.x = node.bbox.x;
      target.y = node.bbox.y;
      target.width = node.bbox.width;
      target.height = node.bbox.height;
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
    if (!target.style) target.style = {};
    if (s.fontSize && target.style.fontSize === undefined) {
      target.style.fontSize = s.fontSize;
    }
    if (s.fontWeight && target.style.fontWeight === undefined) {
      target.style.fontWeight = s.fontWeight as any;
    }
    if (s.color && target.style.color === undefined) {
      target.style.color = s.color;
    }
    if (s.borderColor && target.style.borderColor === undefined) {
      target.style.borderColor = s.borderColor;
    }
  });
}

/** 将 MindMapLayout + ConnectionStyle 映射为 Theme */
export function toTheme(layout: MindMapLayout | undefined, connectionStyle: ConnectionStyle | undefined): Theme {
  const map: Record<MindMapLayout, Theme['direction']> = {
    balanced: 'radial',
    fishbone: 'right',
    timeline: 'bottom',
    org: 'bottom',
    leftTree: 'left',
    rightTree: 'right',
  };
  return {
    siblingGap: 24,
    levelGap: 80,
    paddingX: 16,
    paddingY: 10,
    lineStyle: (connectionStyle === 'orthogonal' || connectionStyle === 'rounded') ? 'polyline' : (connectionStyle ?? 'bezier'),
    direction: map[layout ?? 'balanced'],
  };
}
