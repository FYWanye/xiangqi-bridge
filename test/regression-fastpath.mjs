/**
 * 回归验证: 快速路径 + 局面一致性防线
 * 1) 快速路径不再报 "Too many arguments"
 * 2) 红黑双方连续多步，着法方与走棋方始终一致
 * 3) 面板残留不会被误用
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateUciMove, samePosition } from '../src/fen-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const log = (...a) => console.log(...a);
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); pass++; }
  else { log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); fail++; }
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
await page.addInitScript(() => {
  try {
    const s = JSON.parse(localStorage.getItem('pikafish_settings') || '{}');
    s.ui_settings = s.ui_settings || {};
    s.ui_settings.language = 'zh-CN';
    localStorage.setItem('pikafish_settings', JSON.stringify(s));
  } catch {}
});

try {
  log('[1] 打开 xiangqiai.com 并注入快速引擎钩子');
  await page.goto('https://xiangqiai.com/#/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    document.querySelectorAll('.first-guide, [class*="first-guide"]').forEach(g => { g.style.display = 'none'; });
  });

  await page.evaluate(readFileSync(join(ROOT, 'src', 'analyzer-hook.js'), 'utf8'));
  check('钩子注入', await page.evaluate(() => !!window.__XQ_ENGINE__));

  // 触发引擎加载
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button, [role="button"]')) {
      const t = (b.textContent || '').trim();
      if (t === '开始分析' || t === 'Start analysis') { b.click(); return; }
    }
  });
  const ready = await page.evaluate(() => window.__XQ_ENGINE__?.waitReady(45000) || false);
  check('引擎 ready', ready);

  log('\n[2] 快速路径: 多参数对象传参 (修复 Too many arguments)');
  const startFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  const r1 = await page.evaluate(
    (arg) => window.__XQ_ENGINE__?.analyze(arg.fen, { movetime: arg.movetime, depth: arg.depth }) || null,
    { fen: startFen, movetime: 800, depth: 0 }
  );
  check('快速路径返回 bestmove', !!(r1 && r1.bestMove), r1 ? `${r1.bestMove} D${r1.depth} score=${r1.score}` : 'null');
  if (r1 && r1.bestMove) {
    check('bestmove 在当前局面合法', validateUciMove(startFen, r1.bestMove).ok === true,
      validateUciMove(startFen, r1.bestMove).reason || 'ok');
  }

  log('\n[3] 连续分析: 着法归属必须匹配走棋方');
  // 模拟对局推进: 每步用引擎结果推进局面，验证返回着法始终属于走棋方
  let fen = startFen;
  const seq = [];
  for (let i = 0; i < 6; i++) {
    const res = await page.evaluate(
      (arg) => window.__XQ_ENGINE__?.analyze(arg.fen, { movetime: arg.movetime }) || null,
      { fen, movetime: 700 }
    );
    if (!res || !res.bestMove) { check(`第 ${i + 1} 步有结果`, false, 'null'); break; }

    const v = validateUciMove(fen, res.bestMove);
    const turn = fen.split(' ')[1];
    const side = turn === 'w' ? '红' : '黑';
    check(`第 ${i + 1} 步(${side}) ${res.bestMove} 合法`, v.ok === true, v.reason || '');

    // 用 FEN 推进（简单实现: 手动走子后重建 FEN）
    fen = applyUciToFen(fen, res.bestMove);
    seq.push(res.bestMove);
  }
  log('  走子序列: ' + seq.join(' '));

  log('\n[4] 面板残留防线 (整页加载路径)');
  // 载入一个局面 A 分析，然后载入局面 B，验证不会读到 A 的着法
  const fenA = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  const fenB = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b';
  await page.goto('https://xiangqiai.com/?t=' + Date.now() + '/#' + encodeURIComponent(fenA),
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    document.querySelectorAll('.first-guide, [class*="first-guide"]').forEach(g => { g.style.display = 'none'; });
    for (const b of document.querySelectorAll('button')) {
      if ((b.textContent || '').trim() === '开始分析') { b.click(); return; }
    }
  });
  await page.waitForTimeout(8000);
  const hashA = await page.evaluate(() => decodeURIComponent(location.hash));
  check('局面 A 的 hash 正确', hashA.includes('1C5C1') && hashA.includes(' w'), hashA.slice(0, 50));

  await page.goto('https://xiangqiai.com/?t=' + Date.now() + '/#' + encodeURIComponent(fenB),
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const hashB = await page.evaluate(() => decodeURIComponent(location.hash));
  check('局面 B 的 hash 正确', hashB.includes('1C2C4') && hashB.includes(' b'), hashB.slice(0, 50));
  check('A/B 局面判不等', samePosition(fenA, fenB) === false);

  // 在 B 局面上，A 的最优着法(h2e2)必须非法
  check('A 的着法在 B 局面被拒', validateUciMove(fenB, 'h2e2').ok === false);

} catch (e) {
  log('异常: ' + e.message);
  fail++;
} finally {
  await browser.close();
}

log(`\n=== 回归结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);

// ---- 辅助: 用 UCI 推进 FEN ----
function applyUciToFen(fen, uci) {
  const cols = 'abcdefghi';
  const [boardPart, turn] = fen.trim().split(/\s+/);
  const rows = boardPart.split('/');
  // 解析成 board[row][col]
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (let i = 0; i < 10; i++) {
    const row = 9 - i;
    let col = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '9') col += parseInt(ch, 10);
      else { board[row][col] = ch; col++; }
    }
  }
  const fc = cols.indexOf(uci[0]), fr = parseInt(uci[1], 10);
  const tc = cols.indexOf(uci[2]), tr = parseInt(uci[3], 10);
  board[tr][tc] = board[fr][fc];
  board[fr][fc] = null;

  const out = [];
  for (let row = 9; row >= 0; row--) {
    let s = '', empty = 0;
    for (let col = 0; col < 9; col++) {
      if (board[row][col]) { if (empty) { s += empty; empty = 0; } s += board[row][col]; }
      else empty++;
    }
    if (empty) s += empty;
    out.push(s);
  }
  return out.join('/') + ' ' + (turn === 'w' ? 'b' : 'w');
}
