#!/usr/bin/env node
/**
 * 象棋 AI 桥接核心（事件驱动版）
 *
 * 从 game.hullqin.cn/xq/ 读取局面 → xiangqiai.com (Pikafish) 分析 → 自动回写落子。
 * 与 GUI (server.js + public/) 通过事件对接：emit('log'|'status'|'fen'|'analysis'|'move'|'gameover')。
 */

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { cnMoveToUciFull } from './fen-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class GameBridge extends EventEmitter {
  constructor() {
    super();
    this.browser = null;
    this.gamePage = null;
    this.opponentPage = null;
    this.analyzerPage = null;
    this.mySide = null;        // 'red' | 'black'
    this.opponentSide = null;
    this.gameUrl = null;
    this.lastFen = null;
    this.moveCount = 0;
    this.gameOver = false;
    this.running = false;
    this.opts = null;
    this._gameHookInjected = false;
    this._oppHookInjected = false;
    this._stopRequested = false;
    this._fastEngine = false;  // 是否已启用无重载快速分析路径
  }

  log(msg) {
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`;
    this.emit('log', line);
    return line;
  }

  setStatus(state, extra = {}) {
    this.emit('status', { state, ...extra });
  }

  _genRoomId() {
    const letters = 'qwertyupasdfghjkzxcvbnm';
    const rand = (n) => Array.from({ length: n }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    return rand(2) + (Math.random() < 0.5 ? String(Math.floor(Math.random() * 900) + 100) : String(Math.floor(Math.random() * 90) + 10));
  }

  /**
   * 启动桥接
   * @param {object} opts
   *   mode: 'selfplay' (AI 自弈/新房间) | 'join' (加入房间) | 'analyze' (只分析不走棋)
   *   room: 房间号 (join/analyze 时必填)
   *   url: 完整对局 URL (可选, 优先于 room)
   *   side: 'red'|'black' (join 模式可选)
   *   depth: 引擎分析深度 (默认 20；快速路径下为回退深度)
   *   movetime: 引擎每步思考时间毫秒 (默认 800；值越大棋力越强但越慢)
   *   headless: 是否无头 (默认 false, 显示浏览器窗口)
   *   pollMs: 局面轮询间隔 (默认 2000)
   *   analysisTimeout: 单次分析超时 (默认 45000)
   */
  async start(opts = {}) {
    this.opts = {
      mode: opts.mode || 'join',
      room: opts.room || null,
      url: opts.url || null,
      side: opts.side || 'auto',
      depth: opts.depth || 20,
      movetime: parseInt(opts.movetime) || 800,
      headless: !!opts.headless,
      pollMs: opts.pollMs || 2000,
      analysisTimeout: opts.analysisTimeout || 45000,
      auto: opts.auto !== false, // join 模式下是否自动走棋
    };
    this._stopRequested = false;
    this.gameOver = false;
    this.moveCount = 0;
    this.lastFen = null;

    this.log('========================================');
    this.log('  象棋 AI 桥接工具');
    this.log('========================================');
    this.log(`分析引擎: xiangqiai.com (Pikafish)`);
    this.log(`分析深度: ${this.opts.depth}`);
    this.log(`模式: ${this.opts.mode}`);

    this.setStatus('starting');

    try {
      this.log('[启动] 打开浏览器...');
      this.browser = await chromium.launch({
        headless: this.opts.headless,
        slowMo: this.opts.headless ? 0 : 80,
      });

      if (this.opts.mode === 'selfplay') {
        await this._startSelfPlay();
      } else {
        await this._startJoin();
      }

      // 注入游戏钩子
      await this._injectGameHook();

      // 打开分析页面
      this.log('[启动] 打开分析页面...');
      const ctx = await this.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
      this.analyzerPage = await ctx.newPage();
      await this.analyzerPage.addInitScript(() => {
        try {
          const s = JSON.parse(localStorage.getItem('pikafish_settings') || '{}');
          s.ui_settings = s.ui_settings || {};
          s.ui_settings.language = 'zh-CN';
          localStorage.setItem('pikafish_settings', JSON.stringify(s));
        } catch {}
      });
      await this.analyzerPage.goto('https://xiangqiai.com/#/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.analyzerPage.waitForTimeout(5000);
      await this._dismissGuides();

      // 快速路径：注入引擎捕获脚本，绕开页面 UI 直接驱动 UCI（无重载）
      const fastCode = readFileSync(join(__dirname, 'analyzer-hook.js'), 'utf8');
      await this.analyzerPage.evaluate(fastCode);
      // 触发引擎启动：点击「开始分析」让站点加载 WASM（首次仍需下载引擎）
      await this.analyzerPage.evaluate(() => {
        for (const b of document.querySelectorAll('button, [role="button"]')) {
          const t = (b.textContent || '').trim();
          if (t === '开始分析' || t === 'Start analysis') { b.click(); return; }
        }
      });
      // 等待引擎 ready
      const ready = await this.analyzerPage.evaluate(() => window.__XQ_ENGINE__?.waitReady(40000) || false);
      if (ready && await this._probeFastEngine()) {
        this._fastEngine = true;
        this.log('[引擎] ✓ 已启用无重载快速分析路径 (movetime=' + this.opts.movetime + 'ms)');
      } else {
        this._fastEngine = false;
        this.log('[引擎] 快速路径不可用，回退到整页加载分析');
      }

      this.running = true;
      this.log('[启动] 初始化完成!');
      this.setStatus('running', { gameUrl: this.gameUrl });
      this._emitFen();
      return true;
    } catch (e) {
      this.log(`[启动] 失败: ${e.message}`);
      this.setStatus('error', { message: e.message });
      await this.stop();
      return false;
    }
  }

  // ---- 模式 A: 创建新房间 (AI 自弈, 双座位都由 AI 控制) ----
  async _startSelfPlay() {
    const roomId = this._genRoomId();
    this.gameUrl = `https://game.hullqin.cn/xq/${roomId}`;
    this.log(`[新局] 创建房间: ${this.gameUrl}`);

    const ctxA = await this.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
    const ctxB = await this.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });

    this.gamePage = await ctxA.newPage();
    await this.gamePage.goto(this.gameUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.gamePage.waitForTimeout(4000);
    await this.gamePage.evaluate(() => document.getElementById('userseat0')?.querySelector('button')?.click());
    await this.gamePage.waitForTimeout(2500);

    const pageB = await ctxB.newPage();
    await pageB.goto(this.gameUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pageB.waitForTimeout(4000);
    const bJoined = await pageB.evaluate(() => {
      const btn = document.getElementById('userseat1')?.querySelector('button');
      if (btn && btn.textContent.includes('加入')) { btn.click(); return true; }
      return false;
    });
    this.log(`[新局] 第二会话加入座位2: ${bJoined ? '成功' : '失败'}`);
    await pageB.waitForTimeout(2500);

    const canStart = await this.gamePage.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if ((b.textContent || '').trim() === '开始游戏') {
          if (!b.className.includes('cursor-not-allowed')) { b.click(); return true; }
          return false;
        }
      }
      return false;
    });
    if (!canStart) {
      this.log('[新局] ✗ 无法开始游戏 (按钮仍禁用)');
      throw new Error('无法开始游戏');
    }
    this.log('[新局] ✓ 游戏已开始');
    await this.gamePage.waitForTimeout(4000);

    this.opponentPage = pageB;
    this.mySide = 'red';
    this.opponentSide = 'black';
    this.log('[新局] AI 双打模式: 红黑双方都由 AI 控制');
  }

  // ---- 模式 B/C: 加入房间 (或只分析) ----
  async _startJoin() {
    this.gameUrl = this.opts.url || `https://game.hullqin.cn/xq/${this.opts.room}`;
    this.log(`对局地址: ${this.gameUrl}`);

    const ctx = await this.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
    this.gamePage = await ctx.newPage();
    await this.gamePage.goto(this.gameUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.gamePage.waitForTimeout(4000);

    // 尝试加入空闲座位
    const joined = await this.gamePage.evaluate(() => {
      for (let i = 0; i < 2; i++) {
        const seat = document.getElementById('userseat' + i);
        const btn = seat?.querySelector('button');
        if (btn && btn.textContent.includes('加入')) {
          btn.click();
          return i === 0 ? 'red' : 'black';
        }
      }
      return null;
    });
    if (joined) {
      if (this.opts.side !== 'auto' && this.opts.side !== joined) {
        this.mySide = this.opts.side;
      } else {
        this.mySide = joined;
      }
      this.log(`[入座] ✓ 加入座位, 执 ${this.mySide === 'red' ? '红' : '黑'}方`);
      await this.gamePage.waitForTimeout(2500);
    } else {
      this.mySide = this.opts.side !== 'auto' ? this.opts.side : null;
      this.log('[入座] 无空闲座位, 以观战者身份运行');
    }
  }

  // ---- 引导弹窗关闭 ----
  async _dismissGuides() {
    for (let i = 0; i < 4; i++) {
      const dismissed = await this.analyzerPage.evaluate(() => {
        let count = 0;
        const guides = document.querySelectorAll('.first-guide, [class*="first-guide"], [class*="onboarding"]');
        for (const g of guides) {
          let done = false;
          for (const b of g.querySelectorAll('button')) {
            const t = (b.textContent || '').trim();
            if (t === '跳过引导' || t === 'Skip' || t.includes('跳过')) { b.click(); done = true; count++; break; }
          }
          if (done) continue;
          const btns = g.querySelectorAll('button');
          if (btns.length > 0) { btns[btns.length - 1].click(); count++; continue; }
          g.style.display = 'none';
          count++;
        }
        return count;
      });
      if (dismissed > 0) {
        this.log(`[引导] 已关闭 ${dismissed} 个引导弹窗`);
        await this.analyzerPage.waitForTimeout(400);
      } else break;
    }
  }

  // ---- 注入游戏钩子 (读局面 + 落子) ----
  async _injectGameHook() {
    if (this._gameHookInjected) return;
    const hookCode = readFileSync(join(__dirname, 'game-hook.js'), 'utf8');
    await this.gamePage.evaluate(hookCode);
    this._gameHookInjected = true;
    this.log('[游戏钩子] 已注入');
  }

  // ---- 注入引擎钩子 (读分析结果) ----
  async _injectEngineHook() {
    await this.analyzerPage.evaluate(() => {
      if (window.__XQ_ANALYZER_HOOK__) return;
      const hook = {
        bestMove: null, score: null, depth: 0, isAnalyzing: false, infoLines: [],
        init() {
          const origPost = Worker.prototype.postMessage;
          const self = this;
          Worker.prototype.postMessage = function (msg, ...rest) {
            if (msg && typeof msg === 'object' && msg.type === 'command') {
              const cmd = String(msg.command || '');
              if (cmd.startsWith('position ') || cmd.startsWith('go ') || cmd === 'stop' || cmd === 'isready') {
                self.infoLines.push({ dir: '→', cmd, ts: Date.now() });
              }
            }
            return origPost.call(this, msg, ...rest);
          };
          setInterval(() => self._scanDom(), 300);
        },
        _scanDom() {
          try {
            const body = document.body.innerText || '';
            const uciMatches = body.match(/\b([a-i][0-9][a-i][0-9])\b/g);
            if (uciMatches && uciMatches.length > 0) this.bestMove = uciMatches[0];
            const scoreMatch = body.match(/[红黑]分\s*([+-]?\d+(?:\.\d+)?)/);
            if (scoreMatch) this.score = parseFloat(scoreMatch[1]);
            const depthMatch = body.match(/D(\d+)/);
            if (depthMatch) this.depth = parseInt(depthMatch[1]);
            const mateMatch = body.match(/绝杀\s*(\d+)/);
            if (mateMatch) this.score = 99999;
          } catch {}
        },
        getLastResult() {
          return { bestMove: this.bestMove, score: this.score, depth: this.depth, isAnalyzing: this.isAnalyzing };
        },
        reset() { this.bestMove = null; this.score = null; this.depth = 0; }
      };
      hook.init();
      window.__XQ_ANALYZER_HOOK__ = hook;
    });
    this.log('[引擎钩子] 已注入');
  }

  // ---- 读取当前局面 ----
  async getGameFen() {
    if (!this.gamePage) return null;
    return await this.gamePage.evaluate(() => {
      const bridge = window.__XQ_BRIDGE__;
      if (!bridge) return null;
      const fen = bridge.getCurrentFen();
      return fen ? { fen, turn: bridge._extractTurnText?.() || null } : null;
    });
  }

  async getTurnInfo() {
    if (!this.gamePage) return null;
    return await this.gamePage.evaluate(() => window.__XQ_BRIDGE__?._extractTurnText?.() || null);
  }

  _emitFen() {
    if (!this.gamePage) return;
    this.getGameFen().then((info) => {
      if (info?.fen) this.emit('fen', { fen: info.fen, turn: info.turn });
    }).catch(() => {});
  }

  async isMyTurn() {
    const turn = await this.getTurnInfo();
    if (!turn) return false;
    if (this.opts.side === 'red') return turn === '等红方下棋';
    if (this.opts.side === 'black') return turn === '等黑方下棋';
    return await this.gamePage.evaluate((side) => window.__XQ_BRIDGE__?.isMyTurnNow(side) || false, this.mySide);
  }

  // ---- 分析一个局面 ----
  async analyzePosition(fen) {
    this.log(`[分析] 发送局面到分析引擎...`);
    this.emit('fen', { fen });

    // 快速路径：引擎常驻，直接发 UCI，无整页重载
    if (this._fastEngine) {
      try {
        const t0 = Date.now();
        const res = await this.analyzerPage.evaluate(
          (f, mt, dp) => window.__XQ_ENGINE__?.analyze(f, { movetime: mt, depth: dp }) || null,
          fen, this.opts.movetime, this.opts.depth
        );
        const elapsed = Date.now() - t0;
        if (res && res.bestMove) {
          const score = res.mate != null ? `绝杀${res.mate}` : (res.score != null ? res.score : '?');
          this.log(`[分析] ✓ ${res.bestMove} (${score} 分, D${res.depth}, ${elapsed}ms)`);
          const result = {
            bestMove: res.bestMove,
            cnMove: null,
            score: res.mate != null ? 99999 : res.score,
            scoreSide: fen.endsWith(' b') ? '黑' : '红',
            depth: res.depth,
            pv: res.pv || [],
          };
          this.emit('analysis', result);
          return result;
        }
        this.log(`[分析] 快速路径未返回结果 (${elapsed}ms)，回退整页加载`);
      } catch (e) {
        this.log('[分析] 快速路径异常: ' + e.message + '，回退整页加载');
      }
    }

    try {
      await this.analyzerPage.evaluate(() => window.__XQ_ANALYZER_HOOK__?.reset());

      const url = 'https://xiangqiai.com/?t=' + Date.now() + '/#' + encodeURIComponent(fen);
      await this.analyzerPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.analyzerPage.waitForTimeout(4000);
      await this._dismissGuides();

      let clicked = null;
      for (let attempt = 0; attempt < 15 && !clicked; attempt++) {
        await this.analyzerPage.waitForTimeout(1000);
        clicked = await this.analyzerPage.evaluate(() => {
          for (const b of document.querySelectorAll('button, [role="button"]')) {
            const t = (b.textContent || '').trim();
            if (t === '开始分析' || t === 'Start analysis') { b.click(); return t; }
          }
          return null;
        });
      }
      this.log(`[分析] 点击: "${clicked || '(超时未找到)'}"`);
      await this.analyzerPage.waitForTimeout(1000);

      this.log('[分析] 等待分析结果...');
      const result = await this._waitForAnalysisResult(fen);

      if (result && (result.bestMove || result.cnMove)) {
        this.log(`[分析] ✓ 最佳着法: ${result.bestMove || result.cnMove} (${result.scoreSide || ''}分 ${result.score}, D${result.depth})`);
        this.emit('analysis', result);
        return result;
      }
      this.log('[分析] ✗ 未能获取分析结果');
      return null;
    } catch (e) {
      this.log('[分析] 错误: ' + e.message);
      return null;
    }
  }

  // ---- 探测快速分析路径是否可用（用标准开局试跑一步）----
  async _probeFastEngine() {
    try {
      const res = await this.analyzerPage.evaluate(
        () => window.__XQ_ENGINE__?.analyze('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w', { movetime: 300 }) || null
      );
      return !!(res && res.bestMove);
    } catch {
      return false;
    }
  }

  async _waitForAnalysisResult(fen) {
    const timeout = this.opts.analysisTimeout;
    const startTime = Date.now();

    let boardMap = null;
    if (fen) {
      boardMap = {};
      const rows = fen.split(' ')[0].split('/');
      for (let i = 0; i < rows.length && i < 10; i++) {
        const row = 9 - i;
        let col = 0;
        for (const ch of rows[i]) {
          if (ch >= '1' && ch <= '9') col += parseInt(ch);
          else { (boardMap[ch] = boardMap[ch] || []).push([row, col]); col++; }
        }
      }
    }

    while (Date.now() - startTime < timeout) {
      if (this._stopRequested) return null;
      const scan = await this.analyzerPage.evaluate(() => {
        const thinkEl = document.querySelector('.thinking-panel, [class*="thinking-panel"]');
        const text = thinkEl ? thinkEl.innerText : '';
        const blocks = text.split(/(?=[红黑]分\s*[+-]?\d)/).filter(b => /[红黑]分\s*[+-]?\d/.test(b));
        return { count: blocks.length, first: blocks[0] || null };
      });

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed % 5 === 0) {
        this.log(`[分析] ${elapsed}s: 面板块数=${scan.count}`);
      }

      if (scan.count > 0 && scan.first) {
        const latest = scan.first;
        const scoreMatch = latest.match(/([红黑])分\s*([+-]?\d+(?:\.\d+)?)/);
        const depthMatch = latest.match(/\bD(\d+)\b/);
        const pvMatch = latest.match(/[\d.]+[sm]\s*\n\s*\d+[KM]?\s*\n\s*([\u4e00-\u9fff\uFF11-\uFF19][\u4e00-\u9fff\uFF11-\uFF191-9][平进退=+\-][\u4e00-\u9fff\uFF11-\uFF191-9])/)
          || latest.match(/([\u4e00-\u9fff\uFF11-\uFF19][\u4e00-\u9fff\uFF11-\uFF191-9][平进退=+\-][\u4e00-\u9fff\uFF11-\uFF191-9])/);
        const uciMatch = latest.match(/\b([a-i][0-9][a-i][0-9])\b/);

        const result = {
          bestMove: uciMatch ? uciMatch[1] : null,
          cnMove: pvMatch ? (pvMatch[1] || pvMatch[0]) : null,
          score: scoreMatch ? parseFloat(scoreMatch[2]) : null,
          scoreSide: scoreMatch ? scoreMatch[1] : null,
          depth: depthMatch ? parseInt(depthMatch[1]) : null
        };

        if (result.depth === null || result.depth < 10 || result.score === null) {
          await this.analyzerPage.waitForTimeout(1000);
          continue;
        }

        if (boardMap && result.cnMove) {
          const mv = result.cnMove.replace(/[\uFF11-\uFF19]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
          const pieceChar = mv[0];
          const isRedPos = !fen.endsWith(' b');
          const cnToFen = {
            '炮': isRedPos ? 'C' : 'c', '車': isRedPos ? 'R' : 'r', '车': isRedPos ? 'R' : 'r',
            '马': isRedPos ? 'N' : 'n', '馬': isRedPos ? 'N' : 'n',
            '相': isRedPos ? 'B' : 'b', '象': isRedPos ? 'b' : 'B',
            '仕': isRedPos ? 'A' : 'a', '士': isRedPos ? 'A' : 'a',
            '兵': isRedPos ? 'P' : 'p', '卒': isRedPos ? 'p' : 'P',
            '帅': 'K', '帥': 'K', '将': 'k', '將': 'k'
          };
          const fenChar = cnToFen[pieceChar] || pieceChar;
          const positions = boardMap[fenChar] || [];
          if (positions.length === 0) { await this.analyzerPage.waitForTimeout(1000); continue; }
          const redFiles = { '一': 8, '二': 7, '三': 6, '四': 5, '五': 4, '六': 3, '七': 2, '八': 1, '九': 0 };
          const blackFiles = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8 };
          const fileMap = isRedPos ? redFiles : blackFiles;
          const fromCol = fileMap[mv[1]];
          if (fromCol !== undefined && !positions.some(([, c]) => c === fromCol)) {
            await this.analyzerPage.waitForTimeout(1000);
            continue;
          }
        }
        return result;
      }
      await this.analyzerPage.waitForTimeout(1000);
    }
    return null;
  }

  // ---- 执行落子 ----
  async executeMove(uciMove) {
    this.log(`[落子] 执行着法: ${uciMove}`);
    const cols = 'abcdefghi';
    const fromCol = cols.indexOf(uciMove[0]);
    const fromRow = parseInt(uciMove[1]);
    const toCol = cols.indexOf(uciMove[2]);
    const toRow = parseInt(uciMove[3]);

    if ([fromCol, fromRow, toCol, toRow].some(v => isNaN(v)) || fromCol < 0 || toCol < 0) {
      this.log(`[落子] 无效着法: ${uciMove}`);
      return false;
    }

    const ok = await this.gamePage.evaluate(({ fr, fc, tr, tc }) => {
      const bridge = window.__XQ_BRIDGE__;
      if (!bridge) return { success: false, error: 'Bridge not found' };
      return bridge.simulateMove(fr, fc, tr, tc);
    }, { fr: fromRow, fc: fromCol, tr: toRow, tc: toCol });

    if (ok !== false) {
      this.moveCount++;
      this.log(`[落子] ✓ 已执行 (第 ${this.moveCount} 步)`);
      this.emit('move', { uci: uciMove, count: this.moveCount });
      return true;
    }
    return false;
  }

  // ---- 单回合: 检查回合 → 读局面 → 分析 → 落子 ----
  async playOneMove(page, side) {
    if (this._stopRequested) return false;

    const turn = await page.evaluate(() => window.__XQ_BRIDGE__?._extractTurnText?.() || null);
    if (turn && (turn.includes('胜利') || turn.includes('失败') || turn.includes('认输'))) {
      this.log(`[状态] 游戏结束! (${turn})`);
      this.gameOver = true;
      this.setStatus('gameover', { turn });
      this.emit('gameover', { turn });
      return false;
    }
    if (turn && turn.includes('悔棋')) {
      await page.waitForTimeout(3000);
      return false;
    }

    const myTurn = turn === '等你下棋';
    if (!myTurn) return false;

    const fen = await page.evaluate(() => window.__XQ_BRIDGE__?.getCurrentFen());
    if (!fen) return false;
    if (fen === this.lastFen) return false;
    this.lastFen = fen;

    this.log(`\n--- ${side === 'red' ? '红' : '黑'}方回合 ---`);
    this.emit('fen', { fen, side });

    const analysis = await this.analyzePosition(fen);
    if (!analysis) return false;

    let uciMove = analysis.bestMove;
    if (!uciMove && analysis.cnMove) {
      const isRed = !fen.endsWith(' b');
      uciMove = cnMoveToUciFull(fen.split(' ')[0], analysis.cnMove, isRed);
      if (uciMove) this.log(`[分析] "${analysis.cnMove}" → UCI: ${uciMove}`);
    }
    if (!uciMove) return false;

    const cols = 'abcdefghi';
    const fc = cols.indexOf(uciMove[0]), fr = parseInt(uciMove[1]);
    const tc = cols.indexOf(uciMove[2]), tr = parseInt(uciMove[3]);
    const ok = await page.evaluate(({ fr, fc, tr, tc }) => window.__XQ_BRIDGE__?.simulateMove(fr, fc, tr, tc), { fr, fc, tr, tc });
    if (ok !== false) {
      this.moveCount++;
      this.log(`[落子] ✓ ${uciMove} (第 ${this.moveCount} 步)`);
      this.emit('move', { uci: uciMove, count: this.moveCount, side });
      return true;
    }
    return false;
  }

  /**
   * 主循环：依据 mode 持续对弈/监控，直到 stop() 或游戏结束。
   * 返回一个 Promise，调用方 await 它即可阻塞到结束。
   */
  async run() {
    this.log(`[模式] ${this.opts.mode === 'selfplay' ? 'AI 自弈' : this.opts.mode === 'analyze' ? '只分析' : '加入房间自动对弈'}`);

    const aiOpponent = this.opts.mode === 'selfplay' && !!this.opponentPage;
    if (aiOpponent) this.log('[模式] AI 双打: 红黑双方都由 AI 控制');

    // 黑方页首次注入钩子
    if (aiOpponent && !this._oppHookInjected) {
      try {
        await this.opponentPage.evaluate(readFileSync(join(__dirname, 'game-hook.js'), 'utf8'));
        this._oppHookInjected = true;
      } catch {}
    }

    while (!this.gameOver && !this._stopRequested) {
      try {
        let played = false;

        if (this.opts.mode === 'analyze') {
          // 只分析：局面变化时给推荐，不落子
          const info = await this.getGameFen();
          const fen = info?.fen;
          if (fen && fen !== this._analyzeLastFen) {
            this._analyzeLastFen = fen;
            this.emit('fen', { fen, turn: info?.turn });
            await this.analyzePosition(fen);
            played = true;
          }
        } else {
          // 自弈 / 加入房间：红方页走棋
          played = await this.playOneMove(this.gamePage, 'red');
          if (this.gameOver) break;

          if (aiOpponent && this.opponentPage && !this.gameOver && !this._stopRequested) {
            await this.playOneMove(this.opponentPage, 'black');
          }
        }

        if (!played) await this.gamePage.waitForTimeout(this.opts.pollMs);
        else await this.gamePage.waitForTimeout(800);
      } catch (e) {
        if (this._stopRequested) break;
        this.log('[错误] ' + e.message);
        await this.gamePage.waitForTimeout(3000);
      }
    }

    if (!this._stopRequested && this.gameOver) {
      this.log(`\n[结束] 对局完成, 共 ${this.moveCount} 步`);
    }
  }

  // ---- 单步分析（不落子，供 GUI「分析一步」）----
  async analyzeOnce() {
    const info = await this.getGameFen();
    if (!info?.fen) { this.log('[分析] 无法读取局面'); return null; }
    this.emit('fen', { fen: info.fen, turn: info.turn });
    return await this.analyzePosition(info.fen);
  }

  // ---- 停止 ----
  async stop() {
    this._stopRequested = true;
    this.running = false;
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
      this.log('[关闭] 浏览器已关闭');
    }
    this.setStatus('stopped');
  }
}
