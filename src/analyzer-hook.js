/**
 * xiangqiai.com 注入脚本 — 捕获引擎 Worker，直接驱动 UCI（无重载快速分析）
 *
 * 原理：站点的 Pikafish WASM 引擎通过一个 Web Worker 中继收发标准 UCI：
 *   发：worker.postMessage({type:"command", command:"position fen …" / "go movetime N"})
 *   收：worker 的 message 事件 {type:"stdout", line:"info …" / "bestmove h2e2"}
 * 该中继是无状态的管道，因此可以绕过页面 UI，直接向引擎发命令并读取 bestmove，
 * 从而避免「每一步整页重载 + 重新编译 WASM」的巨大开销。
 *
 * 暴露 window.__XQ_ENGINE__ = { analyze(fen, {movetime, depth}), waitReady(), destroy() }
 */
if (window.__XQ_ENGINE__) {
  try { window.__XQ_ENGINE__.destroy(); } catch {}
}

(function () {
  const engine = {
    worker: null,     // 捕获到的引擎 Worker
    ready: false,     // 已观察到 readyok
    pending: null,    // 当前等待的 bestmove 解析器
    _gen: 0,
    lastInfo: { score: null, mate: null, depth: 0, pv: [] },

    // 给 worker 挂一次性 message 监听（幂等）
    _ensureListener(w) {
      if (w.__xq_listener__) return;
      w.__xq_listener__ = true;
      const self = this;
      w.addEventListener('message', (e) => self._onMsg(e.data));
    },

    _onMsg(data) {
      if (!data || typeof data !== 'object' || data.type !== 'stdout') return;
      this._onLine(data.line || '');
    },

    _onLine(line) {
      if (line === 'readyok') { this.ready = true; return; }

      if (line.startsWith('info ')) {
        const dm = /\bdepth\s+(\d+)/.exec(line);
        if (dm) this.lastInfo.depth = parseInt(dm[1], 10);
        const cp = /\bscore\s+cp\s+(-?\d+)/.exec(line);
        const mate = /\bscore\s+mate\s+(-?\d+)/.exec(line);
        if (cp) { this.lastInfo.score = parseInt(cp[1], 10); this.lastInfo.mate = null; }
        else if (mate) { this.lastInfo.mate = parseInt(mate[1], 10); this.lastInfo.score = null; }
        const pvIdx = line.indexOf(' pv ');
        if (pvIdx !== -1) this.lastInfo.pv = line.slice(pvIdx + 4).trim().split(/\s+/);
        return;
      }

      if (line.startsWith('bestmove ')) {
        const parts = line.slice(9).trim().split(/\s+/);
        const bestMove = parts[0] || null;
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          p.resolve({
            bestMove,
            score: this.lastInfo.score,
            mate: this.lastInfo.mate,
            depth: this.lastInfo.depth,
            pv: this.lastInfo.pv,
          });
        }
        return;
      }
    },

    init() {
      const self = this;
      const OrigWorker = window.Worker;
      const origPost = OrigWorker.prototype.postMessage;

      // 捕获引擎 Worker：谁收到 {type:"command"} 谁就是引擎中继
      OrigWorker.prototype.postMessage = function (msg, ...rest) {
        if (msg && typeof msg === 'object' && msg.type === 'command') {
          if (!self.worker || (self.worker !== this && msg.command === 'uci')) {
            self.worker = this;
            self.ready = false;
            self._ensureListener(this);
          }
        }
        return origPost.call(this, msg, ...rest);
      };

      // 新建 worker 时也尽早挂监听（覆盖注入前已存在/注入后新建两种情况）
      window.Worker = function (url, opts) {
        const w = new OrigWorker(url, opts);
        self._ensureListener(w);
        return w;
      };
      window.Worker.prototype = OrigWorker.prototype;
      window.Worker.CONNECTING = OrigWorker.CONNECTING;
      window.Worker.OPEN = OrigWorker.OPEN;
      window.Worker.CLOSING = OrigWorker.CLOSING;
      window.Worker.CLOSED = OrigWorker.CLOSED;

      window.__XQ_ENGINE__ = this;
    },

    send(cmd) {
      if (!this.worker) return false;
      try { this.worker.postMessage({ type: 'command', command: cmd }); return true; } catch { return false; }
    },

    // 等待引擎 ready（主动 isready 探测）
    async waitReady(timeout = 30000) {
      if (this.ready) return true;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (this.worker) {
          this.send('isready');
          await new Promise((r) => setTimeout(r, 400));
          if (this.ready) return true;
        }
      }
      return this.ready;
    },

    /**
     * 分析一个局面（快速路径，无重载）
     *
     * 可靠性保证：每次分析前先 `stop` 冲刷旧搜索，并核对 t0 之后收到的
     * info/bestmove 都属于本次 gen；解析器只在 gen 匹配时生效，
     * 从而不会把上一步的 bestmove 当成当前局面的结果。
     *
     * @param {string} fen
     * @param {{movetime?:number, depth?:number}} opts
     * @returns {Promise<{bestMove,score,mate,depth,pv}|null>}
     */
    analyze(fen, { movetime = 800, depth = 0 } = {}) {
      if (!this.worker) return Promise.resolve(null);
      const gen = ++this._gen;

      return new Promise((resolve) => {
        const budget = (movetime > 0 ? movetime : Math.max(2000, (depth || 20) * 150)) + 15000;
        const timer = setTimeout(() => {
          if (this.pending && this.pending.gen === gen) {
            this.pending = null;
            resolve(null);
          }
        }, budget);

        // 1) 先 stop 冲刷掉可能仍在进行的旧搜索，并让旧 pending 失效
        if (this.pending) {
          try { this.pending.resolve(null); } catch {}
          this.pending = null;
        }
        this.send('stop');

        // 2) 等待旧搜索真正结束（bestmove 回来）后再发新局面
        setTimeout(() => {
          this.lastInfo = { score: null, mate: null, depth: 0, pv: [] };
          this.pending = {
            gen,
            resolve: (r) => { clearTimeout(timer); resolve(r); },
          };
          this.send('position fen ' + fen);
          if (movetime > 0) this.send('go movetime ' + movetime);
          else this.send('go depth ' + (depth || 20));
        }, 250);
      });
    },

    destroy() {
      if (this.pending) { this.pending.resolve(null); this.pending = null; }
      window.__XQ_ENGINE__ = null;
    },
  };

  engine.init();
})();
