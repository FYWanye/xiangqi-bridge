/**
 * 象棋棋盘/FEN 转换工具
 * 
 * 棋盘坐标系: 9列(file, a-i) × 10行(rank, 0-9)
 * - FEN 格式: "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w"
 * - 位置索引: 0-89 (row * 9 + col)，127 = 不在棋盘上
 * - 棋子ID: 0-15 (0-7=红方, 8-15=黑方)
 */

// pieceList[pieceId] = boardPosition (0-89) or 127 (off-board)
// pieceId 0-15: 0-7 red, 8-15 black

// UCI move format: "b0c2" (from_col+from_row → to_col+to_row)
// moveCord format: [[from_col, from_row], [to_col, to_row]]

/**
 * 将 game.hullqin.cn 的 pieceList 转换为 FEN
 * @param {number[]} pieceList - 16 个棋子的位置数组 (0-89 或 127)
 * @param {number} redId - 红方玩家 ID (0 或 1)
 * @param {number} turnState - 当前回合 (0=等红, 1=等黑)
 * @returns {string} FEN 字符串
 */
export function pieceListToFen(pieceList, redId = 0, turnState = 0) {
  // 棋盘 9x10, 用空格填充
  const board = Array(10).fill(null).map(() => Array(9).fill(null));

  // 棋子ID→FEN字符映射 (每方16子):
  //   id 0-8  = 车马相仕帅仕相马车 → R N B A K A B N R
  //   id 9-10 = 炮炮               → C C
  //   id 11-15= 兵×5              → P P P P P
  const redChars = 'RNBAKABNRCCPPPPP';  // id 0-15 (16 chars)
  const blackChars = 'rnbakabnrccppppp'; // id 16-31

  if (!pieceList || pieceList.length === 0) {
    return 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  }

  for (let id = 0; id < pieceList.length; id++) {
    const pos = pieceList[id];
    if (pos === 127 || pos == null) continue;

    const row = Math.floor(pos / 9);
    const col = pos % 9;
    if (row < 0 || row > 9 || col < 0 || col > 8) continue;

    let char;
    if (id < 16) {
      char = redChars[id] || 'P';
    } else {
      char = blackChars[id - 16] || 'p';
    }
    board[row][col] = char;
  }

  // 构建 FEN (从第 10 行到第 1 行, 即 row 9 → row 0)
  const fenRows = [];
  for (let row = 9; row >= 0; row--) {
    let fenRow = '';
    let empty = 0;
    for (let col = 0; col < 9; col++) {
      if (board[row][col]) {
        if (empty > 0) {
          fenRow += empty;
          empty = 0;
        }
        fenRow += board[row][col];
      } else {
        empty++;
      }
    }
    if (empty > 0) fenRow += empty;
    fenRows.push(fenRow);
  }

  const turn = turnState === 0 ? 'w' : 'b';
  return fenRows.join('/') + ' ' + turn;
}

/**
 * 将 FEN 解析为 pieceList 格式
 * @param {string} fen 
 * @returns {{ pieceList: number[], redId: number, turnState: number }}
 */
export function fenToPieceList(fen) {
  const parts = fen.trim().split(/\s+/);
  const boardPart = parts[0];
  const turn = parts[1] || 'w';
  
  const rows = boardPart.split('/');
  const board = Array(10).fill(null).map(() => Array(9).fill(null));
  
  for (let i = 0; i < rows.length && i < 10; i++) {
    const row = 9 - i; // FEN starts from rank 9 (top)
    let col = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '9') {
        col += parseInt(ch);
      } else if (col < 9) {
        board[row][col] = ch;
        col++;
      }
    }
  }

  // 反向映射: FEN char → pieceId
  const redOrder = 'RNBAKABNRCCPPPPP';  // index = pieceId 0-15 (16 chars)
  const blackOrder = 'rnbakabnrccppppp';
  
  const pieceList = Array(32).fill(127);
  
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const ch = board[row][col];
      if (!ch) continue;
      
      const pos = row * 9 + col;
      const isRed = ch === ch.toUpperCase();
      const upper = ch.toUpperCase();
      
      if (isRed) {
        // 找到第一个空闲的红方位置
        for (let id = 0; id < 16; id++) {
          if (pieceList[id] === 127 && redOrder[id] === upper) {
            pieceList[id] = pos;
            break;
          }
        }
      } else {
        for (let id = 16; id < 32; id++) {
          if (pieceList[id] === 127 && blackOrder[id - 16] === ch) {
            pieceList[id] = pos;
            break;
          }
        }
      }
    }
  }

  return {
    pieceList,
    redId: 0,
    turnState: turn === 'w' ? 0 : 1
  };
}

/**
 * 将 moveCord 转换为 UCI 字符串
 * @param {[[number,number],[number,number]]} moveCord - [[from_col, from_row], [to_col, to_row]]
 * @returns {string} UCI move, e.g., "b0c2"
 */
export function moveCordToUci(moveCord) {
  const [[fromCol, fromRow], [toCol, toRow]] = moveCord;
  const cols = 'abcdefghi';
  return `${cols[fromCol]}${fromRow}${cols[toCol]}${toRow}`;
}

/**
 * 将 UCI 字符串转换为 moveCord
 * @param {string} uci - e.g., "b0c2"
 * @returns {[[number,number],[number,number]]}
 */
export function uciToMoveCord(uci) {
  const cols = 'abcdefghi';
  return [
    [cols.indexOf(uci[0]), parseInt(uci[1])],
    [cols.indexOf(uci[2]), parseInt(uci[3])]
  ];
}

/**
 * 在棋盘上执行走子, 返回新的 pieceList
 */
export function applyMove(pieceList, moveCord) {
  const [[fromCol, fromRow], [toCol, toRow]] = moveCord;
  const fromPos = fromRow * 9 + fromCol;
  const toPos = toRow * 9 + toCol;
  
  const newList = [...pieceList];
  
  // 找到目标位置的棋子(被吃的)
  const capturedId = newList.findIndex((p, i) => p === toPos && i < newList.length);
  if (capturedId !== -1) {
    newList[capturedId] = 127;
  }
  
  // 移动棋子
  const movingId = newList.findIndex((p, i) => p === fromPos && i < newList.length);
  if (movingId !== -1) {
    newList[movingId] = toPos;
  }
  
  return newList;
}

/**
 * 获取棋盘坐标到 SVG 像素坐标的映射
 * SVG viewBox: "-6,-6,92,102", 9列×10行
 */
export function boardPosToSvg(row, col, reverse = false) {
  const svgRow = reverse ? (9 - row) : row;
  const svgCol = reverse ? (8 - col) : col;
  const x = svgCol * 8;  // 每列 8 单位
  const y = svgRow * 9;  // 每行 9 单位
  return { x, y };
}

/**
 * 标准开局 FEN
 */
export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

/**
 * 从棋子索引获取 FEN 字符
 */
export function pieceIdToFenChar(id) {
  const redChars = 'RNBAKABNRCCPPPPP';
  const blackChars = 'rnbakabnrccppppp';
  return id < 16 ? redChars[id] : blackChars[id - 16];
}

/**
 * 中文着法 → UCI 坐标 (完整版, 结合棋盘搜索)
 * @param {string} boardFen - FEN board 部分 (不含回合)
 * @param {string} cn - 中文着法 (如 "炮二平五", "马８进７", "车9平6")
 * @param {boolean} isRed
 * @returns {string|null} UCI 着法
 */
/**
 * 中文着法 → UCI（严格版）
 *
 * 与旧版的关键区别：不再盲目相信调用方传入的 isRed 去"强行解读"着法，
 * 而是分别以「红方视角」和「黑方视角」各解析一次，再用局面做归属校验，
 * 只接受**唯一且合法**的那个解。
 *
 * 这样即使调用方传错 isRed（例如把黑方的「马８进７」当红方读，会错误地
 * 得到 h0g2），也会被归属校验否掉，不会产出伪合法着法。
 *
 * @param {string} boardFen  FEN 棋盘部分（或完整 FEN，函数内部只取棋盘）
 * @param {string} cn        中文着法
 * @param {boolean} [isRed]  期望的走子方（仅作优先提示，非强制）
 * @returns {string|null}
 */
export function cnMoveToUciFull(boardFen, cn, isRed) {
  const fullFen = bySideOf(boardFen, cn);
  return fullFen;
}

/**
 * 内部实现：返回唯一的合法 UCI，或 null
 */
function bySideOf(boardFen, cn) {
  if (!cn || String(cn).length < 4) return null;
  const boardPart = String(boardFen).trim().split(' ')[0];

  const redTry = _parseCnMove(boardPart, cn, true);
  const blackTry = _parseCnMove(boardPart, cn, false);

  const redOk = redTry && _uciBelongsToSide(boardPart, redTry, true) ? redTry : null;
  const blackOk = blackTry && _uciBelongsToSide(boardPart, blackTry, false) ? blackTry : null;

  // 两个视角都成立 → 判为歧义，宁可不走也不走错
  if (redOk && blackOk) return null;
  return redOk || blackOk || null;
}

/** 判断 uci 的起点/终点是否确实由该方棋子构成 */
function _uciBelongsToSide(boardPart, uci, isRed) {
  if (!uci || uci.length < 4) return false;
  const cols = 'abcdefghi';
  const fc = cols.indexOf(uci[0]);
  const fr = parseInt(uci[1], 10);
  const tc = cols.indexOf(uci[2]);
  const tr = parseInt(uci[3], 10);
  if (fc < 0 || tc < 0 || isNaN(fr) || isNaN(tr)) return false;

  const board = fenToBoard(boardPart);
  const piece = board[fr]?.[fc];
  if (!piece) return false;
  const pieceIsRed = piece === piece.toUpperCase();
  if (pieceIsRed !== isRed) return false;

  const target = board[tr]?.[tc];
  if (target && (target === target.toUpperCase()) === isRed) return false; // 不能吃己方
  return true;
}

/**
 * 按指定视角解析中文着法（不做归属校验，由调用方验收）
 */
function _parseCnMove(boardFen, cn, isRed) {
  // 归一化全角数字 １-９ → 1-9
  const normalize = s => s.replace(/[\uFF11-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  const text = normalize(cn);

  const piece = text[0];
  const fromStr = text[1];
  const action = text[2];
  const toStr = text[3];

  // 路数映射 (红方用中文数字, 黑方用阿拉伯数字)
  const redFiles = { '一': 8, '二': 7, '三': 6, '四': 5, '五': 4, '六': 3, '七': 2, '八': 1, '九': 0 };
  const blackFiles = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8 };

  // 严格模式: 红方只认中文数字, 黑方只认阿拉伯数字
  // (不做"另一种映射"的兜底 —— 那正是把黑方着法误读成红方着法的根源)
  const fileMap = isRed ? redFiles : blackFiles;
  const fromCol = fileMap[fromStr];
  if (fromCol === undefined) return null;

  return _cnMoveHelper(boardFen, piece, fromCol, action, toStr, fileMap, isRed);
}

function _cnMoveHelper(boardFen, piece, fromCol, action, toStr, fileMap, isRed) {
  const rows = boardFen.split('/');
  const board = Array(10).fill(null).map(() => Array(9).fill(null));
  for (let i = 0; i < rows.length && i < 10; i++) {
    const row = 9 - i;
    let col = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '9') { col += parseInt(ch); }
      else if (col < 9) { board[row][col] = ch; col++; }
    }
  }

  // 中文棋子名 → FEN 字符
  const cnToFen = {
    '炮': isRed ? 'C' : 'c', '車': isRed ? 'R' : 'r', '车': isRed ? 'R' : 'r',
    '马': isRed ? 'N' : 'n', '馬': isRed ? 'N' : 'n',
    '相': isRed ? 'B' : 'b', '象': isRed ? 'B' : 'b',
    '仕': isRed ? 'A' : 'a', '士': isRed ? 'A' : 'a',
    '兵': isRed ? 'P' : 'p', '卒': isRed ? 'P' : 'p',
    '帅': 'K', '帥': 'K', '将': 'k', '將': 'k'
  };
  const targetFen = cnToFen[piece] || (isRed ? piece.toUpperCase() : piece.toLowerCase());

  // 在 fromCol 列搜索该棋子
  const candidates = [];
  for (let row = 0; row < 10; row++) {
    if (board[row][fromCol] === targetFen) candidates.push(row);
  }
  if (candidates.length === 0) return null;
  const fromRow = candidates[0]; // 简化: 取第一个

  // 计算目标位置
  let toCol, toRow;
  const dir = isRed ? 1 : -1; // 红方向上(row+), 黑方向下(row-)

  // 中文数字 → 数值 (用于直线棋子进退步数)
  const cnNum = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

  // 斜线棋子的行进距离: 马走日=2行, 相/象飞田=2行, 仕/士斜行=1行
  const rowDeltaFor = (pc) => {
    if (pc === '马' || pc === '馬' || pc === 'n' || pc === 'N') return 2;
    if (pc === '相' || pc === '象' || pc === 'b' || pc === 'B') return 2;
    return 1; // 仕/士
  };

  if (action === '平' || action === '=') {
    toCol = fileMap[toStr];
    toRow = fromRow;
    if (toCol === undefined) return null;
  } else if (action === '进' || action === '+') {
    const isStraight = '车車炮兵帅帥将將卒pPrRcCkK'.includes(piece);
    if (isStraight) {
      const stepNum = cnNum[toStr] || parseInt(toStr);
      if (isNaN(stepNum) || stepNum < 1) return null;
      toRow = fromRow + dir * stepNum;
      toCol = fromCol;
    } else {
      toCol = fileMap[toStr];
      if (toCol === undefined) return null;
      toRow = fromRow + dir * rowDeltaFor(piece);
    }
  } else if (action === '退' || action === '-') {
    const rdir = isRed ? -1 : 1;
    const isStraight = '车車炮兵帅帥将將卒pPrRcCkK'.includes(piece);
    if (isStraight) {
      const stepNum = cnNum[toStr] || parseInt(toStr);
      if (isNaN(stepNum) || stepNum < 1) return null;
      toRow = fromRow + rdir * stepNum;
      toCol = fromCol;
    } else {
      toCol = fileMap[toStr];
      if (toCol === undefined) return null;
      toRow = fromRow + rdir * rowDeltaFor(piece);
    }
  } else {
    return null;
  }

  if (toCol < 0 || toCol > 8 || toRow < 0 || toRow > 9) return null;

  const cols = 'abcdefghi';
  return `${cols[fromCol]}${fromRow}${cols[toCol]}${toRow}`;
}

/**
 * FEN 归一化：只保留 棋盘 + 走棋方 两部分，用于严格比较
 * （忽略后半段的 - - 0 1 计数）
 */
export function normalizeFen(fen) {
  if (!fen) return '';
  const parts = String(fen).trim().split(/\s+/);
  return `${parts[0] || ''} ${parts[1] || 'w'}`;
}

/**
 * 两个 FEN 是否表示同一局面（棋盘 + 走棋方都相同）
 */
export function samePosition(a, b) {
  return normalizeFen(a) === normalizeFen(b);
}

/**
 * 解析 FEN 棋盘部分 → board[row][col] 二维数组（null 表示空）
 * row 0 = 红方底线，row 9 = 黑方底线
 */
export function fenToBoard(fen) {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  const rows = String(fen || '').split(' ')[0].split('/');
  for (let i = 0; i < rows.length && i < 10; i++) {
    const row = 9 - i;
    let col = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '9') col += parseInt(ch, 10);
      else if (col < 9) { board[row][col] = ch; col++; }
    }
  }
  return board;
}

/**
 * 校验一个 UCI 着法在给定局面上是否「起步合法」：
 *  - 起点必须有棋子
 *  - 该棋子必须属于当前走棋方
 *  - 终点不能是自己的棋子
 * 这是「防止把上一步的着法/别的局面的着法套到当前局面」的关键防线。
 * 不做完整走法规则校验（如马腿、将军等），仅做归属与占位校验。
 *
 * @throws 不抛异常，返回 { ok:boolean, reason?:string }
 */
export function validateUciMove(fen, uci) {
  if (!uci || uci.length < 4) return { ok: false, reason: 'uci 为空' };
  const cols = 'abcdefghi';
  const fc = cols.indexOf(uci[0]);
  const fr = parseInt(uci[1], 10);
  const tc = cols.indexOf(uci[2]);
  const tr = parseInt(uci[3], 10);
  if (fc < 0 || tc < 0 || isNaN(fr) || isNaN(tr) || fr > 9 || tr > 9) {
    return { ok: false, reason: '坐标越界' };
  }

  const board = fenToBoard(fen);
  const piece = board[fr][fc];
  if (!piece) return { ok: false, reason: `起点为空 (${uci.slice(0, 2)})` };

  const turn = String(fen).trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
  const pieceIsRed = piece === piece.toUpperCase();
  if (turn === 'w' && !pieceIsRed) return { ok: false, reason: '该走红方但起点是黑子' };
  if (turn === 'b' && pieceIsRed) return { ok: false, reason: '该走黑方但起点是红子' };

  const target = board[tr][tc];
  if (target) {
    const targetIsRed = target === target.toUpperCase();
    if (targetIsRed === pieceIsRed) return { ok: false, reason: '终点是己方棋子' };
  }

  return { ok: true };
}

/**
 * 枚举某方所有棋子的所有「貌似可行」落子（不做完整规则，仅供开局/调试统计）
 */
export function listPieceSquares(fen, side) {
  const board = fenToBoard(fen);
  const cols = 'abcdefghi';
  const out = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const p = board[row][col];
      if (!p) continue;
      const isRed = p === p.toUpperCase();
      if ((side === 'red') === isRed) out.push({ piece: p, row, col, sq: `${cols[col]}${row}` });
    }
  }
  return out;
}
