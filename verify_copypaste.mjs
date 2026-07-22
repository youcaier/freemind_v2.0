// 复制/剪切/粘贴 + 撤销重做 自动化自测脚本
// 用法：先 `npm run dev` 启动 Vite（端口 1420），再 `node verify_copypaste.mjs`
// 覆盖：复制粘贴/粘贴后撤销重做/连续多次粘贴/剪切粘贴/跨父级粘贴/剪切撤销恢复/DOM id 唯一性
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

const totalNodes = (page) => page.$$eval('[data-node-id]', (els) => els.length);
const countByLabel = (page, text) =>
  page.$$eval('[data-node-id]', (els, t) => els.filter((e) => e.textContent.trim() === t).length, text);
const nodeExists = (page, id) => page.$(`[data-node-id="${id}"]`).then((h) => h !== null);
// 历史快照污染会导致同一节点 id 在 DOM 中重复出现
const idsUnique = (page) =>
  page.$$eval('[data-node-id]', (els) => {
    const ids = els.map((e) => e.dataset.nodeId);
    return ids.length === new Set(ids).size;
  });

async function clickNode(page, id) {
  const box = await (await page.$(`[data-node-id="${id}"]`)).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(400);
}

// 双击进入编辑并重命名（click 时间戳双击检测）
async function renameNode(page, id, text) {
  const box = await (await page.$(`[data-node-id="${id}"]`)).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await sleep(60);
  await page.mouse.click(cx, cy);
  await page.waitForSelector(`[data-node-id="${id}"] input`, { timeout: 3000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await sleep(300);
}

async function shortcut(page, key) {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
  await sleep(300);
}

async function undo(page) {
  await shortcut(page, 'z');
}

async function redo(page) {
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('z');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(300);
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

  // ---------- 准备：root → 甲(A), 乙(B)；甲 → 甲子(A1) ----------
  console.log('0. 准备结构：root → 甲、乙；甲 → 甲子');
  await page.keyboard.press('Home');
  await sleep(150);
  await page.keyboard.press('Tab');
  await sleep(250);
  await page.keyboard.press('Tab');
  await sleep(250);
  const [a, b] = await page.$$eval('[data-node-id]', (els) => els.map((e) => e.dataset.nodeId).filter((i) => i !== 'root'));
  await clickNode(page, a);
  await page.keyboard.press('Tab');
  await sleep(250);
  const a1 = (await page.$$eval('[data-node-id]', (els) => els.map((e) => e.dataset.nodeId))).find(
    (id) => id !== 'root' && id !== a && id !== b
  );
  await renameNode(page, a, '甲');
  await renameNode(page, b, '乙');
  await renameNode(page, a1, '甲子');
  assert((await totalNodes(page)) === 4, '结构准备完成（4 个节点）');

  // ---------- 1. 复制粘贴（含子树深拷贝） ----------
  console.log('1. 复制 甲 子树，粘贴到 乙 下');
  await clickNode(page, a);
  await shortcut(page, 'c');
  await clickNode(page, b);
  await shortcut(page, 'v');
  assert((await totalNodes(page)) === 6, '粘贴后节点总数 4 -> 6');
  assert((await countByLabel(page, '甲子')) === 2, '子树深拷贝：孙节点 甲子 也被复制');

  // ---------- 2. 粘贴后撤销恢复原状、重做再应用 ----------
  console.log('2. 粘贴后撤销/重做');
  await undo(page);
  assert((await totalNodes(page)) === 4 && (await countByLabel(page, '甲')) === 1, '撤销粘贴恢复原状');
  assert(await idsUnique(page), '撤销后 DOM 节点 id 无重复（历史快照未被污染）');
  await redo(page);
  assert((await totalNodes(page)) === 6 && (await countByLabel(page, '甲子')) === 2, '重做粘贴再次应用');

  // ---------- 3. 连续多次粘贴 ----------
  console.log('3. 连续再粘贴两次到 乙 下');
  await clickNode(page, b);
  await shortcut(page, 'v');
  await shortcut(page, 'v');
  assert((await totalNodes(page)) === 10, '连续粘贴后节点总数 6 -> 10');
  assert((await countByLabel(page, '甲')) === 4 && (await countByLabel(page, '甲子')) === 4, '每次粘贴都生成完整子树副本');
  assert(await idsUnique(page), '连续粘贴后 DOM 节点 id 无重复');
  await undo(page);
  await undo(page);
  assert((await totalNodes(page)) === 6, '撤销两次回到 6 个节点');

  // ---------- 4. 剪切粘贴（跨父级：甲 子树 → 根节点下） ----------
  console.log('4. 剪切原始 甲 子树，粘贴到根节点下（跨父级）');
  await clickNode(page, a);
  await shortcut(page, 'x');
  assert(!(await nodeExists(page, a)) && !(await nodeExists(page, a1)), '剪切后原始 甲/甲子 被移除');
  assert((await totalNodes(page)) === 4, '剪切后节点总数 6 -> 4');
  const clipboardInfo = await page.evaluate(() => document.body.innerText.match(/clipboard: (\d+) nodes/)?.[1]);
  assert(clipboardInfo === '2', '剪贴板中有 2 个节点（甲 + 甲子）');
  await page.keyboard.press('Home'); // 选中根节点
  await sleep(150);
  await shortcut(page, 'v');
  assert((await totalNodes(page)) === 6, '跨父级粘贴到根节点下，总数 4 -> 6');
  assert((await countByLabel(page, '甲')) === 2 && (await countByLabel(page, '甲子')) === 2, '粘贴副本完整（甲 + 甲子）');
  assert(await idsUnique(page), '跨父级粘贴后 DOM 节点 id 无重复');

  // ---------- 5. 撤销剪切+粘贴，逐步恢复 ----------
  console.log('5. 逐步撤销剪切粘贴链路');
  await undo(page); // 撤销粘贴 -> 回到剪切后状态
  assert((await totalNodes(page)) === 4 && (await countByLabel(page, '甲')) === 1, '撤销跨父级粘贴，回到剪切后状态');
  await undo(page); // 撤销剪切 -> 恢复原始 甲 子树
  assert((await nodeExists(page, a)) && (await nodeExists(page, a1)), '撤销剪切，原始 甲/甲子 恢复');
  assert((await totalNodes(page)) === 6, '撤销剪切后节点总数恢复为 6');

  // ---------- 6. 重做剪切+粘贴 ----------
  console.log('6. 逐步重做剪切粘贴链路');
  await redo(page);
  assert(!(await nodeExists(page, a)) && (await totalNodes(page)) === 4, '重做剪切，原始 甲 子树再次移除');
  await redo(page);
  assert((await totalNodes(page)) === 6 && (await countByLabel(page, '甲')) === 2, '重做跨父级粘贴，副本再次应用');
  assert(await idsUnique(page), '重做后 DOM 节点 id 无重复');
} catch (err) {
  failed++;
  console.error('执行异常:', err);
} finally {
  await browser.close();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
