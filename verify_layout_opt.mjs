// 布局引擎优化回归自测脚本
// 用法：先 `npm run dev` 启动 Vite（端口 1420），再 `node verify_layout_opt.mjs`
// 覆盖：连续拖拽偏移不重复累加/装饰操作不重排/canvasBounds 纳入偏移/鱼骨图确定性/四种布局基本结构
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

async function nodePos(page, id) {
  return page.$eval(`[data-node-id="${id}"]`, (el) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
  }));
}

async function allPositions(page) {
  return page.$$eval('[data-node-id]', (els) =>
    els.map((el) => ({ id: el.dataset.nodeId, left: parseFloat(el.style.left), top: parseFloat(el.style.top) }))
  );
}

async function dragNode(page, id, dx, dy) {
  const box = await (await page.$(`[data-node-id="${id}"]`)).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
  await page.mouse.up();
  await sleep(300);
}

async function undo(page) {
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(250);
}

// React 受控 select：用原生 setter 改值再派生 change 事件
async function setToolbarSelect(page, markerOptionValue, value) {
  await page.evaluate(([marker, v]) => {
    const sel = [...document.querySelectorAll('.toolbar select')].find((s) =>
      [...s.options].some((o) => o.value === marker)
    );
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, v);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, [markerOptionValue, value]);
  await sleep(300);
}

const changeLayout = (page, v) => setToolbarSelect(page, 'fishbone', v);
const changeConnectionStyle = (page, v) => setToolbarSelect(page, 'orthogonal', v);

async function changeConnectionColor(page, color) {
  await page.evaluate((c) => {
    const input = document.querySelector('.toolbar input[type=color]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, c);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, color);
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

  // ---------- 准备：root + 两个子节点 ----------
  await page.keyboard.press('Home');
  await sleep(150);
  await page.keyboard.press('Tab');
  await sleep(200);
  await page.keyboard.press('Tab');
  await sleep(200);
  const ids = await page.$$eval('[data-node-id]', (els) => els.map((e) => e.dataset.nodeId).filter((i) => i !== 'root'));
  const c1 = ids[0];

  // ---------- 1. 连续多次拖拽同一节点，偏移不重复累加 ----------
  console.log('1. 连续三次拖拽同一节点，最终位置 = 各次增量累加 (+60,+20)');
  const base1 = await nodePos(page, c1);
  await dragNode(page, c1, 30, 10);
  await dragNode(page, c1, 20, -5);
  await dragNode(page, c1, 10, 15);
  const after1 = await nodePos(page, c1);
  assert(
    Math.abs(after1.left - base1.left - 60) < 2 && Math.abs(after1.top - base1.top - 20) < 2,
    `三次拖拽后位置 = 基准 + (60,20)（实际 ${(after1.left - base1.left).toFixed(1)},${(after1.top - base1.top).toFixed(1)}）`
  );
  await undo(page);
  await undo(page);
  await undo(page);
  const undone1 = await nodePos(page, c1);
  assert(
    Math.abs(undone1.left - base1.left) < 2 && Math.abs(undone1.top - base1.top) < 2,
    '三次撤销后回到基准位置'
  );

  // ---------- 2. 装饰性操作（连线样式/颜色）不改变节点位置 ----------
  console.log('2. 拖拽后改连线样式/颜色，节点位置不变');
  await dragNode(page, c1, 80, 40);
  const before2 = await allPositions(page);
  await changeConnectionStyle(page, 'orthogonal');
  await changeConnectionColor(page, '#ff0000');
  await changeConnectionStyle(page, 'bezier');
  const after2 = await allPositions(page);
  const moved = before2.filter((b) => {
    const a = after2.find((p) => p.id === b.id);
    return !a || Math.abs(a.left - b.left) > 0.5 || Math.abs(a.top - b.top) > 0.5;
  });
  assert(moved.length === 0, `连线样式/颜色修改后所有节点位置不变（偏移节点数 ${moved.length}）`);
  assert((await page.$eval('.toolbar input[type=color]', (el) => el.value)) === '#ff0000', '连线颜色修改已生效');

  // ---------- 3. 节点拖出自动布局边界后 canvasBounds 包含新位置 ----------
  console.log('3. 节点向右拖出边界，画布可滚动尺寸随之增大');
  // 画布尺寸 = canvasBounds.maxX + 2000（至少 2000），bounds 不含偏移时拖出会被裁剪。
  // 先缩放到最小 0.2x，2500 画布像素只需 500 屏幕像素（避免鼠标拖出视口）；
  // 从节点左边缘起拖、先小步移动启动拖拽（0.2x 下节点仅 ~21px 宽，大步移动会滑出节点导致拖拽无法启动）
  const innerWidth = () => page.$eval('.canvas-container div[tabindex] > div', (el) => parseFloat(el.style.width));
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.trim() === '-').click());
    await sleep(80);
  }
  const widthBefore = await innerWidth();
  {
    const box = await (await page.$(`[data-node-id="${c1}"]`)).boundingBox();
    const startX = box.x + 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(startX, cy);
    await page.mouse.down();
    await page.mouse.move(startX + 16, cy, { steps: 4 }); // 启动拖拽（16 屏幕 px = 80 画布 px > 阈值）
    await page.mouse.move(startX + 500, cy, { steps: 10 });
    await page.mouse.up();
    await sleep(250);
  }
  const widthAfter = await innerWidth();
  const c1After3 = await nodePos(page, c1);
  assert(
    widthAfter >= c1After3.left + 2000 - 5,
    `canvasBounds 纳入手动偏移（画布宽 ${widthBefore} -> ${widthAfter}，节点右缘 ${(c1After3.left + 104).toFixed(0)} 已被覆盖）`
  );
  await undo(page);
  await page.evaluate(() => [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.trim() === '100%').click());
  await sleep(200);

  // ---------- 4. 鱼骨图布局确定且结构合理 ----------
  console.log('4. 鱼骨图布局：坐标有限、子节点在根右侧、往返切换坐标一致');
  await changeLayout(page, 'fishbone');
  const fish1 = await allPositions(page);
  const rootFish = fish1.find((p) => p.id === 'root');
  const fishFinite = fish1.every((p) => Number.isFinite(p.left) && Number.isFinite(p.top));
  const fishRight = fish1.filter((p) => p.id !== 'root').every((p) => p.left > rootFish.left);
  assert(fishFinite, '鱼骨图坐标均为有限数值');
  assert(fishRight, '鱼骨图子节点均在根节点右侧');
  await changeLayout(page, 'balanced');
  await changeLayout(page, 'fishbone');
  const fish2 = await allPositions(page);
  const fishDiff = fish1.filter((p1) => {
    const p2 = fish2.find((p) => p.id === p1.id);
    return !p2 || Math.abs(p2.left - p1.left) > 0.5 || Math.abs(p2.top - p1.top) > 0.5;
  });
  assert(fishDiff.length === 0, '鱼骨图往返切换后坐标一致（布局确定性）');

  // ---------- 5. 四种布局基本结构不变 ----------
  console.log('5. 四种布局各跑一遍，根节点存在且坐标有限');
  for (const layout of ['balanced', 'org', 'timeline', 'fishbone']) {
    await changeLayout(page, layout);
    const positions = await allPositions(page);
    const root = positions.find((p) => p.id === 'root');
    const finite = positions.every((p) => Number.isFinite(p.left) && Number.isFinite(p.top));
    assert(!!root && finite && positions.length === 3, `布局 ${layout}：结构完整、坐标有限`);
  }
  await changeLayout(page, 'balanced');
} catch (err) {
  failed++;
  console.error('执行异常:', err);
} finally {
  await browser.close();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
