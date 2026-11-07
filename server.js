#!/usr/bin/env node
/**
 * 象棋 AI 桥接控制台 — 本地 Web GUI 服务端
 *
 * 用法:
 *   node server.js [--port 3081] [--no-open]
 *
 * 启动后浏览器访问 http://127.0.0.1:<port> 即可操作。
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { GameBridge } from './src/bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

// ---- 解析命令行 ----
const argv = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = parseInt(getArg('--port', '3081'), 10);
const NO_OPEN = argv.includes('--no-open');

const bridge = new GameBridge();
let runPromise = null;

// ---- SSE 客户端管理 ----
const clients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch {}
  }
}

// 把桥接事件转发给所有 SSE 客户端
['log', 'status', 'fen', 'analysis', 'move', 'gameover'].forEach((ev) => {
  bridge.on(ev, (data) => {
    broadcast(ev, data);
    if (ev === 'log') console.log(data);
  });
});

// ---- HTTP 工具 ----
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---- 路由 ----
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  // SSE 事件流
  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ running: bridge.running })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // ---- API ----
  if (url.pathname.startsWith('/api/')) {
    const method = req.method;

    if (url.pathname === '/api/state' && method === 'GET') {
      return sendJson(res, 200, {
        running: bridge.running,
        gameUrl: bridge.gameUrl,
        moveCount: bridge.moveCount,
        gameOver: bridge.gameOver,
        mySide: bridge.mySide,
      });
    }

    if (url.pathname === '/api/start' && method === 'POST') {
      const body = await readBody(req);
      if (bridge.running) {
        return sendJson(res, 409, { ok: false, error: '桥接已在运行中，请先停止' });
      }
      const opts = {
        mode: body.mode || 'join',
        room: body.room || null,
        url: body.url || null,
        side: body.side || 'auto',
        depth: parseInt(body.depth) || 20,
        headless: !!body.headless,
        pollMs: parseInt(body.pollMs) || 2000,
        analysisTimeout: parseInt(body.analysisTimeout) || 45000,
      };
      if (opts.mode !== 'selfplay' && !opts.url && !opts.room) {
        return sendJson(res, 400, { ok: false, error: '加入/分析模式需要填写房间号或完整 URL' });
      }
      // 后台启动，不阻塞响应
      (async () => {
        const ok = await bridge.start(opts);
        if (ok && bridge.running) {
          runPromise = bridge.run().catch((e) => bridge.log('[运行] 异常: ' + e.message));
          await runPromise;
        }
      })();
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/stop' && method === 'POST') {
      await bridge.stop();
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/analyze' && method === 'POST') {
      if (!bridge.running) return sendJson(res, 409, { ok: false, error: '桥接未运行' });
      const result = await bridge.analyzeOnce();
      return sendJson(res, 200, { ok: true, result });
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  // ---- 静态文件 ----
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(PUBLIC_DIR, pathname);
  // 防止目录穿越
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log('========================================');
  console.log('  象棋 AI 桥接控制台');
  console.log(`  已启动: ${url}`);
  console.log('  Ctrl+C 退出');
  console.log('========================================');
  if (!NO_OPEN) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : (process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`);
    exec(cmd, () => {});
  }
});

process.on('SIGINT', async () => {
  console.log('\n[退出] 正在关闭...');
  await bridge.stop();
  process.exit(0);
});
