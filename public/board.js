/**
 * 象棋棋盘渲染器 — 从 FEN 生成 SVG 棋盘
 * 标准朝向：红方在下，黑方在上。
 */

// FEN 字符 → 中文棋子 + 颜色
const PIECE = {
  K: { c: '帥', red: true },  A: { c: '仕', red: true },  B: { c: '相', red: true },
  N: { c: '馬', red: true },  R: { c: '車', red: true },  C: { c: '炮', red: true },
  P: { c: '兵', red: true },
  k: { c: '將', red: false }, a: { c: '士', red: false }, b: { c: '象', red: false },
  n: { c: '馬', red: false }, r: { c: '車', red: false }, c: { c: '砲', red: false },
  p: { c: '卒', red: false },
};

const STEP = 60;
const PAD = 40;
const W = PAD * 2 + STEP * 8;   // 9 个点, 8 段
const H = PAD * 2 + STEP * 9;   // 10 个点, 9 段

export function parseFen(fen) {
  const parts = fen.trim().split(/\s+/);
  const board = [];
  const rows = parts[0].split('/');
  for (let i = 0; i < rows.length && i < 10; i++) {
    const row = 9 - i; // FEN 第一行是 rank 9 (顶部)
    let col = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '9') { col += parseInt(ch, 10); }
      else if (col < 9) { board.push({ row, col, ch }); col++; }
    }
  }
  return { board, turn: parts[1] || 'w' };
}

// 点坐标 (col, row) → SVG (x, y)，row 0 = 顶部(黑方)
function pt(col, row) {
  return { x: PAD + col * STEP, y: PAD + row * STEP };
}

export function renderBoard(fen, opts = {}) {
  const { board } = parseFen(fen);
  const lastMove = opts.lastMove || null; // {from:[col,row], to:[col,row]} 或 null
  const hint = opts.hint || null;         // UCI 如 'h2e2'

  // 解析 lastMove / hint 成高亮坐标
  let from = null, to = null;
  if (lastMove) { from = lastMove.from; to = lastMove.to; }
  else if (hint) {
    const cols = 'abcdefghi';
    from = [cols.indexOf(hint[0]), parseInt(hint[1], 10)];
    to = [cols.indexOf(hint[2]), parseInt(hint[3], 10)];
  }

  const els = [];

  // 背景
  els.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="#FFFFFF"/>`);

  // 网格线
  els.push(`<g stroke="#0F172A" stroke-width="1.6" opacity="0.9">`);
  // 横线 (10 行)
  for (let r = 0; r < 10; r++) {
    const a = pt(0, r), b = pt(8, r);
    els.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
  }
  // 竖线 (9 列), 两侧贯通, 中间 1/7 路在楚河汉界断开
  for (let c = 0; c < 9; c++) {
    if (c === 0 || c === 8) {
      const a = pt(c, 0), b = pt(c, 9);
      els.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
    } else {
      const top = pt(c, 0), midTop = pt(c, 4);
      const midBot = pt(c, 5), bot = pt(c, 9);
      els.push(`<line x1="${top.x}" y1="${top.y}" x2="${midTop.x}" y2="${midTop.y}"/>`);
      els.push(`<line x1="${midBot.x}" y1="${midBot.y}" x2="${bot.x}" y2="${bot.y}"/>`);
    }
  }
  els.push(`</g>`);

  // 九宫斜线 (双方)
  els.push(`<g stroke="#0F172A" stroke-width="1.4" opacity="0.9">`);
  // 黑方九宫 (顶部 rows 0-2, cols 3-5)
  const bl = pt(3, 0), tr = pt(5, 2);
  els.push(`<line x1="${bl.x}" y1="${bl.y}" x2="${tr.x}" y2="${tr.y}"/>`);
  const br = pt(5, 0), tl = pt(3, 2);
  els.push(`<line x1="${br.x}" y1="${br.y}" x2="${tl.x}" y2="${tl.y}"/>`);
  // 红方九宫 (底部 rows 7-9, cols 3-5)
  const rbl = pt(3, 9), rtr = pt(5, 7);
  els.push(`<line x1="${rbl.x}" y1="${rbl.y}" x2="${rtr.x}" y2="${rtr.y}"/>`);
  const rbr = pt(5, 9), rtl = pt(3, 7);
  els.push(`<line x1="${rbr.x}" y1="${rbr.y}" x2="${rtl.x}" y2="${rtl.y}"/>`);
  els.push(`</g>`);

  // 楚河汉界
  const riverY = PAD + 4.5 * STEP;
  els.push(`<text x="${PAD + 4 * STEP}" y="${riverY}" text-anchor="middle" dominant-baseline="middle" font-size="22" fill="#64748B" font-family="KaiTi, STKaiti, 'Noto Serif SC', serif">楚 河</text>`);
  els.push(`<text x="${PAD + 4 * STEP}" y="${riverY}" text-anchor="middle" dominant-baseline="middle" font-size="22" fill="#64748B" font-family="KaiTi, STKaiti, 'Noto Serif SC', serif" transform="rotate(180 ${PAD + 4 * STEP} ${riverY})">漢 界</text>`);

  // 走子高亮 (起始/目标)
  if (from && to) {
    const fc = pt(from[0], from[1]), tc = pt(to[0], to[1]);
    const mk = (x, y) => `<rect x="${x - STEP * 0.44}" y="${y - STEP * 0.44}" width="${STEP * 0.88}" height="${STEP * 0.88}" rx="10" fill="#3B82F6" opacity="0.16"/>`;
    els.push(mk(fc.x, fc.y));
    els.push(mk(tc.x, tc.y));
  }

  // 棋子
  for (const p of board) {
    const meta = PIECE[p.ch];
    if (!meta) continue;
    const { x, y } = pt(p.col, p.row);
    const fill = meta.red ? '#F8FAFC' : '#F8FAFC';
    const stroke = meta.red ? '#0F172A' : '#0F172A';
    const textFill = meta.red ? '#B91C1C' : '#0F172A'; // 红方红字, 黑方黑字
    const r = STEP * 0.42;
    els.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
    els.push(`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(STEP * 0.5)}" font-weight="600" fill="${textFill}" font-family="KaiTi, STKaiti, 'Noto Serif SC', serif">${meta.c}</text>`);
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="象棋棋盘">${els.join('')}</svg>`;
}
