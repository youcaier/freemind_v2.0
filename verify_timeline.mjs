// 时间轴布局（三级以上防重叠）自动化自测脚本
// 用法：先 `npm run dev` 启动 Vite（端口 1420），再 `node verify_timeline.mjs`
// 覆盖：四级树任意可见节点包围盒不重叠、深层节点在父级右侧、简单树外观（一级沿 X、根居中、一级在根下方）、往返切换稳定
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

async function clickNode(page, id) {
  const box = await (await page.$(`[data-node-id="${id}"]`)).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(400);
}

async function nodeIds(page) {
  return page.$$eval('[data-node-id]', (els) => els.map((e) => e.dataset.nodeId));
}

async function rects(page) {
  return page.$$eval('[data-node-id]', (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { id: e.dataset.nodeId, x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
    })
  );
}

// 任意两个可见节点的包围盒不重叠（允许 1px 以内的贴边误差）
function findOverlaps(boxes) {
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapW = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (overlapW > 1 && overlapH > 1) {
        overlaps.push(`${a.id} × ${b.id} (${overlapW.toFixed(0)}x${overlapH.toFixed(0)})`);
      }
    }
  }
  return overlaps;
}

async function changeLayout(page, layout) {
  await page.evaluate((v) => {
    const sel = [...document.querySelectorAll('.toolbar select')].find((s) =>
      [...s.options].some((o) => o.value === 'fishbone')
    );
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, v);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, layout);
  await sleep(400);
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

  // ---------- 在平衡布局下构造四级样例树（点击方便），再切到时间轴 ----------
  // root → c1,c2,c3；c1 → g1,g2；g1 → h1,h2；h1 → i1；c2 → g3；g3 → h3
  console.log('0. 构造四级样例树并切换到时间轴布局');
  await page.keyboard.press('Home');
  await sleep(150);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    await sleep(250);
  }
  let ids = await nodeIds(page);
  const [c1, c2] = ids.filter((id) => id !== 'root');
  await clickNode(page, c1);
  await page.keyboard.press('Tab');
  await sleep(250);
  await page.keyboard.press('Tab');
  await sleep(250);
  let after = await nodeIds(page);
  const [g1] = after.filter((id) => !ids.includes(id)); // 新增的两个才是 c1 的子节点
  ids = after;
  await clickNode(page, g1);
  await page.keyboard.press('Tab');
  await sleep(250);
  await page.keyboard.press('Tab');
  await sleep(250);
  after = await nodeIds(page);
  const h1 = after.filter((id) => !ids.includes(id))[0]; // 新增的才是 g1 的子节点
  ids = after;
  await clickNode(page, h1);
  await page.keyboard.press('Tab');
  await sleep(250);
  await clickNode(page, c2);
  await page.keyboard.press('Tab');
  await sleep(250);
  ids = await nodeIds(page);
  const g3 = ids[ids.length - 1];
  await clickNode(page, g3);
  await page.keyboard.press('Tab');
  await sleep(250);

  const totalCount = (await nodeIds(page)).length;
  assert(totalCount === 11, `样例树共 11 个节点（实际 ${totalCount}）`);
  await changeLayout(page, 'timeline');

  // ---------- 1. 核心断言：四级时间轴树任意可见节点包围盒不重叠 ----------
  console.log('1. 时间轴四级树：任意两个可见节点包围盒不重叠');
  const boxes = await rects(page);
  const overlaps = findOverlaps(boxes);
  assert(overlaps.length === 0, `无重叠（发现 ${overlaps.length} 处${overlaps.length ? ': ' + overlaps.slice(0, 3).join('; ') : ''}）`);

  // ---------- 2. 深层节点位置关系：三级节点在二级节点右侧 ----------
  console.log('2. 层级位置关系');
  const g1Box = boxes.find((b) => b.id === g1);
  const h1Box = boxes.find((b) => b.id === h1);
  assert(h1Box.x >= g1Box.right - 1, '三级节点位于其二级父节点右侧');

  // ---------- 3. 简单树外观：一级沿 X 排列、根居中、一级在根下方、二级向下展开 ----------
  console.log('3. 简单树（root → m1,m2；m1 → n1）外观合理');
  await page.keyboard.down('Control');
  await page.keyboard.press('n');
  await page.keyboard.up('Control');
  await sleep(400);
  await page.keyboard.press('Home');
  await sleep(150);
  await page.keyboard.press('Tab');
  await sleep(250);
  await page.keyboard.press('Tab');
  await sleep(250);
  let simpleIds = await nodeIds(page);
  const [m1, m2] = simpleIds.filter((id) => id !== 'root');
  await clickNode(page, m1);
  await page.keyboard.press('Tab');
  await sleep(250);
  simpleIds = await nodeIds(page);
  const n1 = simpleIds.find((id) => !['root', m1, m2].includes(id));
  await changeLayout(page, 'timeline');

  const sBoxes = await rects(page);
  const sRoot = sBoxes.find((b) => b.id === 'root');
  const sm1 = sBoxes.find((b) => b.id === m1);
  const sm2 = sBoxes.find((b) => b.id === m2);
  const sn1 = sBoxes.find((b) => b.id === n1);
  assert(Math.abs(sm1.y - sm2.y) < 1 && sm1.x < sm2.x, '一级节点沿 X 轴同排展开');
  const spanCenter = (Math.min(sm1.x, sm2.x) + Math.max(sm1.right, sm2.right)) / 2;
  assert(Math.abs(sRoot.x + sRoot.w / 2 - spanCenter) < 30, '根节点在一级节点跨度上居中');
  assert(sm1.y >= sRoot.bottom - 1, '一级节点位于根节点下方');
  // 二级节点向下展开（在 m1 中心线及以下）且不越过 m1 上方
  assert(sn1.y >= sm1.y + sm1.h / 2 - 1, '二级节点从父节点中心线向下展开');
  assert(sn1.x >= sm1.right - 1, '二级节点位于父节点右侧');
  assert(findOverlaps(sBoxes).length === 0, '简单树无重叠');

  // ---------- 4. 往返切换布局后时间轴仍稳定 ----------
  console.log('4. 往返切换后仍不重叠');
  await changeLayout(page, 'balanced');
  await changeLayout(page, 'timeline');
  const sBoxes2 = await rects(page);
  assert(findOverlaps(sBoxes2).length === 0, '往返切换后简单树无重叠');
  await changeLayout(page, 'balanced');
} catch (err) {
  failed++;
  console.error('执行异常:', err);
} finally {
  await browser.close();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
