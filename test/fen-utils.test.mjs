/**
 * 象棋桥接工具 - 单元测试
 * 测试 FEN 转换、着法解析等核心功能。
 */
import {
  pieceListToFen,
  fenToPieceList,
  moveCordToUci,
  uciToMoveCord,
  applyMove,
  cnMoveToUciFull,
  validateUciMove,
  normalizeFen,
  samePosition,
  fenToBoard,
  START_FEN,
} from '../src/fen-utils.js';

let passed = 0;
let failed = 0;

function assert(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    console.log(`    实际: ${JSON.stringify(actual)}`);
    console.log(`    期望: ${JSON.stringify(expected)}`);
    failed++;
  }
}

function assertOk(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

console.log('\n=== FEN 转换测试 ===');

// 测试 1: 标准开局 pieceList → FEN
{
  const pieceList = [
    0, 1, 2, 3, 4, 5, 6, 7, 8,       // 红: R N B A K A B N R (row 0)
    19, 25,                           // 红: C C (row 2, cols 1,7)
    27, 29, 31, 33, 35,              // 红: P P P P P (row 3)
    81, 82, 83, 84, 85, 86, 87, 88, 89, // 黑: r n b a k a b n r (row 9)
    64, 70,                           // 黑: c c (row 7, cols 1,7)
    54, 56, 58, 60, 62               // 黑: p p p p p (row 6)
  ];

  const fen = pieceListToFen(pieceList, 0, 0);
  assertOk('开局 pieceList→FEN 非空', fen !== null && fen.length > 0);
  assert('标准开局 FEN', fen, 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w');
}

// 测试 2: FEN → pieceList → FEN 往返
{
  const fen1 = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  const { pieceList } = fenToPieceList(fen1);
  assertOk('FEN→pieceList 得到 32 子', pieceList.length === 32);

  const kingPos = pieceList[4]; // id 4 = K
  assertOk('红帅位置正确', kingPos === 4);

  const blackKingPos = pieceList[20]; // id 16+4 = 20 = k
  assertOk('黑将位置正确', blackKingPos === 85);
}

// 测试 3: UCI 着法转换
{
  assert('UCI b0c2 → moveCord', uciToMoveCord('b0c2'), [[1, 0], [2, 2]]);
  assert('moveCord → UCI', moveCordToUci([[1, 0], [2, 2]]), 'b0c2');
  assert('UCI h2e2 → moveCord', uciToMoveCord('h2e2'), [[7, 2], [4, 2]]);
  assert('UCI a0a1 → moveCord', uciToMoveCord('a0a1'), [[0, 0], [0, 1]]);
}

// 测试 4: 走子执行
{
  const pieceList = [
    0, 1, 2, 3, 4, 5, 6, 7, 8,
    10, 13,
    18, 20, 22, 24, 26,
    81, 82, 83, 84, 85, 86, 87, 88, 89,
    78, 77,
    63, 65, 67, 69, 71
  ];

  const newList = applyMove(pieceList, [[1, 0], [2, 2]]);
  assert('走马后马在新位置', newList[1], 20);
  assert('走马后原位为空', newList.find((p, i) => p === 1), undefined);
}

// 测试 5: 吃子
{
  const pieceList = Array(32).fill(127);
  pieceList[0] = 0;   // 红车 at pos 0
  pieceList[16] = 1;  // 黑车 at pos 1

  const newList = applyMove(pieceList, [[0, 0], [1, 0]]);
  assert('红车移动到目标位', newList[0], 1);
  assert('被吃黑车移除', newList[16], 127);
}

// 测试 6: 开局 FEN 常量
assertOk('START_FEN 存在', typeof START_FEN === 'string' && START_FEN.includes('/'));

// 测试 7: 中文着法到 UCI 的转换 (炮二平五 = h2e2)
{
  const fromCol = 7;
  const toCol = 4;
  const row = 2;
  const uci = moveCordToUci([[fromCol, row], [toCol, row]]);
  assert('炮二平五 → h2e2', uci, 'h2e2');
}

// 测试 8: 中文着法 → UCI (含全角数字)
{
  const board = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';

  const r1 = cnMoveToUciFull(board, '炮二平五', true);
  assert('红: 炮二平五→h2e2', r1, 'h2e2');

  const b1 = cnMoveToUciFull(board, '马８进７', false);
  assert('黑: 马８进７→h9g7', b1, 'h9g7');

  const b2 = cnMoveToUciFull(board, '马8进7', false);
  assert('黑: 马8进7→h9g7', b2, 'h9g7');

  const r2 = cnMoveToUciFull(board, '兵七进一', true);
  assert('红: 兵七进一→c3c4', r2, 'c3c4');
}

// ====== 回归测试: 局面一致性防线 ======
console.log('\n=== 局面校验测试 (防「上一步着法被套用到新局面上」) ===');

// 测试 9: FEN 归一化与相等判断
{
  const a = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  const b = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  const c = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b';
  assert('归一化只保留棋盘+走棋方', normalizeFen(a), 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w');
  assertOk('同局面(计数不同)判等', samePosition(a, b) === true);
  assertOk('走棋方不同判不等', samePosition(a, c) === false);
}

// 测试 10: fenToBoard 行列解析
{
  const board = fenToBoard(START_FEN);
  assert('红帅在 (row0,col4)', board[0][4], 'K');
  assert('黑将在 (row9,col4)', board[9][4], 'k');
  assert('红车在 (row0,col0)', board[0][0], 'R');
  assert('黑炮在 (row7,col1)', board[7][1], 'c');
  assertOk('中心为空', board[5][4] === null);
}

// 测试 11: validateUciMove —— 核心防线
{
  // 开局 (红走)
  const s = START_FEN;
  assertOk('红炮二平五 h2e2 合法', validateUciMove(s, 'h2e2').ok === true);
  // 红方回合却走黑子 → 必须拒绝（这正是"优化失败"的根因场景）
  const badTurn = validateUciMove(s, 'h9g7');
  assertOk('红方回合走黑马 h9g7 被拒', badTurn.ok === false);
  assert('拒绝原因: 起点是黑子', badTurn.reason, '该走红方但起点是黑子');
  // 起点为空
  assertOk('空起点 e5e6 被拒', validateUciMove(s, 'e5e6').ok === false);
  // 终点是己方子
  assertOk('红车吃红马 a0b0 被拒', validateUciMove(s, 'a0b0').ok === false);
  // 坐标越界
  assertOk('越界着法被拒', validateUciMove(s, 'z9z9').ok === false);

  // 黑方回合: 红走 h2e2 必须被拒
  const sBlack = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b';
  const badRed = validateUciMove(sBlack, 'b2e2');
  assertOk('黑方回合走红炮 b2e2 被拒', badRed.ok === false);
  assert('拒绝原因: 该走黑方', badRed.reason, '该走黑方但起点是红子');
  // 黑马 h9g7 合法
  assertOk('黑方回合 h9g7 合法', validateUciMove(sBlack, 'h9g7').ok === true);
}

// 测试 12: 真实失败场景复现（用户日志中的 bug）
{
  // 用户日志: 红方回合，却从面板读到"马８进７"→h9g7，落子后局面错乱
  const redTurnFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  // 1) 中文着法在红方回合转换应失败（红方无 8 路黑马）
  const asRed = cnMoveToUciFull(redTurnFen.split(' ')[0], '马８进７', true);
  assertOk('红方回合无法把黑方着法转成 UCI', asRed === null || !validateUciMove(redTurnFen, asRed).ok);
  // 2) 即便误转成 UCI，归属校验也必须拦下
  assertOk('h9g7 在红方回合被归属校验拦截', validateUciMove(redTurnFen, 'h9g7').ok === false);
}

// 测试 13: 局面变化后的着法失效（分析期间棋盘被改动）
{
  const before = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  const after = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b';
  assertOk('局面已变化被判不等', samePosition(before, after) === false);
  // 在新局面里，原先合法的 h2e2 起点已空
  assertOk('旧着法在新局面被拒', validateUciMove(after, 'h2e2').ok === false);
}

console.log(`\n=== 测试结果: ${passed} 通过, ${failed} 失败 ===`);
process.exit(failed > 0 ? 1 : 0);
