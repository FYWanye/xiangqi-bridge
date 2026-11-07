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

console.log(`\n=== 测试结果: ${passed} 通过, ${failed} 失败 ===`);
process.exit(failed > 0 ? 1 : 0);
