import type { MindMapData } from '@/types/mindmap';
import { createEmptyMindMap, addNode, calculateTreeLayout } from '@/engine/mindmapEngine';

/** 无标题时的兜底根节点文本 */
const DEFAULT_ROOT_LABEL = '导入的导图';

// ATX 标题：`#` ~ `######`，`#` 后需跟空格或直接结束（CommonMark）
const HEADING_RE = /^(#{1,6})(?:\s+|$)(.*)$/;
// 无序列表项：前导空白 + `-` / `*` / `+` + 空格（制表符按 4 空格折算缩进）
const LIST_RE = /^(\s*)[-*+]\s+(.*)$/;
// 水平分割线（---、***、___ 及带空格变体），避免被当成正文段落
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
// 围栏代码块标记（``` 或 ~~~）
const FENCE_RE = /^\s*(```|~~~)/;

/**
 * 将 Markdown 文本解析为脑图数据（markmap/XMind 惯例）：
 * - 第一个标题作为根节点文本；后续同级 H1 作为根节点的一级子节点
 * - H2-H6 按标题级别嵌套（允许跳级，如 H1 直接跟 H3，按相对层级处理）
 * - 标题下的无序列表项作为更深层子节点，按缩进嵌套
 * - 标题/列表项下的正文段落挂到最近节点作为备注（note）
 * - 行内格式（粗体、代码、链接）保留原始 Markdown 文本
 */
export function parseMarkdownToMindMap(md: string): MindMapData {
  const data = createEmptyMindMap();
  data.nodes[data.rootId] = { ...data.nodes[data.rootId], label: DEFAULT_ROOT_LABEL };

  // 标题栈：按标题级别维护嵌套关系（栈顶即当前可挂载的父节点）
  const headingStack: { level: number; id: string }[] = [];
  // 列表栈：按缩进宽度维护嵌套关系，遇新标题时清空
  const listStack: { indent: number; id: string }[] = [];
  let sawHeading = false;
  // 段落备注挂到最近创建的节点（标题或列表项）
  let currentId = data.rootId;
  // 顶级列表项的兜底父节点：最近一个标题（无标题时为根）
  let currentHeadingId = data.rootId;
  // 连续正文行缓冲，遇空行/标题/列表项时冲刷为一段备注
  let paragraph: string[] = [];
  let inFence = false;

  const flushParagraph = () => {
    const text = paragraph.join('\n').trim();
    paragraph = [];
    if (!text) return;
    const node = data.nodes[currentId];
    const note = node.note ? `${node.note}\n\n${text}` : text;
    data.nodes[currentId] = { ...node, note };
  };

  for (const line of md.split(/\r\n?|\n/)) {
    // 围栏代码块：内容按原文收进备注，不参与标题/列表解析
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      paragraph.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '') {
      flushParagraph();
      continue;
    }
    if (HR_RE.test(line)) {
      flushParagraph();
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      flushParagraph();
      listStack.length = 0;
      const level = headingMatch[1].length;
      // 去掉可选的尾部闭合 `#`
      const text = headingMatch[2].replace(/\s+#+\s*$/, '').trim();
      if (!sawHeading) {
        // 第一个标题作为根节点文本
        sawHeading = true;
        data.nodes[data.rootId] = { ...data.nodes[data.rootId], label: text || DEFAULT_ROOT_LABEL };
        headingStack.push({ level, id: data.rootId });
        currentId = data.rootId;
        currentHeadingId = data.rootId;
        continue;
      }
      // 弹出同级及更深标题，剩余栈顶即父节点（跳级时按相对层级嵌套）
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      const parentId = headingStack.length ? headingStack[headingStack.length - 1].id : data.rootId;
      const node = addNode(data, parentId, text || '分支主题');
      headingStack.push({ level, id: node.id });
      currentId = node.id;
      currentHeadingId = node.id;
      continue;
    }

    const listMatch = line.match(LIST_RE);
    if (listMatch) {
      flushParagraph();
      const indent = listMatch[1].replace(/\t/g, '    ').length;
      const text = listMatch[2].trim();
      // 弹出同级及更深列表项，剩余栈顶即父节点；栈空时挂到最近标题下
      while (listStack.length && listStack[listStack.length - 1].indent >= indent) {
        listStack.pop();
      }
      const parentId = listStack.length ? listStack[listStack.length - 1].id : currentHeadingId;
      const node = addNode(data, parentId, text || '分支主题');
      listStack.push({ indent, id: node.id });
      currentId = node.id;
      continue;
    }

    // 其余非空行视为正文段落
    paragraph.push(trimmed);
  }
  flushParagraph();

  return calculateTreeLayout(data);
}
