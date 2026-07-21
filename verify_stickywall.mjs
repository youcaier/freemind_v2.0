// 节点附属便签功能自动化自测脚本
// 用法：先 `npm run dev` 启动 Vite（端口 1420），再 `node verify_stickywall.mjs`
// 使用 puppeteer-core + 本机 Chrome，覆盖：右键添加/编辑/双击改文/Esc取消/拖拽/换色/删除/撤销重做/删除节点联动
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

async function cardCount(page) {
  return page.$$eval('.sticky-card', (els) => els.length);
}

async function cardTexts(page) {
  return page.$$eval('.sticky-card .sticky-card-text', (els) => els.map((e) => e.textContent.trim()));
}

async function nodeBox(page, nodeId) {
  const handle = await page.$(`[data-node-id="${nodeId}"]`);
  if (!handle) throw new Error(`节点不存在: ${nodeId}`);
  return handle.boundingBox();
}

async function firstCardBox(page) {
  const handle = await page.$('.sticky-card');
  if (!handle) throw new Error('便签不存在');
  return handle.boundingBox();
}

// 右键节点 → 上下文菜单「添加便签」→ 立即进入编辑 → 输入文本 → Enter 提交
async function addCardViaMenu(page, nodeId, text) {
  const box = await nodeBox(page, nodeId);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy, { button: 'right' });
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
  await sleep(150);
}

// 双击便签进入编辑（click 时间戳双击检测，不能用原生 dblclick 语义）
async function doubleClickCard(page) {
  const box = await firstCardBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await sleep(60);
  await page.mouse.click(cx, cy);
  await page.waitForSelector('.sticky-card.editing textarea', { timeout: 3000 });
}

async function undo(page) {
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(150);
}

async function redo(page) {
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('z');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(150);
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

  // ---------- 1. 右键菜单添加便签并立即编辑 ----------
  console.log('1. 右键根节点 → 添加便签 → 输入文字提交');
  await addCardViaMenu(page, 'root', '第一张便签');
  assert((await cardCount(page)) === 1, '便签创建成功');
  assert((await cardTexts(page)).includes('第一张便签'), '便签文本已保存');

  // ---------- 2. 默认位置在节点右侧 ----------
  console.log('2. 便签默认位于节点右侧（右边缘外约 16px）');
  const rootBox = await nodeBox(page, 'root');
  const cardBox = await firstCardBox(page);
  const gapX = cardBox.x - (rootBox.x + rootBox.width);
  assert(Math.abs(gapX - 16) < 4, `便签在节点右侧 16px 处（实际间距 ${gapX.toFixed(1)}px）`);
  const offsetBefore = { dx: cardBox.x - rootBox.x, dy: cardBox.y - rootBox.y };

  // ---------- 2.5 从属连线存在且锚点合理 ----------
  console.log('2.5 便签与所属节点之间绘制从属连线');
  const linkCount = await page.$$eval('.sticky-link', (els) => els.length);
  assert(linkCount === 1, `从属连线已绘制（${linkCount} 条）`);
  const linkGeo = await page.$eval('.sticky-link', (el) => ({
    x1: parseFloat(el.getAttribute('x1')),
    y1: parseFloat(el.getAttribute('y1')),
    x2: parseFloat(el.getAttribute('x2')),
    y2: parseFloat(el.getAttribute('y2')),
    dash: el.getAttribute('stroke-dasharray'),
  }));
  // 便签在节点右侧：连线应大致水平、从节点边缘指向便签边缘
  assert(linkGeo.x2 > linkGeo.x1 && Math.abs(linkGeo.y2 - linkGeo.y1) < 20, '连线端点方向合理（节点 → 便签）');
  assert(linkGeo.dash === '4,4', '连线为虚线样式');

  // ---------- 3. 布局变化后便签跟随节点 ----------
  console.log('3. 添加子节点引起布局重算，便签相对节点偏移不变');
  await page.mouse.click(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
  await sleep(400); // 避开双击判定窗口
  await page.keyboard.press('Tab');
  await sleep(300);
  const childIds = await page.$$eval('[data-node-id]', (els) =>
    els.map((e) => e.dataset.nodeId).filter((id) => id !== 'root')
  );
  assert(childIds.length === 1, '子节点创建成功');
  const rootBox2 = await nodeBox(page, 'root');
  const cardBox2 = await firstCardBox(page);
  const offsetAfter = { dx: cardBox2.x - rootBox2.x, dy: cardBox2.y - rootBox2.y };
  assert(
    Math.abs(offsetAfter.dx - offsetBefore.dx) < 2 && Math.abs(offsetAfter.dy - offsetBefore.dy) < 2,
    `布局重算后偏移不变 (${offsetBefore.dx},${offsetBefore.dy}) -> (${offsetAfter.dx},${offsetAfter.dy})`
  );

  // ---------- 4. 双击便签编辑修改文字 ----------
  console.log('4. 双击便签进入编辑，修改文字后 Enter 提交');
  await doubleClickCard(page);
  await page.keyboard.type('更新后的便签');
  await page.keyboard.press('Enter');
  await sleep(150);
  assert((await cardTexts(page)).includes('更新后的便签'), '双击编辑后文本已更新');

  // ---------- 5. Esc 取消编辑恢复原文本 ----------
  console.log('5. 双击编辑后 Esc 取消，文本不变');
  await sleep(350);
  await doubleClickCard(page);
  await page.keyboard.type('不应保存');
  await page.keyboard.press('Escape');
  await sleep(150);
  assert((await cardTexts(page)).includes('更新后的便签'), 'Esc 取消后文本保持原样');
  assert((await cardCount(page)) === 1, 'Esc 未误删便签');

  // ---------- 6. 拖拽便签改变相对偏移，Ctrl+Z 撤销恢复 ----------
  console.log('6. 拖拽便签移动位置，撤销后恢复');
  const posBefore = await page.$eval('.sticky-card', (el) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
  }));
  const linkBefore = await page.$eval('.sticky-link', (el) => ({
    x2: parseFloat(el.getAttribute('x2')),
    y2: parseFloat(el.getAttribute('y2')),
  }));
  const dragBox = await firstCardBox(page);
  const cx = dragBox.x + dragBox.width / 2;
  const cy = dragBox.y + dragBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 60, { steps: 10 });
  await page.mouse.up();
  await sleep(150);
  const posAfter = await page.$eval('.sticky-card', (el) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
  }));
  assert(
    Math.abs(posAfter.left - posBefore.left - 120) < 5 && Math.abs(posAfter.top - posBefore.top - 60) < 5,
    `拖拽后偏移更新 (${posBefore.left},${posBefore.top}) -> (${posAfter.left},${posAfter.top})`
  );
  const linkAfter = await page.$eval('.sticky-link', (el) => ({
    x2: parseFloat(el.getAttribute('x2')),
    y2: parseFloat(el.getAttribute('y2')),
  }));
  assert(
    Math.abs(linkAfter.x2 - linkBefore.x2 - 120) < 5 && Math.abs(linkAfter.y2 - linkBefore.y2) > 5,
    `从属连线端点随便签拖拽更新 (${linkBefore.x2},${linkBefore.y2}) -> (${linkAfter.x2},${linkAfter.y2})`
  );
  // 拖拽后便签仍在节点右侧：端点应落在便签左边缘上（x 坐标 = 卡片左缘，y 在卡片纵向范围内）
  assert(
    Math.abs(linkAfter.x2 - posAfter.left) < 1 &&
      linkAfter.y2 >= posAfter.top - 1 && linkAfter.y2 <= posAfter.top + 70 + 1,
    '连线端点锚定在便签边缘'
  );
  await undo(page);
  const posUndone = await page.$eval('.sticky-card', (el) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
  }));
  assert(
    Math.abs(posUndone.left - posBefore.left) < 2 && Math.abs(posUndone.top - posBefore.top) < 2,
    'Ctrl+Z 撤销拖拽，位置恢复'
  );

  // ---------- 7. 色块点击循环换色 ----------
  console.log('7. 点击色块循环切换预设色');
  const bgBefore = await page.$eval('.sticky-card', (el) => getComputedStyle(el).backgroundColor);
  await page.$eval('.sticky-card-swatch', (el) => el.click());
  await sleep(150);
  const bgAfter = await page.$eval('.sticky-card', (el) => getComputedStyle(el).backgroundColor);
  assert(bgBefore === 'rgb(255, 249, 196)', `默认色为 #FFF9C4 (${bgBefore})`);
  assert(bgAfter === 'rgb(255, 204, 188)', `点击后切换为 #FFCCBC (${bgAfter})`);

  // ---------- 8. × 按钮删除 + 撤销/重做覆盖便签删除 ----------
  console.log('8. × 按钮删除便签，撤销恢复，重做再删');
  await page.$eval('.sticky-card-close', (el) => el.click());
  await sleep(150);
  assert((await cardCount(page)) === 0, '× 按钮删除便签');
  await undo(page);
  assert((await cardCount(page)) === 1, 'Ctrl+Z 撤销删除，便签恢复');
  assert((await cardTexts(page)).includes('更新后的便签'), '恢复后文本不丢');
  await redo(page);
  assert((await cardCount(page)) === 0, 'Ctrl+Shift+Z 重做删除，便签再次消失');
  await undo(page);
  assert((await cardCount(page)) === 1, '再次撤销，便签恢复（供后续用例使用）');

  // ---------- 9. 删除节点连带删除其便签，撤销一并恢复 ----------
  console.log('9. 删除子节点连带删除附属便签，撤销后一并恢复');
  const childId = childIds[0];
  await addCardViaMenu(page, childId, '子节点便签');
  assert((await cardCount(page)) === 2, '子节点便签创建成功');
  // 右键添加时子节点已被选中，直接 Delete 删除该节点
  await page.keyboard.press('Delete');
  await sleep(200);
  assert((await cardCount(page)) === 1, '删除子节点后其便签一并删除（根节点便签保留）');
  assert((await page.$$eval('.sticky-link', (els) => els.length)) === 1, '被删便签的从属连线一并移除');
  assert((await page.$(`[data-node-id="${childId}"]`)) === null, '子节点已删除');
  await undo(page);
  assert((await cardCount(page)) === 2, '撤销后子节点便签一并恢复');
  assert((await page.$$eval('.sticky-link', (els) => els.length)) === 2, '撤销后从属连线一并恢复');
  assert((await page.$(`[data-node-id="${childId}"]`)) !== null, '撤销后子节点恢复');

  // ---------- 10. 空文本提交即删除 ----------
  console.log('10. 添加便签后直接提交空文本（应被自动删除）');
  const countBefore = await cardCount(page);
  // 用子节点做目标：此时根节点中心被子节点便签覆盖，右键会落在便签上
  await addCardViaMenu(page, childId, '');
  assert((await cardCount(page)) === countBefore, '空文本便签提交后被自动删除');
} catch (err) {
  failed++;
  console.error('执行异常:', err);
} finally {
  await browser.close();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
