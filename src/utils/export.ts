import type { MindMapData, MindNode, NodeID, ConnectionStyle, MindMapLayout } from '@/types/mindmap';

export type ExportFormat = 'png' | 'jpg' | 'svg' | 'pdf';

export interface ExportOptions {
  /** 导出分辨率缩放倍数，默认 2 */
  scale?: number;
  /** 背景：'transparent' | 'light' | 'dark' | 自定义颜色 */
  background?: 'transparent' | 'light' | 'dark' | string;
  /** 边缘留白，默认 40 */
  padding?: number;
  /** JPG 质量 0-1，默认 0.92 */
  quality?: number;
  /** 文件名，不含扩展名 */
  fileName?: string;
  /** 仅导出可见节点（考虑折叠），默认 true */
  onlyVisible?: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: Required<Omit<ExportOptions, 'fileName'>> = {
  scale: 2,
  background: 'light',
  padding: 40,
  quality: 0.92,
  onlyVisible: true,
};

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

function resolveOptions(options: ExportOptions): Required<ExportOptions> {
  return { ...DEFAULT_EXPORT_OPTIONS, ...options } as Required<ExportOptions>;
}

function getVisibleNodes(data: MindMapData): MindNode[] {
  const root = data.nodes[data.rootId];
  if (!root) return [];
  const result: MindNode[] = [root];
  const queue: MindNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.collapsed) continue;
    node.children.forEach((childId) => {
      const child = data.nodes[childId];
      if (child) {
        result.push(child);
        queue.push(child);
      }
    });
  }
  return result;
}

function getNodesBounds(nodes: MindNode[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const w = node.width ?? 120;
    const h = node.height ?? 40;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 200, maxY: 100, width: 200, height: 100 };
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function getBackgroundColor(background: ExportOptions['background'], theme: 'light' | 'dark'): string | null {
  if (background === 'transparent') return null;
  if (background === 'light') return '#f8f9fa';
  if (background === 'dark') return '#252525';
  return background || (theme === 'dark' ? '#252525' : '#f8f9fa');
}

function getThemeColors(theme: 'light' | 'dark') {
  return theme === 'dark'
    ? {
        nodeBg: '#2d2d2d',
        nodeBorder: '#555555',
        nodeText: '#e0e0e0',
        connectionColor: '#777777',
      }
    : {
        nodeBg: '#ffffff',
        nodeBorder: '#dddddd',
        nodeText: '#333333',
        connectionColor: '#999999',
      };
}

function connectionAnchors(
  parent: MindNode,
  child: MindNode,
  layout: MindMapLayout,
  rootId: NodeID
): { x1: number; y1: number; x2: number; y2: number } {
  const px = parent.x ?? 0;
  const py = parent.y ?? 0;
  const pw = parent.width ?? 120;
  const ph = parent.height ?? 40;
  const cx = child.x ?? 0;
  const cy = child.y ?? 0;
  const cw = child.width ?? 120;
  const ch = child.height ?? 40;

  const pcx = px + pw / 2;
  const pcy = py + ph / 2;
  const ccx = cx + cw / 2;
  const ccy = cy + ch / 2;

  const isRootChild = parent.id === rootId;

  if (layout === 'org') {
    return ccy >= pcy
      ? { x1: pcx, y1: py + ph, x2: ccx, y2: cy }
      : { x1: pcx, y1: py, x2: ccx, y2: cy + ch };
  }

  if (layout === 'timeline' && isRootChild) {
    return ccy >= pcy
      ? { x1: pcx, y1: py + ph, x2: ccx, y2: cy }
      : { x1: pcx, y1: py, x2: ccx, y2: cy + ch };
  }

  return ccx >= pcx
    ? { x1: px + pw, y1: pcy, x2: cx, y2: ccy }
    : { x1: px, y1: pcy, x2: cx + cw, y2: ccy };
}

function buildConnectionPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: ConnectionStyle
): string {
  if (x1 === x2 || y1 === y2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  switch (style) {
    case 'straight':
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    case 'orthogonal': {
      const midX = (x1 + x2) / 2;
      return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
    }
    case 'rounded': {
      const midX = (x1 + x2) / 2;
      const radius = 12;
      const dirX = x2 > x1 ? 1 : -1;
      const dirY = y2 > y1 ? 1 : -1;
      const rx = Math.min(radius, Math.abs(midX - x1) / 2, Math.abs(x2 - midX) / 2);
      const ry = Math.min(radius, Math.abs(y2 - y1) / 2);
      return `M ${x1} ${y1} L ${midX - dirX * rx} ${y1} Q ${midX} ${y1} ${midX} ${y1 + dirY * ry} L ${midX} ${y2 - dirY * ry} Q ${midX} ${y2} ${midX + dirX * rx} ${y2} L ${x2} ${y2}`;
    }
    case 'bezier':
    default: {
      const midX = (x1 + x2) / 2;
      return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    }
  }
}

function drawConnectionPath(ctx: CanvasRenderingContext2D, d: string) {
  const path = new Path2D(d);
  ctx.stroke(path);
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
) {
  ctx.beginPath();
  ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  ctx.closePath();
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: MindNode,
  offsetX: number,
  offsetY: number,
  theme: 'light' | 'dark'
) {
  const x = (node.x ?? 0) + offsetX;
  const y = (node.y ?? 0) + offsetY;
  const width = node.width ?? 120;
  const height = node.height ?? 40;
  const themeColors = getThemeColors(theme);
  const bg = node.style?.background ?? themeColors.nodeBg;
  const borderColor = node.style?.borderColor ?? themeColors.nodeBorder;
  const color = node.style?.color ?? themeColors.nodeText;
  const shape = node.style?.shape ?? 'rounded';
  const fontSize = node.style?.fontSize ?? 14;
  const fontWeight = node.style?.fontWeight ?? 'normal';
  const fontStyle = node.style?.fontStyle ?? 'normal';
  const textDecoration = node.style?.textDecoration ?? 'none';

  // 绘制背景
  if (shape === 'ellipse') {
    drawEllipse(ctx, x, y, width, height);
  } else if (shape === 'rectangle') {
    drawRoundRect(ctx, x, y, width, height, 2);
  } else {
    drawRoundRect(ctx, x, y, width, height, 8);
  }
  ctx.fillStyle = bg;
  ctx.fill();

  // 绘制边框
  ctx.lineWidth = 1;
  ctx.strokeStyle = borderColor;
  ctx.stroke();

  // 绘制文本
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const label = node.icon ? `${node.icon} ${node.label}` : node.label;
  const maxWidth = width - 24;
  const textX = x + width / 2;
  const textY = y + height / 2;

  // 简单截断，保证不超出节点
  let displayText = label;
  let measured = ctx.measureText(displayText);
  while (measured.width > maxWidth && displayText.length > 0) {
    displayText = displayText.slice(0, -1);
    measured = ctx.measureText(displayText + '…');
  }
  if (displayText.length < label.length) {
    displayText = displayText + '…';
  }

  ctx.fillText(displayText, textX, textY);

  // 下划线 / 删除线
  if (textDecoration === 'underline') {
    ctx.beginPath();
    ctx.moveTo(textX - measured.width / 2, textY + fontSize / 2 + 2);
    ctx.lineTo(textX + measured.width / 2, textY + fontSize / 2 + 2);
    ctx.strokeStyle = color;
    ctx.stroke();
  } else if (textDecoration === 'line-through') {
    ctx.beginPath();
    ctx.moveTo(textX - measured.width / 2, textY);
    ctx.lineTo(textX + measured.width / 2, textY);
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  ctx.restore();
}

function drawDefaultConnections(
  ctx: CanvasRenderingContext2D,
  data: MindMapData,
  visibleNodes: MindNode[],
  offsetX: number,
  offsetY: number
) {
  const layout = (data.layout ?? 'balanced') as MindMapLayout;
  const style = data.connectionStyle ?? 'bezier';
  const visibleSet = new Set(visibleNodes.map((n) => n.id));
  const stroke = data.connectionColor ?? getThemeColors('light').connectionColor;
  const lineWidth = data.connectionWidth ?? 1.5;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  visibleNodes.forEach((node) => {
    if (!node.children || node.children.length === 0) return;
    node.children.forEach((childId) => {
      const child = data.nodes[childId];
      if (!child || !visibleSet.has(childId)) return;
      if (
        node.x === undefined ||
        node.y === undefined ||
        child.x === undefined ||
        child.y === undefined
      ) {
        return;
      }
      const { x1, y1, x2, y2 } = connectionAnchors(node, child, layout, data.rootId);
      const path = buildConnectionPath(x1 + offsetX, y1 + offsetY, x2 + offsetX, y2 + offsetY, style);
      drawConnectionPath(ctx, path);
    });
  });

  ctx.restore();
}

function drawTopDownTreeConnections(
  ctx: CanvasRenderingContext2D,
  data: MindMapData,
  visibleNodes: MindNode[],
  offsetX: number,
  offsetY: number,
  shouldRender: (parent: MindNode) => boolean
) {
  const visibleSet = new Set(visibleNodes.map((n) => n.id));
  const style = data.connectionStyle ?? 'bezier';
  const stroke = data.connectionColor ?? getThemeColors('light').connectionColor;
  const lineWidth = data.connectionWidth ?? 1.5;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  visibleNodes.forEach((parent) => {
    if (!shouldRender(parent)) return;
    if (!parent.children || parent.children.length === 0) return;

    const children = parent.children
      .map((id) => data.nodes[id])
      .filter((child): child is MindNode => !!child && visibleSet.has(child.id));
    if (children.length === 0) return;
    if (parent.x === undefined || parent.y === undefined) return;

    const px = parent.x;
    const py = parent.y;
    const pw = parent.width ?? 120;
    const ph = parent.height ?? 40;
    const pcx = px + pw / 2;
    const pBottom = py + ph;

    const childTops = children.map((child) => {
      const cx = child.x ?? 0;
      const cy = child.y ?? 0;
      const cw = child.width ?? 120;
      return { x: cx + cw / 2, y: cy, id: child.id };
    });

    const minX = Math.min(...childTops.map((c) => c.x));
    const maxX = Math.max(...childTops.map((c) => c.x));
    const childY = childTops[0].y;
    const midY = (pBottom + childY) / 2;

    drawConnectionPath(ctx, buildConnectionPath(pcx + offsetX, pBottom + offsetY, pcx + offsetX, midY + offsetY, style));
    if (children.length > 1) {
      drawConnectionPath(ctx, buildConnectionPath(minX + offsetX, midY + offsetY, maxX + offsetX, midY + offsetY, style));
    }
    childTops.forEach((childTop) => {
      drawConnectionPath(ctx, buildConnectionPath(childTop.x + offsetX, midY + offsetY, childTop.x + offsetX, childTop.y + offsetY, style));
    });
  });

  ctx.restore();
}

function drawConnections(
  ctx: CanvasRenderingContext2D,
  data: MindMapData,
  visibleNodes: MindNode[],
  offsetX: number,
  offsetY: number
) {
  const layout = data.layout ?? 'balanced';
  const connectionStyle = data.connectionStyle ?? 'bezier';

  if (layout === 'org') {
    if (connectionStyle === 'orthogonal' || connectionStyle === 'rounded') {
      drawTopDownTreeConnections(ctx, data, visibleNodes, offsetX, offsetY, () => true);
    } else {
      drawDefaultConnections(ctx, data, visibleNodes, offsetX, offsetY);
    }
  } else if (layout === 'timeline') {
    if (connectionStyle === 'orthogonal' || connectionStyle === 'rounded') {
      drawTopDownTreeConnections(ctx, data, visibleNodes, offsetX, offsetY, (parent) => parent.id === data.rootId);
      drawDefaultConnections(ctx, data, visibleNodes, offsetX, offsetY);
    } else {
      drawDefaultConnections(ctx, data, visibleNodes, offsetX, offsetY);
    }
  } else {
    drawDefaultConnections(ctx, data, visibleNodes, offsetX, offsetY);
  }
}

function drawRelations(
  ctx: CanvasRenderingContext2D,
  data: MindMapData,
  visibleNodes: MindNode[],
  offsetX: number,
  offsetY: number
) {
  const relations = data.relations ?? [];
  if (relations.length === 0) return;
  const visibleSet = new Set(visibleNodes.map((n) => n.id));

  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  relations.forEach((relation) => {
    const source = data.nodes[relation.source];
    const target = data.nodes[relation.target];
    if (!source || !target || !visibleSet.has(source.id) || !visibleSet.has(target.id)) return;
    if (
      source.x === undefined ||
      source.y === undefined ||
      target.x === undefined ||
      target.y === undefined
    ) {
      return;
    }

    const { x1, y1, x2, y2 } = connectionAnchors(source, target, 'balanced', data.rootId);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const path = `M ${x1 + offsetX} ${y1 + offsetY} C ${midX + offsetX} ${y1 + offsetY}, ${midX + offsetX} ${y2 + offsetY}, ${x2 + offsetX} ${y2 + offsetY}`;

    ctx.strokeStyle = relation.color || '#FF6B6B';
    if (relation.style === 'dashed') {
      ctx.setLineDash([6, 4]);
    } else if (relation.style === 'dotted') {
      ctx.setLineDash([2, 4]);
    } else {
      ctx.setLineDash([]);
    }
    drawConnectionPath(ctx, path);

    if (relation.label) {
      ctx.setLineDash([]);
      ctx.fillStyle = relation.color || '#FF6B6B';
      ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(relation.label, midX + offsetX, midY + offsetY - 4);
    }
  });

  ctx.restore();
}

async function renderToCanvas(
  data: MindMapData,
  theme: 'light' | 'dark',
  options: Required<ExportOptions>
): Promise<HTMLCanvasElement> {
  const nodes = options.onlyVisible ? getVisibleNodes(data) : Object.values(data.nodes);
  const bounds = getNodesBounds(nodes);
  const padding = options.padding;
  const width = Math.ceil(bounds.width + padding * 2);
  const height = Math.ceil(bounds.height + padding * 2);
  const offsetX = -bounds.minX + padding;
  const offsetY = -bounds.minY + padding;
  const scale = options.scale;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width * scale);
  canvas.height = Math.max(1, height * scale);
  const ctx = canvas.getContext('2d')!;

  // 填充背景
  const bgColor = getBackgroundColor(options.background, theme);
  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  ctx.save();
  ctx.scale(scale, scale);

  drawConnections(ctx, data, nodes, offsetX, offsetY);
  drawRelations(ctx, data, nodes, offsetX, offsetY);
  nodes.forEach((node) => drawNode(ctx, node, offsetX, offsetY, theme));

  ctx.restore();
  return canvas;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function imageDataUrlToPdf(
  dataUrl: string,
  width: number,
  height: number
): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const ptWidth = width * 0.75;
  const ptHeight = height * 0.75;
  const orientation = ptWidth > ptHeight ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    orientation,
    unit: 'pt',
    format: [Math.max(ptWidth, 10), Math.max(ptHeight, 10)],
    putOnlyUsedFonts: true,
    compress: true,
  });
  pdf.addImage(dataUrl, 'PNG', 0, 0, ptWidth, ptHeight);
  return new Uint8Array(pdf.output('arraybuffer'));
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderNodeSvg(node: MindNode, offsetX: number, offsetY: number, theme: 'light' | 'dark'): string {
  const x = (node.x ?? 0) + offsetX;
  const y = (node.y ?? 0) + offsetY;
  const width = node.width ?? 120;
  const height = node.height ?? 40;
  const themeColors = getThemeColors(theme);
  const bg = node.style?.background ?? themeColors.nodeBg;
  const borderColor = node.style?.borderColor ?? themeColors.nodeBorder;
  const color = node.style?.color ?? themeColors.nodeText;
  const shape = node.style?.shape ?? 'rounded';
  const fontSize = node.style?.fontSize ?? 14;
  const fontWeight = node.style?.fontWeight ?? 'normal';
  const fontStyle = node.style?.fontStyle ?? 'normal';
  const textDecoration = node.style?.textDecoration ?? 'none';
  const rx = shape === 'ellipse' ? width / 2 : shape === 'rectangle' ? 2 : 8;
  const ry = shape === 'ellipse' ? height / 2 : shape === 'rectangle' ? 2 : 8;

  const label = node.icon ? `${node.icon} ${node.label}` : node.label;
  const textDecorationStyle = textDecoration === 'underline' ? 'text-decoration: underline;' : textDecoration === 'line-through' ? 'text-decoration: line-through;' : '';

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ry="${ry}" fill="${bg}" stroke="${borderColor}" stroke-width="1"/>
    <foreignObject x="${x + 12}" y="${y}" width="${Math.max(0, width - 24)}" height="${height}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${fontSize}px;font-weight:${fontWeight};font-style:${fontStyle};${textDecorationStyle}color:${color};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        ${escapeXml(label)}
      </div>
    </foreignObject>
  `;
}

function renderConnectionsSvg(
  data: MindMapData,
  visibleNodes: MindNode[],
  offsetX: number,
  offsetY: number
): string {
  const layout = data.layout ?? 'balanced';
  const connectionStyle = data.connectionStyle ?? 'bezier';
  const stroke = data.connectionColor ?? getThemeColors('light').connectionColor;
  const strokeWidth = data.connectionWidth ?? 1.5;
  const visibleSet = new Set(visibleNodes.map((n) => n.id));
  let paths = '';

  const renderParent = (parent: MindNode, excludeRootChildren = false) => {
    if (!parent.children || parent.children.length === 0) return;
    if (excludeRootChildren && parent.id === data.rootId) return;
    parent.children.forEach((childId) => {
      const child = data.nodes[childId];
      if (!child || !visibleSet.has(childId)) return;
      if (
        parent.x === undefined ||
        parent.y === undefined ||
        child.x === undefined ||
        child.y === undefined
      ) {
        return;
      }
      const { x1, y1, x2, y2 } = connectionAnchors(parent, child, layout as MindMapLayout, data.rootId);
      const d = buildConnectionPath(x1 + offsetX, y1 + offsetY, x2 + offsetX, y2 + offsetY, connectionStyle);
      paths += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    });
  };

  if (layout === 'org') {
    if (connectionStyle === 'orthogonal' || connectionStyle === 'rounded') {
      visibleNodes.forEach((parent) => {
        if (!parent.children || parent.children.length === 0) return;
        const children = parent.children
          .map((id) => data.nodes[id])
          .filter((child): child is MindNode => !!child && visibleSet.has(child.id));
        if (children.length === 0 || parent.x === undefined || parent.y === undefined) return;
        const px = parent.x;
        const py = parent.y;
        const pw = parent.width ?? 120;
        const ph = parent.height ?? 40;
        const pcx = px + pw / 2;
        const pBottom = py + ph;
        const childTops = children.map((child) => {
          const cx = child.x ?? 0;
          const cy = child.y ?? 0;
          const cw = child.width ?? 120;
          return { x: cx + cw / 2, y: cy };
        });
        const minX = Math.min(...childTops.map((c) => c.x));
        const maxX = Math.max(...childTops.map((c) => c.x));
        const childY = childTops[0].y;
        const midY = (pBottom + childY) / 2;
        paths += `<path d="${buildConnectionPath(pcx + offsetX, pBottom + offsetY, pcx + offsetX, midY + offsetY, connectionStyle)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
        if (children.length > 1) {
          paths += `<path d="${buildConnectionPath(minX + offsetX, midY + offsetY, maxX + offsetX, midY + offsetY, connectionStyle)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
        childTops.forEach((childTop) => {
          paths += `<path d="${buildConnectionPath(childTop.x + offsetX, midY + offsetY, childTop.x + offsetX, childTop.y + offsetY, connectionStyle)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
        });
      });
    } else {
      visibleNodes.forEach((parent) => renderParent(parent));
    }
  } else if (layout === 'timeline') {
    if (connectionStyle === 'orthogonal' || connectionStyle === 'rounded') {
      visibleNodes.forEach((parent) => {
        if (parent.id !== data.rootId) return;
        if (!parent.children || parent.children.length === 0) return;
        const children = parent.children
          .map((id) => data.nodes[id])
          .filter((child): child is MindNode => !!child && visibleSet.has(child.id));
        if (children.length === 0 || parent.x === undefined || parent.y === undefined) return;
        const px = parent.x;
        const py = parent.y;
        const pw = parent.width ?? 120;
        const ph = parent.height ?? 40;
        const pcx = px + pw / 2;
        const pBottom = py + ph;
        const childTops = children.map((child) => {
          const cx = child.x ?? 0;
          const cy = child.y ?? 0;
          const cw = child.width ?? 120;
          return { x: cx + cw / 2, y: cy };
        });
        const minX = Math.min(...childTops.map((c) => c.x));
        const maxX = Math.max(...childTops.map((c) => c.x));
        const childY = childTops[0].y;
        const midY = (pBottom + childY) / 2;
        paths += `<path d="${buildConnectionPath(pcx + offsetX, pBottom + offsetY, pcx + offsetX, midY + offsetY, connectionStyle)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
        if (children.length > 1) {
          paths += `<path d="${buildConnectionPath(minX + offsetX, midY + offsetY, maxX + offsetX, midY + offsetY, connectionStyle)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
        childTops.forEach((childTop) => {
          paths += `<path d="${buildConnectionPath(childTop.x + offsetX, midY + offsetY, childTop.x + offsetX, childTop.y + offsetY, connectionStyle)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
        });
      });
      visibleNodes.forEach((parent) => renderParent(parent, true));
    } else {
      visibleNodes.forEach((parent) => renderParent(parent));
    }
  } else {
    visibleNodes.forEach((parent) => renderParent(parent));
  }

  return paths;
}

function renderRelationsSvg(
  data: MindMapData,
  visibleNodes: MindNode[],
  offsetX: number,
  offsetY: number
): string {
  const relations = data.relations ?? [];
  if (relations.length === 0) return '';
  const visibleSet = new Set(visibleNodes.map((n) => n.id));
  let result = '';

  relations.forEach((relation) => {
    const source = data.nodes[relation.source];
    const target = data.nodes[relation.target];
    if (!source || !target || !visibleSet.has(source.id) || !visibleSet.has(target.id)) return;
    if (
      source.x === undefined ||
      source.y === undefined ||
      target.x === undefined ||
      target.y === undefined
    ) {
      return;
    }
    const { x1, y1, x2, y2 } = connectionAnchors(source, target, 'balanced', data.rootId);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const d = `M ${x1 + offsetX} ${y1 + offsetY} C ${midX + offsetX} ${y1 + offsetY}, ${midX + offsetX} ${y2 + offsetY}, ${x2 + offsetX} ${y2 + offsetY}`;
    const dash = relation.style === 'dashed' ? ' stroke-dasharray="6,4"' : relation.style === 'dotted' ? ' stroke-dasharray="2,4"' : '';
    result += `<path d="${d}" fill="none" stroke="${relation.color || '#FF6B6B'}" stroke-width="2"${dash} stroke-linecap="round"/>`;
    if (relation.label) {
      result += `<text x="${midX + offsetX}" y="${midY + offsetY - 4}" text-anchor="middle" font-size="11" fill="${relation.color || '#FF6B6B'}">${escapeXml(relation.label)}</text>`;
    }
  });

  return result;
}

function renderSvg(data: MindMapData, theme: 'light' | 'dark', options: Required<ExportOptions>): string {
  const nodes = options.onlyVisible ? getVisibleNodes(data) : Object.values(data.nodes);
  const bounds = getNodesBounds(nodes);
  const padding = options.padding;
  const width = Math.ceil(bounds.width + padding * 2);
  const height = Math.ceil(bounds.height + padding * 2);
  const offsetX = -bounds.minX + padding;
  const offsetY = -bounds.minY + padding;
  const bgColor = getBackgroundColor(options.background, theme);

  const bgRect = bgColor ? `<rect width="100%" height="100%" fill="${bgColor}"/>` : '';
  const connections = renderConnectionsSvg(data, nodes, offsetX, offsetY);
  const relations = renderRelationsSvg(data, nodes, offsetX, offsetY);
  const nodeEls = nodes.map((node) => renderNodeSvg(node, offsetX, offsetY, theme)).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${bgRect}
  ${connections}
  ${relations}
  ${nodeEls}
</svg>`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    ),
  ]);
}

export async function exportMindMap(
  _containerEl: HTMLElement,
  data: MindMapData,
  theme: 'light' | 'dark',
  format: ExportFormat,
  options: ExportOptions = {}
): Promise<{ content: Uint8Array | string; extension: string; fileName: string }> {
  const opts = resolveOptions(options);
  const baseName = opts.fileName || `freemind_${formatDate()}`;
  const timeoutMs = 60000;

  if (format === 'svg') {
    const svg = renderSvg(data, theme, opts);
    return { content: svg, extension: 'svg', fileName: `${baseName}.svg` };
  }

  const canvas = await withTimeout(
    renderToCanvas(data, theme, opts),
    timeoutMs,
    'Canvas 渲染'
  );

  if (format === 'jpg') {
    const dataUrl = canvas.toDataURL('image/jpeg', opts.quality);
    return { content: dataUrlToUint8Array(dataUrl), extension: 'jpg', fileName: `${baseName}.jpg` };
  }

  if (format === 'png') {
    const dataUrl = canvas.toDataURL('image/png');
    return { content: dataUrlToUint8Array(dataUrl), extension: 'png', fileName: `${baseName}.png` };
  }

  // PDF
  const pngDataUrl = canvas.toDataURL('image/png');
  const width = canvas.width / opts.scale;
  const height = canvas.height / opts.scale;
  const pdfBytes = await withTimeout(
    imageDataUrlToPdf(pngDataUrl, width, height),
    timeoutMs,
    'PDF 生成'
  );
  return { content: pdfBytes, extension: 'pdf', fileName: `${baseName}.pdf` };
}

function formatDate(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${MM}${dd}${hh}${mm}${ss}`;
}
