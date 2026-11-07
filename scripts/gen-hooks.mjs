/**
 * 生成 src/hooks.js —— 把 game-hook.js / analyzer-hook.js 的内容内联为字符串常量。
 *
 * 原因：打包成单文件 exe 后，磁盘上不存在这些 .js 文件，运行时无法 readFileSync。
 * 把它们编译进 bundle 是最稳妥的做法。
 *
 * 用法：npm run gen:hooks   （build 前会自动执行）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'src');

function toTemplateLiteral(code) {
  // 转义反引号、反斜杠、${ ，保证放进 JS 模板字符串安全
  return code
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

const game = await fs.readFile(path.join(SRC, 'game-hook.js'), 'utf8');
const analyzer = await fs.readFile(path.join(SRC, 'analyzer-hook.js'), 'utf8');

const out = `/**
 * 自动生成，请勿手动编辑。运行 \`node scripts/gen-hooks.mjs\` 重新生成。
 * 来源: src/game-hook.js, src/analyzer-hook.js
 */

export const GAME_HOOK_SRC = \`${toTemplateLiteral(game)}\`;

export const ANALYZER_HOOK_SRC = \`${toTemplateLiteral(analyzer)}\`;
`;

await fs.writeFile(path.join(SRC, 'hooks.js'), out, 'utf8');
console.log('[gen-hooks] 已生成 src/hooks.js',
  `(game ${(game.length / 1024).toFixed(1)}KB, analyzer ${(analyzer.length / 1024).toFixed(1)}KB)`);
