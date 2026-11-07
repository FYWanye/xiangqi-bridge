/**
 * 打包脚本：生成单文件 exe（Node SEA）
 *
 * 产物结构:
 *   dist/XiangqiBridge.exe       ← 主程序（Node SEA 注入，约 90MB）
 *   dist/runtime/                ← playwright 等无法内嵌的依赖
 *   dist/public/                 ← Web GUI 静态资源
 *   dist/README-使用说明.txt
 *
 * 关键设计:
 *   - server.js 与 src/*.js 用 esbuild 打成单个 CJS（SEA 只支持 CJS 入口）
 *   - playwright 标记为 external，运行时从 dist/runtime/node_modules 加载
 *   - 浏览器优先用系统 Chrome/Edge（避免附带 90MB Chromium），
 *     找不到再回退到 playwright 自带 Chromium
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(ROOT, '.build');
const require_ = createRequire(import.meta.url);

const log = (...a) => console.log('[pack]', ...a);

async function rmrf(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

async function main() {
  log('清理旧产物...');
  await rmrf(DIST);
  await rmrf(BUILD);
  await fsp.mkdir(DIST, { recursive: true });
  await fsp.mkdir(BUILD, { recursive: true });

  // ---------- 0. 重新生成 hooks.js（内联注入脚本）----------
  log('生成内联注入脚本...');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-hooks.mjs')], { stdio: 'inherit' });

  // ---------- 1. 打包 JS 成 CJS ----------
  log('打包 JS (esbuild, CJS)...');
  const bundlePath = path.join(BUILD, 'app.cjs');
  await build({
    entryPoints: [path.join(ROOT, 'server.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: bundlePath,
    // playwright 含原生文件，无法内嵌；运行时从 runtime/ 目录加载
    external: ['playwright', 'playwright-core'],
    // 把 __dirname 相关的路径引用保留为运行时解析
    banner: {
      js: [
        '/* XiangqiBridge — bundled by esbuild for Node SEA */',
        'const __importMetaUrl = require("url").pathToFileURL(__filename).href;',
      ].join('\n'),
    },
    logLevel: 'warning',
  });
  const bundleSize = (await fsp.stat(bundlePath)).size;
  log(`  bundle: ${(bundleSize / 1024).toFixed(1)} KB`);

  // ---------- 2. 生成 SEA blob ----------
  log('生成 SEA blob...');
  const seaConfig = {
    main: bundlePath,
    output: path.join(BUILD, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  };
  const seaConfigPath = path.join(BUILD, 'sea-config.json');
  await fsp.writeFile(seaConfigPath, JSON.stringify(seaConfig, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
    stdio: 'inherit',
    cwd: BUILD,
  });

  // ---------- 3. 复制 node 并注入 ----------
  log('注入到 node 二进制...');
  const exePath = path.join(DIST, 'XiangqiBridge.exe');
  await fsp.copyFile(process.execPath, exePath);

  // postject 是官方推荐的注入工具
  const postjectCli = require_.resolve('postject/dist/cli.js');
  execFileSync(process.execPath, [
    postjectCli,
    exePath,
    'NODE_SEA_BLOB',
    path.join(BUILD, 'sea-prep.blob'),
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ], { stdio: 'inherit' });

  // ---------- 4. 复制运行时依赖 ----------
  log('复制运行时依赖 (playwright)...');
  const runtimeDir = path.join(DIST, 'runtime');
  await fsp.mkdir(path.join(runtimeDir, 'node_modules'), { recursive: true });

  for (const mod of ['playwright', 'playwright-core']) {
    const src = path.join(ROOT, 'node_modules', mod);
    const dst = path.join(runtimeDir, 'node_modules', mod);
    if (fs.existsSync(src)) {
      await fsp.cp(src, dst, { recursive: true, dereference: true });
      log(`  + ${mod}`);
    } else {
      log(`  ! 缺少 ${mod}`);
    }
  }
  // playwright 的 package.json type 需要保持一致；补一个最小 package.json
  await fsp.writeFile(
    path.join(runtimeDir, 'package.json'),
    JSON.stringify({ name: 'xiangqi-bridge-runtime', private: true, type: 'commonjs' }, null, 2)
  );

  // ---------- 5. 复制静态资源 ----------
  log('复制 Web GUI 静态资源...');
  await fsp.cp(path.join(ROOT, 'public'), path.join(DIST, 'public'), { recursive: true });

  // ---------- 6. 使用说明 ----------
  await fsp.writeFile(path.join(DIST, '使用说明.txt'), [
    '象棋 AI 桥接控制台',
    '==================',
    '',
    '一、启动',
    '  双击 XiangqiBridge.exe 即可。',
    '  程序会启动本地服务并自动打开浏览器（默认 http://127.0.0.1:3080）。',
    '  保持这个黑色命令行窗口不要关闭 —— 关闭即退出程序。',
    '',
    '二、自定义端口',
    '  在命令行中运行：XiangqiBridge.exe --port 3090 --no-open',
    '',
    '三、浏览器要求',
    '  优先使用系统已安装的 Google Chrome 或 Microsoft Edge（推荐，无需额外下载）。',
    '  若两者都没有，程序会尝试使用 playwright 自带 Chromium；',
    '  此时请先在本目录执行一次：',
    '      runtime\\node_modules\\playwright\\cli.js install chromium',
    '',
    '四、首次使用',
    '  1) 选择「AI 自弈」模式 → 点「启动桥接」，可看 AI 自己跟自己下棋',
    '  2) 想把 AI 用在你的房间：选「加入房间」，填房间号，点「启动桥接」',
    '  3) 只想看推荐着法：选「只分析」',
    '',
    '  首次启动时，xiangqiai.com 需要下载 Pikafish 引擎（约 10~20 秒），请保持网络畅通。',
    '',
    '五、常见问题',
    '  · 打不开页面：检查 3080 端口是否被占用，用 --port 换一个',
    '  · 提示找不到浏览器：安装 Chrome 或 Edge，或执行第三条的命令',
    '  · 分析很慢：属于正常现象，深度越高越慢；可在配置里降低 depth',
    '',
    '六、免责声明',
    '  本工具仅供学习研究，请遵守目标网站的使用条款。',
    '',
  ].join('\r\n'), 'utf8');

  // ---------- 7. 汇总 ----------
  const exeSize = (await fsp.stat(exePath)).size;
  log('');
  log('=== 打包完成 ===');
  log(`  ${path.relative(ROOT, exePath)}  ${(exeSize / 1024 / 1024).toFixed(1)} MB`);
  log(`  dist/runtime/  (playwright)`);
  log(`  dist/public/   (GUI)`);
  log('');
  log('运行: dist/XiangqiBridge.exe');
}

main().catch((e) => {
  console.error('[pack] 失败:', e);
  process.exit(1);
});
