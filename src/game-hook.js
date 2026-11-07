/**
 * game.hullqin.cn 页面注入脚本
 * 
 * 功能:
 * 1. 通过 WebSocket 钩子拦截游戏消息, 解码棋盘状态
 * 2. 提供读取当前局面 (FEN) 的接口
 * 3. 提供发送走子指令的接口
 * 4. 监控局面变化并通知外部
 */

// 防止重复注入
if (window.__XQ_BRIDGE__) {
  window.__XQ_BRIDGE__.destroy?.();
}

const Bridge = {
  _ws: null,
  _originalSend: null,
  _originalOnMessage: null,
  _gameState: null,
  _roomState: null,
  _listeners: [],
  _pollTimer: null,
  _lastFen: null,

  /**
   * 初始化: 钩住 WebSocket
   */
  init() {
    console.log('[XQ-Bridge] 初始化中...');

    // 钩住 WebSocket 构造函数
    const OrigWS = window.WebSocket;
    const self = this;

    window.WebSocket = function (...args) {
      const url = args[0];
      console.log('[XQ-Bridge] WebSocket 创建:', url);

      const ws = new OrigWS(...args);
      self._ws = ws;
      self._hookWebSocket(ws);
      return ws;
    };
    window.WebSocket.prototype = OrigWS.prototype;
    window.WebSocket.CONNECTING = OrigWS.CONNECTING;
    window.WebSocket.OPEN = OrigWS.OPEN;
    window.WebSocket.CLOSING = OrigWS.CLOSING;
    window.WebSocket.CLOSED = OrigWS.CLOSED;

    // 同时尝试从 DOM 读取棋盘状态 (备用方案)
    this._startDomObserver();

    console.log('[XQ-Bridge] 初始化完成');
    return true;
  },

  /**
   * 钩住 WebSocket 实例
   */
  _hookWebSocket(ws) {
    const self = this;

    // 钩住 send 方法
    const origSend = ws.send.bind(ws);
    this._originalSend = origSend;
    ws.send = function (data) {
      console.log('[XQ-Bridge] WS 发送:', data instanceof ArrayBuffer ? `ArrayBuffer(${data.byteLength})` : data);
      return origSend(data);
    };

    // 钩住 onmessage
    const origOnMessage = ws.onmessage;
    ws.addEventListener('message', function (event) {
      self._onWsMessage(event.data);
    });

    ws.addEventListener('close', function () {
      console.log('[XQ-Bridge] WebSocket 关闭');
      self._ws = null;
    });
  },

  /**
   * 处理 WebSocket 消息
   */
  _onWsMessage(data) {
    try {
      if (data instanceof ArrayBuffer || data instanceof Blob) {
        // 二进制 protobuf 消息 - 无法直接解码, 标记为数据更新
        this._notifyListeners('ws-binary', { size: data.byteLength || data.size });
      } else if (typeof data === 'string') {
        // JSON 消息 (如果有的话)
        try {
          const parsed = JSON.parse(data);
          this._notifyListeners('ws-json', parsed);
        } catch {
          this._notifyListeners('ws-text', data);
        }
      }
    } catch (e) {
      console.warn('[XQ-Bridge] 消息处理错误:', e);
    }
  },

  /**
   * 从 DOM/SVG 读取棋盘状态
   * game.hullqin.cn 用 SVG 渲染棋盘
   */
  readBoardFromDom() {
    try {
      const svg = document.querySelector('svg#svg');
      if (!svg) return null;

      const rawPieces = [];

      // 结构: <g><use href="#piece-red|black" x=.. y=../><text class="xq-piece-text" x=.. y=..>帥</text></g>
      // SVG 坐标: x=0..80 步长10, y=0..90 步长10 (y=0 在顶部, y=90 在底部)
      const groups = svg.querySelectorAll('g');
      for (const g of groups) {
        const useEl = g.querySelector('use');
        const textEl = g.querySelector('text.xq-piece-text') || g.querySelector('text');
        if (!useEl || !textEl) continue;

        const href = useEl.getAttribute('xlink:href') || useEl.getAttribute('href') || '';
        const pieceText = textEl.textContent.trim();
        const x = parseFloat(useEl.getAttribute('x') ?? textEl.getAttribute('x'));
        const y = parseFloat(useEl.getAttribute('y') ?? textEl.getAttribute('y'));
        if (isNaN(x) || isNaN(y) || !pieceText) continue;

        const isRed = href.includes('piece-red');
        const col = Math.round(x / 10);
        rawPieces.push({ col, y, text: pieceText, isRed });
      }

      // 检测棋盘是否翻转 (执黑方时棋盘旋转 180°)
      // 方法: 找红帅(帥), 如果在 y<45 则棋盘翻转
      const redKing = rawPieces.find(p => p.text === '帥');
      const flipped = redKing ? redKing.y < 45 : false;

      // SVG y → board row; x → col
      // 翻转视角实测: 棋盘 180° 旋转, x 和 y 都镜像
      //   x: A页 col1 的子显示在 B页 x=70 → B_col = 8 - x/10
      //   y: 帥显示在 y=0 (A页 y=90) → B_row = y/10
      const pieces = rawPieces.map(p => {
        const boardRow = flipped ? Math.round(p.y / 10) : 9 - Math.round(p.y / 10);
        const boardCol = flipped ? 8 - p.col : p.col;
        return { row: boardRow, col: boardCol, pos: boardRow * 9 + boardCol, text: p.text, isRed: p.isRed };
      });

      const turnText = this._extractTurnText();
      return { pieces, turnText, flipped, viewBox: svg.getAttribute('viewBox'), timestamp: Date.now() };
    } catch (e) {
      console.warn('[XQ-Bridge] DOM 读取错误:', e);
      return null;
    }
  },

  /**
   * 从页面文本提取回合状态
   * 入座视角显示 "等你下棋" (轮到你); 观战/其他视角显示 "等红方下棋"/"等黑方下棋"
   */
  _extractTurnText() {
    const texts = [
      '等你下棋',          // 入座且轮到自己 (最优先)
      '等红方下棋', '等黑方下棋',
      '红方胜利', '黑方胜利', '你胜利', '你失败',
      '红方请求悔棋中', '黑方请求悔棋中'
    ];
    const bodyText = document.body.innerText || '';
    for (const t of texts) {
      if (bodyText.includes(t)) return t;
    }
    return null;
  },

  /**
   * 判断是否轮到自己落子
   * 需要 mySide 信息: 'red' | 'black' | null (观战)
   */
  isMyTurnNow(mySide) {
    const t = this._extractTurnText();
    if (!t) return false;
    if (t.includes('等你')) return true;                 // 入座视角, 明确轮到我
    if (mySide === 'red') return t.includes('等红方');
    if (mySide === 'black') return t.includes('等黑方');
    return false;
  },

  /**
   * 尝试从 React 状态树读取游戏数据
   */
  readFromReactState() {
    try {
      // 查找 React Fiber 节点
      const rootEl = document.getElementById('root');
      if (!rootEl) return null;

      const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber$'));
      if (!fiberKey) return null;

      let fiber = rootEl[fiberKey];
      const maxDepth = 50;
      let depth = 0;

      // 遍历 Fiber 树寻找游戏状态
      while (fiber && depth < maxDepth) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props) {
          // 游戏组件的 props 通常有 room, game, send
          if (props.room && props.game) {
            return {
              room: props.room,
              game: props.game,
              hasSend: typeof props.send === 'function',
              depth
            };
          }
          // 或者有 view, roomId 等
          if (props.view && props.room) {
            return {
              room: props.room,
              game: props.game || { data: null, version: 0 },
              hasSend: typeof props.send === 'function',
              depth
            };
          }
        }

        fiber = fiber.child || fiber.sibling || fiber.return;
        depth++;
      }

      return null;
    } catch (e) {
      console.warn('[XQ-Bridge] React 状态读取错误:', e);
      return null;
    }
  },

  /**
   * 获取当前 FEN (优先 React 状态, 回退 DOM)
   */
  getCurrentFen() {
    const state = this.readFromReactState();
    if (state && state.game && state.game.data) {
      // 有 React 状态但 game.data 是编码的
      // 尝试通过 webpack 模块解码
      const decoded = this._tryDecodeGameData(state.game.data);
      if (decoded) {
        return this._buildFenFromDecoded(decoded, state.room);
      }
    }

    // 回退: 从 DOM 读取
    const domState = this.readBoardFromDom();
    if (domState && domState.pieces.length > 0) {
      return this._buildFenFromPieces(domState);
    }

    return null;
  },
  /**
   * 尝试通过 webpack 模块解码游戏数据
   */
  _tryDecodeGameData(encodedData) {
    try {
      // webpackChunkgame.push 技巧获取 require
      if (!window.__XQ_WEBPACK_REQ__) {
        let req;
        const chunk = window.webpackChunkgame;
        if (chunk) {
          chunk.push([[Math.random()], {}, r => { req = r; }]);
          if (req) {
            window.__XQ_WEBPACK_REQ__ = req;
          }
        }
      }

      if (!window.__XQ_WEBPACK_REQ__) return null;

      const req = window.__XQ_WEBPACK_REQ__;

      // 模块 16064 是编码/解码模块 (xq.js 中用 l.g.decode)
      // 模块 52031 是游戏逻辑模块
      try {
        const gameLogic = req(52031);
        if (gameLogic && gameLogic.my) {
          // my 函数解码游戏视图
          return gameLogic.my(encodedData);
        }
      } catch {}

      try {
        const codec = req(16064);
        if (codec && codec.g && codec.g.decode) {
          return codec.g.decode(encodedData);
        }
      } catch {}

      return null;
    } catch (e) {
      console.warn('[XQ-Bridge] 解码失败:', e);
      return null;
    }
  },

  /**
   * 从解码后的游戏数据构建 FEN
   */
  _buildFenFromDecoded(decoded, room) {
    if (!decoded) return null;

    // decoded 应该有: pieceList, state, redId, recordList
    const pieceList = decoded.pieceList || [];
    const turnState = decoded.state; // 0=WaitRed, 1=WaitBlack
    const redId = decoded.redId || 0;

    if (pieceList.length === 0) return null;

    return this._pieceListToFen(pieceList, turnState);
  },

  /**
   * 从 DOM 读取的棋子信息构建 FEN
   */
  _buildFenFromPieces(domState) {
    const { pieces, turnText, flipped } = domState;
    const board = Array(10).fill(null).map(() => Array(9).fill(null));

    for (const p of pieces) {
      if (p.row >= 0 && p.row <= 9 && p.col >= 0 && p.col <= 8) {
        const fenChar = this._pieceToFenChar(p.text, p.isRed);
        if (fenChar) board[p.row][p.col] = fenChar;
      }
    }

    const fenRows = [];
    for (let row = 9; row >= 0; row--) {
      let fenRow = '';
      let empty = 0;
      for (let col = 0; col < 9; col++) {
        if (board[row][col]) {
          if (empty > 0) { fenRow += empty; empty = 0; }
          fenRow += board[row][col];
        } else { empty++; }
      }
      if (empty > 0) fenRow += empty;
      fenRows.push(fenRow);
    }

    // 回合推断 (按可靠性排序):
    // 1. "等红方下棋"/"等黑方下棋" — 观战/中立视角, 直接对应 w/b
    // 2. "等你下棋" — 入座视角, 结合 flipped: 红方页(未翻转)→w, 黑方页(翻转)→b
    // 3. "等你下棋" + 无 flipped 信息 → 无法判断, 保守返回 null
    let turn;
    if (turnText) {
      if (turnText.includes('等红方')) turn = 'w';
      else if (turnText.includes('等黑方')) turn = 'b';
      else if (turnText.includes('等你')) turn = flipped ? 'b' : 'w';
      else turn = null;
    } else {
      turn = null;
    }
    if (!turn) {
      console.warn('[XQ-Bridge] 无法判断回合, turnText=', turnText, 'flipped=', flipped);
      turn = 'w'; // 兜底
    }
    return fenRows.join('/') + ' ' + turn;
  },

  /**
   * 棋子文字 + 颜色 → FEN 字符
   */
  _pieceToFenChar(text, isRed) {
    // 红方独有字: 帥 相 兵 ; 黑方独有字: 將 象 卒
    // 共用字: 士 馬 車 炮 (由 isRed 决定大小写)
    const map = {
      '帥': isRed ? 'K' : 'k', '將': isRed ? 'K' : 'k',
      '仕': isRed ? 'A' : 'a', '士': isRed ? 'A' : 'a',
      '相': isRed ? 'B' : 'b', '象': isRed ? 'B' : 'b',
      '馬': isRed ? 'N' : 'n', '马': isRed ? 'N' : 'n',
      '車': isRed ? 'R' : 'r', '车': isRed ? 'R' : 'r',
      '炮': isRed ? 'C' : 'c',
      '兵': isRed ? 'P' : 'p', '卒': isRed ? 'P' : 'p'
    };
    return map[text] || null;
  },

  /**
   * pieceList → FEN
   */
  _pieceListToFen(pieceList, turnState) {
    const board = Array(10).fill(null).map(() => Array(9).fill(null));
    const redChars = 'RNBAKABNRCCPPPPP';
    const blackChars = 'rnbakabnrccppppp';

    for (let id = 0; id < pieceList.length; id++) {
      const pos = pieceList[id];
      if (pos === 127 || pos == null) continue;
      const row = Math.floor(pos / 9);
      const col = pos % 9;
      if (row < 0 || row > 9 || col < 0 || col > 8) continue;

      const ch = id < 16 ? (redChars[id] || 'P') : (blackChars[id - 16] || 'p');
      board[row][col] = ch;
    }

    const fenRows = [];
    for (let row = 9; row >= 0; row--) {
      let fenRow = '';
      let empty = 0;
      for (let col = 0; col < 9; col++) {
        if (board[row][col]) {
          if (empty > 0) { fenRow += empty; empty = 0; }
          fenRow += board[row][col];
        } else { empty++; }
      }
      if (empty > 0) fenRow += empty;
      fenRows.push(fenRow);
    }

    return fenRows.join('/') + ' ' + (turnState === 0 ? 'w' : 'b');
  },

  /**
   * 模拟在 SVG 棋盘上点击走子
   * @param {number} fromRow - 起始行 (0-9)
   * @param {number} fromCol - 起始列 (0-8)
   * @param {number} toRow - 目标行 (0-9)
   * @param {number} toCol - 目标列 (0-8)
   */
  async simulateMove(fromRow, fromCol, toRow, toCol) {
    const svg = document.querySelector('svg#svg');
    if (!svg) return false;

    // 关键: 先把棋盘滚到可视区中央, 否则点击坐标可能超出视口导致 elementFromPoint 落空
    svg.scrollIntoView({ block: 'center', behavior: 'instant' });
    await this._sleep(150);

    // 检测棋盘是否翻转
    const domState = this.readBoardFromDom();
    const flipped = domState?.flipped || false;

    // SVG 坐标: 翻转视角 180° 旋转, x/y 都镜像
    const toSvg = (row, col) => flipped
      ? { x: (8 - col) * 10, y: row * 10 }
      : { x: col * 10, y: (9 - row) * 10 };

    const from = toSvg(fromRow, fromCol);
    const to = toSvg(toRow, toCol);

    // 重新获取 rect (滚动后位置已变)
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width / 92;
    const scaleY = rect.height / 102;

    const screenFromX = rect.left + (from.x + 6) * scaleX;
    const screenFromY = rect.top + (from.y + 6) * scaleY;
    const screenToX = rect.left + (to.x + 6) * scaleX;
    const screenToY = rect.top + (to.y + 6) * scaleY;

    // 视口校验: 超出视口的点击必失败
    if (screenFromY < 0 || screenFromY > window.innerHeight || screenToY < 0 || screenToY > window.innerHeight) {
      console.error(`[XQ-Bridge] 点击坐标超出视口 (from=${Math.round(screenFromY)}, to=${Math.round(screenToY)}, vh=${window.innerHeight})`);
      return false;
    }

    console.log(`[XQ-Bridge] 走子: (${fromRow},${fromCol})→(${toRow},${toCol}) flipped=${flipped}`);

    await this._simulateClick(svg, screenFromX, screenFromY);
    await this._sleep(250);
    await this._simulateClick(svg, screenToX, screenToY);
    await this._sleep(250);
    return true;
  },

  /**
   * 检查棋盘是否翻转
   */
  _isBoardReversed() {
    // 通过观察棋子位置或按钮状态判断
    const flipBtn = document.querySelector('[class*="flip"], [title*="翻转"]');
    if (flipBtn) return flipBtn.getAttribute('data-flipped') === 'true';
    return false;
  },

  /**
   * 模拟鼠标点击 (定位真实元素 + 完整 pointer/mouse 事件序列)
   */
  async _simulateClick(element, x, y) {
    // React 的 onClick 绑定在具体棋子元素上, 必须让事件命中该元素
    // elementFromPoint 找到该坐标最顶层的可命中元素
    const target = document.elementFromPoint(x, y) || element;
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      view: window
    };

    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    await this._sleep(60);
    target.dispatchEvent(new PointerEvent('pointerup', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    await this._sleep(60);
    target.dispatchEvent(new MouseEvent('click', opts));
  },

  /**
   * 通过 UCI 格式走子
   */
  async playMove(uciMove) {
    const cols = 'abcdefghi';
    const fromCol = cols.indexOf(uciMove[0]);
    const fromRow = parseInt(uciMove[1]);
    const toCol = cols.indexOf(uciMove[2]);
    const toRow = parseInt(uciMove[3]);

    return await this.simulateMove(fromRow, fromCol, toRow, toCol);
  },

  /**
   * 开始监控局面变化
   */
  startMonitoring(callback, intervalMs = 1000) {
    this.stopMonitoring();
    let lastFen = this.getCurrentFen();

    this._pollTimer = setInterval(() => {
      const fen = this.getCurrentFen();
      if (fen && fen !== lastFen) {
        lastFen = fen;
        callback(fen);
      }
    }, intervalMs);
  },

  stopMonitoring() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  /**
   * DOM 变化观察器 (备用)
   */
  _startDomObserver() {
    const target = document.getElementById('root');
    if (!target) return;

    const observer = new MutationObserver((mutations) => {
      // 棋盘变化时通知
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'attributes') {
          this._notifyListeners('dom-change', {
            type: mutation.type,
            target: mutation.target.tagName
          });
          break;
        }
      }
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['transform', 'cx', 'cy', 'fill']
    });

    this._domObserver = observer;
  },

  /**
   * 事件监听
   */
  on(event, callback) {
    this._listeners.push({ event, callback });
  },

  _notifyListeners(event, data) {
    for (const l of this._listeners) {
      if (l.event === event || l.event === '*') {
        try { l.callback(data); } catch {}
      }
    }
  },

  /**
   * 销毁钩子
   */
  destroy() {
    this.stopMonitoring();
    if (this._domObserver) {
      this._domObserver.disconnect();
      this._domObserver = null;
    }
    this._listeners = [];
    window.__XQ_BRIDGE__ = null;
    console.log('[XQ-Bridge] 已销毁');
  },

  /**
   * 延迟
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

// 安装到全局
window.__XQ_BRIDGE__ = Bridge;
Bridge.init();

console.log('[XQ-Bridge] 注入完成, 可通过 window.__XQ_BRIDGE__ 访问');
