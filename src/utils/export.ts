import type { MindMapData, MindNode } from '@/types/mindmap';
import html2canvas from 'html2canvas';

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

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export const DEFAULT_EXPORT_OPTIONS: Required<Omit<ExportOptions, 'fileName'>> = {
  scale: 2,
  background: 'light',
  padding: 40,
  quality: 0.92,
  onlyVisible: true,
};

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

/**
 * 创建用于导出的临时画布容器。
 * 返回临时容器元素和对应的导出尺寸，使用完毕后需要调用方从 DOM 中移除。
 */
function createExportContainer(
  containerEl: HTMLElement,
  data: MindMapData,
  options: Required<ExportOptions>
): { wrapper: HTMLDivElement; clone: HTMLElement; width: number; height: number } {
  const nodes = options.onlyVisible ? getVisibleNodes(data) : Object.values(data.nodes);
  const bounds = getNodesBounds(nodes);
  const padding = options.padding;
  const width = Math.ceil(bounds.width + padding * 2);
  const height = Math.ceil(bounds.height + padding * 2);
  const offsetX = -bounds.minX + padding;
  const offsetY = -bounds.minY + padding;

  const innerRef = containerEl.firstElementChild as HTMLElement | null;
  if (!innerRef) {
    throw new Error('找不到画布 inner 容器');
  }

  const wrapper = document.createElement('div');
  // 放在视口左上角但置于最底层，避免 html2canvas 因屏幕外而计算出 0 尺寸
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.overflow = 'hidden';
  wrapper.style.backgroundColor = 'transparent';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.zIndex = '-9999';
  document.body.appendChild(wrapper);

  const clone = innerRef.cloneNode(true) as HTMLElement;
  clone.style.transform = 'none';
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.position = 'absolute';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.background = 'transparent';
  clone.style.overflow = 'visible';

  // 移除选框、右键菜单、样式面板等不需要的元素
  clone.querySelectorAll('[data-box-select]').forEach((el) => el.remove());
  clone.querySelectorAll('[data-context-menu]').forEach((el) => el.remove());
  clone.querySelectorAll('[data-style-panel]').forEach((el) => el.remove());

  // 调整节点位置，移除选中/拖拽等临时状态
  clone.querySelectorAll('[data-node-id]').forEach((el) => {
    const div = el as HTMLElement;
    const nodeId = div.getAttribute('data-node-id')!;
    const node = data.nodes[nodeId];
    if (!node) {
      div.remove();
      return;
    }
    div.style.left = `${(node.x ?? 0) + offsetX}px`;
    div.style.top = `${(node.y ?? 0) + offsetY}px`;
    div.style.transform = 'none';
    div.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    // 编辑中的 input 替换为文本展示
    const input = div.querySelector('input');
    if (input) {
      const label = input.value || node.label;
      const span = document.createElement('span');
      span.textContent = label;
      span.style.overflow = 'hidden';
      span.style.textOverflow = 'ellipsis';
      span.style.whiteSpace = 'nowrap';
      input.replaceWith(span);
    }
  });

  wrapper.appendChild(clone);
  return { wrapper, clone, width, height };
}

function removeExportContainer(wrapper: HTMLDivElement) {
  if (wrapper.parentNode) {
    wrapper.parentNode.removeChild(wrapper);
  }
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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    ),
  ]);
}

/**
 * 使用 html2canvas 将 DOM 渲染为 Canvas，再导出为 PNG/JPG DataURL。
 */
async function renderToImageDataUrl(
  clone: HTMLElement,
  width: number,
  height: number,
  format: 'png' | 'jpg',
  scale: number,
  quality: number,
  backgroundColor: string | null
): Promise<string> {
  const canvas = await html2canvas(clone, {
    backgroundColor,
    scale,
    width,
    height,
    x: 0,
    y: 0,
    useCORS: true,
    allowTaint: true,
    logging: false,
  });

  if (format === 'jpg') {
    // html2canvas 的 backgroundColor 在 JPG 下已处理，但为确保不透明再填充一次
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = canvas.width;
    finalCanvas.height = canvas.height;
    const ctx = finalCanvas.getContext('2d')!;
    ctx.fillStyle = backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    ctx.drawImage(canvas, 0, 0);
    return finalCanvas.toDataURL('image/jpeg', quality);
  }

  return canvas.toDataURL('image/png');
}

/**
 * 主导出方法：根据格式返回对应的 Uint8Array 或字符串内容。
 */
export async function exportMindMap(
  containerEl: HTMLElement,
  data: MindMapData,
  theme: 'light' | 'dark',
  format: ExportFormat,
  options: ExportOptions = {}
): Promise<{ content: Uint8Array | string; extension: string; fileName: string }> {
  const opts = resolveOptions(options);
  const baseName = opts.fileName || `freemind_${formatDate()}`;
  const timeoutMs = 60000;

  let wrapper: HTMLDivElement | null = null;
  try {
    const { wrapper: w, clone, width, height } = createExportContainer(containerEl, data, opts);
    wrapper = w;

    const bgColor = getBackgroundColor(opts.background, theme);
    const scale = opts.scale;

    if (format === 'svg') {
      // SVG 导出：使用 html2canvas 生成节点位图，再与 SVG 连线组合
      // 这不是真正的矢量 SVG，但能确保内容与画布一致
      const nodesCanvas = await withTimeout(
        html2canvas(clone, {
          backgroundColor: bgColor,
          scale: 1,
          width,
          height,
          x: 0,
          y: 0,
          useCORS: true,
          allowTaint: true,
          logging: false,
        }),
        timeoutMs,
        'SVG 节点渲染'
      );
      const nodesDataUrl = nodesCanvas.toDataURL('image/png');
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${bgColor || 'transparent'}"/>
  <image width="${width}" height="${height}" xlink:href="${nodesDataUrl}"/>
</svg>`;
      return { content: svg, extension: 'svg', fileName: `${baseName}.svg` };
    }

    const dataUrl = await withTimeout(
      renderToImageDataUrl(clone, width, height, format === 'jpg' ? 'jpg' : 'png', scale, opts.quality, bgColor),
      timeoutMs,
      `${format.toUpperCase()} 导出`
    );

    if (format === 'pdf') {
      const pdfBytes = await withTimeout(
        imageDataUrlToPdf(dataUrl, width * scale, height * scale),
        timeoutMs,
        'PDF 生成'
      );
      return { content: pdfBytes, extension: 'pdf', fileName: `${baseName}.pdf` };
    }

    return { content: dataUrlToUint8Array(dataUrl), extension: format, fileName: `${baseName}.${format}` };
  } finally {
    if (wrapper) {
      removeExportContainer(wrapper);
    }
  }
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
