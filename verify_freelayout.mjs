// 节点自由拖拽布局自动化自测脚本
// 用法：先 `npm run dev` 启动 Vite（端口 1420），再 `node verify_freelayout.mjs`
// 覆盖：自由拖拽/子树跟随/连线与便签跟随/撤销重做/重排后偏移保留/复位/根节点可拖/缩放下拖拽增量
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

// 节点画布坐标（style left/top，不受缩放平移影响）
async function nodePos(page, id) {
  return page.$eval(`[data-node-id="${id}"]`, (el) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
  }));
}

async function cardPos(page) {
  return page.$eval('.sticky-card', (el) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
  }));
}

async function linkEnd(page) {
  return page.$eval('.sticky-link', (el) => ({
    x2: parseFloat(el.getAttribute('x2')),
    y2: parseFloat(el.getAttribute('y2')),
  }));
}

async function nodeIds(page) {
  return page.$$eval('[data-node-id]', (els) => els.map((e) => e.dataset.nodeId));
}

// 在节点矩形内找一个未被便签遮挡的抓取点（子节点便签可能覆盖父节点中心）
async function grabPoint(page, id) {
  const box = await (await page.$(`[data-node-id="${id}"]`)).boundingBox();
  const candidates = [
    [0.5, 0.5], [0.9, 0.5], [0.1, 0.5], [0.5, 0.9], [0.5, 0.1],
    [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.1, 0.1],
  ];
  for (const [fx, fy] of candidates) {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    const hit = await page.evaluate((px, py) => {
      const el = document.elementFromPoint(px, py);
      return el?.closest('[data-node-id]')?.dataset.nodeId ?? null;
    }, x, y);
    if (hit === id) return { x, y };
  }
  throw new Error(`节点 ${id} 被遮挡，无法抓取`);
}

// 拖拽节点（屏幕坐标增量 dx/dy）
async function dragNode(page, id, dx, dy) {
  const { x, y } = await grabPoint(page, id);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
  await sleep(200);
}

async function clickToolbarButton(page, text) {
  const found = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.trim() === t);
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
  if (!found) throw new Error(`工具栏按钮不存在: ${text}`);
  await sleep(200);
}

async function undo(page) {
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(200);
}

async function redo(page) {
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('z');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(200);
}

// 右键节点 → 上下文菜单「添加便签」→ 输入文本 → Enter 提交
async function addCardViaMenu(page, nodeId, text) {
  const handle = await page.$(`[data-node-id="${nodeId}"]`);
  const box = await handle.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '添加便签'),
    { timeout: 3000 }
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '添加便签').click();
  });
  await page.waitForSelector('.sticky-card.editing textarea', { timeout: 3000 });
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await sleep(200);
}

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

  // ---------- 准备结构：root → c1(→gc), c2；c1 上挂一张便签 ----------
  console.log('0. 准备导图结构（两个子节点 + 一个孙节点 + 一张便签）');
  await page.keyboard.press('Home'); // 选中根节点
  await sleep(150);
  await page.keyboard.press('Tab');
  await sleep(200);
  await page.keyboard.press('Tab');
  await sleep(200);
  let ids = await nodeIds(page);
  const [c1, c2] = ids.filter((id) => id !== 'root');
  // 选中 c1，加孙节点
  const c1Box = await (await page.$(`[data-node-id="${c1}"]`)).boundingBox();
  await page.mouse.click(c1Box.x + c1Box.width / 2, c1Box.y + c1Box.height / 2);
  await sleep(400);
  await page.keyboard.press('Tab');
  await sleep(200);
  ids = await nodeIds(page);
  const gc = ids.find((id) => id !== 'root' && id !== c1 && id !== c2);
  await addCardViaMenu(page, c1, '便签A');
  assert((await page.$$eval('.sticky-card', (els) => els.length)) === 1, '便签创建成功');
  const base = {
    c1: await nodePos(page, c1),
    c2: await nodePos(page, c2),
    gc: await nodePos(page, gc),
    card: await cardPos(page),
  };

  // ---------- 1. 自由拖拽改变节点位置 ----------
  console.log('1. 拖拽子节点自由移动，松手后位置保持');
  await dragNode(page, c2, 100, 50);
  const c2After = await nodePos(page, c2);
  const c1After1 = await nodePos(page, c1);
  assert(
    Math.abs(c2After.left - base.c2.left - 100) < 2 && Math.abs(c2After.top - base.c2.top - 50) < 2,
    `被拖节点位置更新 (${base.c2.left},${base.c2.top}) -> (${c2After.left},${c2After.top})`
  );
  assert(
    Math.abs(c1After1.left - base.c1.left) < 1 && Math.abs(c1After1.top - base.c1.top) < 1,
    '未拖拽的兄弟节点位置不变'
  );

  // ---------- 2. 拖动父节点，子树/便签/连线一起跟随 ----------
  console.log('2. 拖动父节点，孙节点、便签、从属连线一起移动');
  await dragNode(page, c1, 60, 30);
  const [c1After2, gcAfter2, cardAfter2, linkAfter2] = await Promise.all([
    nodePos(page, c1), nodePos(page, gc), cardPos(page), linkEnd(page),
  ]);
  assert(
    Math.abs(gcAfter2.left - base.gc.left - 60) < 2 && Math.abs(gcAfter2.top - base.gc.top - 30) < 2,
    '孙节点跟随父节点移动'
  );
  assert(
    Math.abs(cardAfter2.left - base.card.left - 60) < 2 && Math.abs(cardAfter2.top - base.card.top - 30) < 2,
    '便签跟随所属节点移动'
  );
  assert(Math.abs(linkAfter2.x2 - (cardAfter2.left)) < 2, '从属连线端点锚定在移动后的便签边缘');

  // ---------- 3. 撤销/重做恢复位置 ----------
  console.log('3. 撤销/重做恢复拖拽');
  await undo(page);
  const c1Undo = await nodePos(page, c1);
  assert(
    Math.abs(c1Undo.left - base.c1.left) < 2 && Math.abs(c1Undo.top - base.c1.top) < 2,
    'Ctrl+Z 撤销拖拽，位置恢复'
  );
  await redo(page);
  const c1Redo = await nodePos(page, c1);
  assert(
    Math.abs(c1Redo.left - base.c1.left - 60) < 2 && Math.abs(c1Redo.top - base.c1.top - 30) < 2,
    'Ctrl+Shift+Z 重做拖拽，位置再次应用'
  );

  // ---------- 4. 根节点可拖动，整棵树跟随 ----------
  console.log('4. 拖拽根节点，所有节点和便签一起移动');
  const before4 = {
    c1: await nodePos(page, c1),
    c2: await nodePos(page, c2),
    gc: await nodePos(page, gc),
    card: await cardPos(page),
  };
  await dragNode(page, 'root', 40, 20);
  const after4 = {
    c1: await nodePos(page, c1),
    c2: await nodePos(page, c2),
    gc: await nodePos(page, gc),
    card: await cardPos(page),
  };
  const allFollowed = ['c1', 'c2', 'gc', 'card'].every(
    (k) => Math.abs(after4[k].left - before4[k].left - 40) < 2 && Math.abs(after4[k].top - before4[k].top - 20) < 2
  );
  assert(allFollowed, '根节点可拖动，子树与便签全部跟随');

  // ---------- 5. 新增节点触发重排后，手动偏移保留 ----------
  console.log('5. 新增节点重排后偏移保留');
  // 新增左侧子节点会让根节点纵向居中位置变化，c2 的绝对 y 随之平移；
  // 因此断言 c2 相对根节点的位移不变（该位移 = 基准差 + 手动偏移，偏移丢失会立刻暴露）
  const rootBefore5 = await nodePos(page, 'root');
  const diffBefore5 = { dx: after4.c2.left - rootBefore5.left, dy: after4.c2.top - rootBefore5.top };
  await page.keyboard.press('Home'); // 选中根节点
  await sleep(150);
  await page.keyboard.press('Tab');
  await sleep(250);
  const [c2After5, rootAfter5] = await Promise.all([nodePos(page, c2), nodePos(page, 'root')]);
  const diffAfter5 = { dx: c2After5.left - rootAfter5.left, dy: c2After5.top - rootAfter5.top };
  assert(
    Math.abs(diffAfter5.dx - diffBefore5.dx) < 1 && Math.abs(diffAfter5.dy - diffBefore5.dy) < 1,
    `新增节点重排后，手动偏移未丢失（c2 相对根节点位移 ${diffBefore5.dx},${diffBefore5.dy} -> ${diffAfter5.dx},${diffAfter5.dy}）`
  );

  // ---------- 6. 「复位」清空偏移 ----------
  console.log('6. 复位按钮清空偏移');
  const c1Before6 = await nodePos(page, c1);
  const rootBefore6 = await nodePos(page, 'root');
  await clickToolbarButton(page, '复位');
  const [rootAfter6, c1After6, c2After6] = await Promise.all([nodePos(page, 'root'), nodePos(page, c1), nodePos(page, c2)]);
  assert(
    Math.abs(rootAfter6.left - rootBefore6.left + 40) < 2 && Math.abs(rootAfter6.top - rootBefore6.top + 20) < 2,
    '复位后根节点偏移清零（回退 40,20）'
  );
  // 复位消去的是各自的手动偏移（c1: +60/+30，c2: +100/+50），节点间相对差随之回退
  assert(
    Math.abs(c1After6.left - rootAfter6.left - (c1Before6.left - rootBefore6.left) + 60) < 2,
    '复位后 c1 相对根节点的横向位移回退手动偏移量'
  );
  assert(
    Math.abs(c2After6.left - rootAfter6.left - (c2After5.left - rootBefore6.left) + 100) < 2,
    '复位后 c2 相对根节点的横向位移回退手动偏移量'
  );
  // 复位可撤销
  await undo(page);
  const rootUndo6 = await nodePos(page, 'root');
  assert(Math.abs(rootUndo6.left - rootBefore6.left) < 2, '撤销复位，偏移恢复');
  await clickToolbarButton(page, '复位'); // 再次复位，为缩放测试回到纯自动布局
  await sleep(100);

  // ---------- 7. 缩放下拖拽增量正确（屏幕增量 ÷ scale） ----------
  console.log('7. 缩放 1.1x 下拖拽，画布坐标增量 = 屏幕增量 / 1.1');
  await clickToolbarButton(page, '+');
  const c1Before7 = await nodePos(page, c1);
  await dragNode(page, c1, 55, 0); // 屏幕 +55px ≈ 画布 +50px
  const c1After7 = await nodePos(page, c1);
  assert(
    Math.abs(c1After7.left - c1Before7.left - 50) < 3 && Math.abs(c1After7.top - c1Before7.top) < 3,
    `缩放下拖拽增量正确（画布位移 ${(c1After7.left - c1Before7.left).toFixed(1)}px，期望 ≈50）`
  );
  await clickToolbarButton(page, '100%');
  await undo(page); // 清掉缩放测试产生的偏移
} catch (err) {
  failed++;
  console.error('执行异常:', err);
} finally {
  await browser.close();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
