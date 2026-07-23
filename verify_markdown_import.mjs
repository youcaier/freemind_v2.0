// Markdown 导入功能自动化自测脚本
// 用法：先 `npm run dev` 启动 Vite（端口 1420），再 `node verify_markdown_import.mjs`
// 覆盖：解析器纯函数（动态 import TS 模块）+ File 菜单「导入 Markdown…」项的 DOM 断言
import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = 'http://localhost:1420';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--window-size=1400,900'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on('pageerror', (err) => {
    // 纯浏览器下 @tauri-apps/api 的 transformCallback 报错属预期，忽略
    if (err.message.includes('transformCallback') || err.message.includes('tauri')) return;
    console.error('[pageerror]', err.message);
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.toolbar', { timeout: 10000 });

  // 在页面里动态 import TS 模块（Vite dev 直接编译），挂到 window 供后续用例调用
  await page.evaluate(async () => {
    const mod = await import('/src/utils/importMarkdown.ts');
    window.__parse = mod.parseMarkdownToMindMap;
    // 序列化为可比较的纯 JSON 树
    window.__tree = (data, id = data.rootId) => {
      const n = data.nodes[id];
      return {
        label: n.label,
        note: n.note ?? null,
        children: n.children.map((c) => window.__tree(data, c)),
      };
    };
  });

  const parse = (md) =>
    page.evaluate((m) => {
      const data = window.__parse(m);
      return { rootId: data.rootId, nodeCount: Object.keys(data.nodes).length, tree: window.__tree(data), root: data.nodes[data.rootId] };
    }, md);

  // ---------- 1. 单 H1 + 多级标题嵌套 ----------
  console.log('1. 单 H1 + 多级标题嵌套');
  {
    const { tree } = await parse('# 根\n## A\n### A1\n## B\n正文 B');
    assert(tree.label === '根', 'H1 作为根节点文本');
    assert(tree.children.length === 2 && tree.children[0].label === 'A' && tree.children[1].label === 'B', 'H2 作为一级子节点');
    assert(tree.children[0].children.length === 1 && tree.children[0].children[0].label === 'A1', 'H3 嵌套在 H2 下');
    assert(tree.children[1].note === '正文 B', '标题下正文段落挂为 note');
  }

  // ---------- 2. 多个 H1 并列 ----------
  console.log('2. 多个 H1 并列');
  {
    const { tree } = await parse('# R1\n## a\n# R2\n## b');
    assert(tree.label === 'R1', '第一个 H1 为根');
    assert(tree.children.length === 2 && tree.children[0].label === 'a' && tree.children[1].label === 'R2', '后续 H1 作为根的一级子节点');
    assert(tree.children[1].children.length === 1 && tree.children[1].children[0].label === 'b', '第二个 H1 下的 H2 正确嵌套');
  }

  // ---------- 3. 跳级（H1 → H3）----------
  console.log('3. 跳级标题按相对层级处理');
  {
    const { tree } = await parse('# R\n### 深\n## 浅');
    assert(tree.children.length === 2 && tree.children[0].label === '深' && tree.children[1].label === '浅', 'H1→H3 跳级：H3 直接挂到 H1 下，后续 H2 与其同级');
  }

  // ---------- 4. 列表项作为子节点、嵌套层级 ----------
  console.log('4. 列表项层级');
  {
    const { tree } = await parse('# R\n## A\n- x\n- y\n  - y1\n  - y2\n* z\n\t- z1');
    const a = tree.children[0];
    assert(a.children.length === 3 && a.children[0].label === 'x' && a.children[1].label === 'y' && a.children[2].label === 'z', '同级列表项（含 * 标记）并列挂在标题下');
    const y = a.children[1];
    assert(y.children.length === 2 && y.children[0].label === 'y1' && y.children[1].label === 'y2', '空格缩进列表项嵌套为子节点');
    const z = a.children[2];
    assert(z.children.length === 1 && z.children[0].label === 'z1', '制表符缩进列表项嵌套为子节点');
  }

  // ---------- 5. 段落 → note ----------
  console.log('5. 正文段落挂为备注');
  {
    const { tree } = await parse('# R\n第一段\n第二行\n\n第二段\n- item\n列表项备注');
    assert(tree.note === '第一段\n第二行\n\n第二段', '根节点连续行合并为一段、空行分段');
    assert(tree.children[0].note === '列表项备注', '列表项下的段落挂到列表项');
  }

  // ---------- 6. 空输入 / 无标题输入 ----------
  console.log('6. 空输入与无标题输入兜底');
  {
    const empty = await parse('');
    assert(empty.nodeCount === 1 && empty.tree.label === '导入的导图', '空输入：默认根节点、不崩溃');
    const noHeading = await parse('只有正文\n- 列表项');
    assert(noHeading.tree.label === '导入的导图', '无标题：默认根节点文本');
    assert(noHeading.tree.note === '只有正文' && noHeading.tree.children.length === 1 && noHeading.tree.children[0].label === '列表项', '无标题：正文进根 note、列表项挂根下');
  }

  // ---------- 7. 行内格式保留原文 ----------
  console.log('7. 行内格式保留原始 Markdown 文本');
  {
    const { tree } = await parse('# R\n## **粗体** 和 `代码`\n- [链接](https://example.com)');
    assert(tree.children[0].label === '**粗体** 和 `代码`', '标题行内格式保留原文');
    assert(tree.children[0].children[0].label === '[链接](https://example.com)', '列表项链接语法保留原文');
  }

  // ---------- 8. 布局坐标已写回 ----------
  console.log('8. 解析结果已过布局');
  {
    const { root } = await parse('# R\n## A');
    assert(Number.isFinite(root.x) && Number.isFinite(root.y), '根节点带有限布局坐标');
  }

  // ---------- 9. File 菜单存在「导入 Markdown…」项 ----------
  console.log('9. File 菜单项');
  {
    await page.click('.file-menu-trigger');
    await sleep(300);
    const items = await page.$$eval('.file-menu-item', (els) => els.map((e) => e.textContent));
    assert(items.some((t) => t.includes('导入 Markdown')), 'File 菜单存在「导入 Markdown…」项');
    await page.keyboard.press('Escape');
    await sleep(200);
  }

  // ---------- 10. 完整导入流程（mock Tauri 对话框）：导入后视图自动居中 ----------
  console.log('10. 导入流程：视图自动居中到根节点');
  {
    // 先把视口平移到远离原点的位置，模拟用户导入前已拖动过视图
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1400, height: 900 });
    page2.on('pageerror', (err) => {
      if (err.message.includes('transformCallback') || err.message.includes('tauri')) return;
      console.error('[pageerror]', err.message);
    });
    // 页面加载前 mock Tauri 环境：对话框返回假路径，read_text_file 返回 Markdown 内容
    await page2.evaluateOnNewDocument(() => {
      window.__TAURI_INTERNALS__ = {
        transformCallback: () => 0,
        invoke: (cmd) => {
          if (typeof cmd === 'string' && cmd.includes('dialog')) return Promise.resolve('/fake/demo.md');
          if (cmd === 'read_text_file') return Promise.resolve('# 根主题\n## 分支 A\n## 分支 B\n');
          return Promise.resolve(null);
        },
      };
    });
    await page2.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await page2.waitForSelector('.toolbar', { timeout: 10000 });
    // 平移视口到别处（模拟导入前视图不在原点）
    await page2.keyboard.down(' ');
    await page2.mouse.move(700, 450);
    await page2.mouse.down();
    await page2.mouse.move(1100, 700, { steps: 5 });
    await page2.mouse.up();
    await page2.keyboard.up(' ');
    await sleep(300);
    // 走真实菜单导入
    await page2.click('.file-menu-trigger');
    await sleep(300);
    await page2.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '导入 Markdown…').click();
    });
    await page2.waitForSelector('[data-node-id="root"]', { timeout: 5000 });
    await sleep(500);
    const labels = await page2.$$eval('[data-node-id]', (els) => els.map((e) => e.textContent));
    assert(labels.some((t) => t.includes('根主题')), '菜单导入后渲染了 Markdown 内容');
    const rootBox = await (await page2.$('[data-node-id="root"]')).boundingBox();
    assert(
      rootBox && rootBox.x > 350 && rootBox.x + rootBox.width < 1050 && rootBox.y > 200 && rootBox.y + rootBox.height < 700,
      `导入后视图自动居中到根节点（root 位于 ${Math.round(rootBox?.x ?? -1)},${Math.round(rootBox?.y ?? -1)}）`
    );
    await page2.close();
  }
} catch (err) {
  failed++;
  console.error('执行异常:', err);
} finally {
  await browser.close();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
