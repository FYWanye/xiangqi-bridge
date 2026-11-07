/**
 * 象棋 AI 桥接控制台 — 前端逻辑
 * 通过 SSE 接收后端事件, 通过 REST 控制桥接。
 */
import { renderBoard, parseFen } from './board.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  statusPill: $('#statusPill'),
  statusText: $('#statusText'),
  modeSeg: $('#modeSeg'),
  roomField: $('#roomField'),
  roomInput: $('#roomInput'),
  depthInput: $('#depthInput'),
  movetimeInput: $('#movetimeInput'),
  headlessCheck: $('#headlessCheck'),
  startBtn: $('#startBtn'),
  stopBtn: $('#stopBtn'),
  analyzeBtn: $('#analyzeBtn'),
  clearLogBtn: $('#clearLogBtn'),
  boardFrame: $('#boardFrame'),
  fenText: $('#fenText'),
  turnText: $('#turnText'),
  moveCount: $('#moveCount'),
  bestMove: $('#bestMove'),
  scoreText: $('#scoreText'),
  gameUrl: $('#gameUrl'),
  logConsole: $('#logConsole'),
};

let currentMode = 'selfplay';
let lastFen = null;
let lastAnalysis = null;

// ===== 状态显示 =====
function setStatus(state, text) {
  els.statusPill.dataset.state = state;
  els.statusText.textContent = text;
  const running = state === 'running' || state === 'starting';
  els.startBtn.disabled = running;
  els.stopBtn.disabled = !running;
  els.analyzeBtn.disabled = !running;
}

function setMode(mode) {
  currentMode = mode;
  els.roomField.style.display = (mode === 'join' || mode === 'analyze') ? 'flex' : 'none';
  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

// ===== 日志 =====
function appendLog(line) {
  const el = document.createElement('div');
  el.textContent = line;
  els.logConsole.appendChild(el);
  els.logConsole.scrollTop = els.logConsole.scrollHeight;
  // 限制日志条数
  while (els.logConsole.children.length > 500) {
    els.logConsole.removeChild(els.logConsole.firstChild);
  }
}

// ===== 棋盘更新 =====
function updateBoard(fen, hintUci) {
  lastFen = fen;
  const { turn } = parseFen(fen);
  els.boardFrame.innerHTML = renderBoard(fen, hintUci ? { hint: hintUci } : {});
  els.fenText.textContent = fen;
  els.turnText.textContent = turn === 'w' ? '红方' : '黑方';
}

// ===== API =====
async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ===== 事件绑定 =====
els.modeSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (btn) setMode(btn.dataset.mode);
});

els.startBtn.addEventListener('click', async () => {
  const payload = {
    mode: currentMode,
    depth: parseInt(els.depthInput.value) || 20,
    movetime: parseInt(els.movetimeInput.value) || 800,
    headless: els.headlessCheck.checked,
  };
  if (currentMode !== 'selfplay') {
    const raw = els.roomInput.value.trim();
    if (!raw) { appendLog('[前端] 请填写房间号或完整 URL'); return; }
    if (/^https?:\/\//i.test(raw)) payload.url = raw;
    else payload.room = raw;
  }
  try {
    await api('/api/start', payload);
    appendLog('[前端] 已发送启动指令');
  } catch (e) {
    appendLog('[前端] 启动失败: ' + e.message);
  }
});

els.stopBtn.addEventListener('click', async () => {
  try { await api('/api/stop'); } catch (e) { appendLog('[前端] 停止失败: ' + e.message); }
});

els.analyzeBtn.addEventListener('click', async () => {
  try {
    const r = await api('/api/analyze');
    if (r.result) {
      lastAnalysis = r.result;
      els.bestMove.textContent = r.result.bestMove || r.result.cnMove || '—';
      els.scoreText.textContent = r.result.score != null ? `${r.result.scoreSide || ''} ${r.result.score}` : '—';
      updateBoard(lastFen, r.result.bestMove);
    }
  } catch (e) { appendLog('[前端] 分析失败: ' + e.message); }
});

els.clearLogBtn.addEventListener('click', () => { els.logConsole.innerHTML = ''; });

// ===== SSE =====
function connectEvents() {
  const es = new EventSource('/api/events');

  es.addEventListener('hello', (e) => {
    const d = JSON.parse(e.data);
    setStatus(d.running ? 'running' : 'stopped', d.running ? '运行中' : '未启动');
  });

  es.addEventListener('log', (e) => appendLog(JSON.parse(e.data)));

  es.addEventListener('status', (e) => {
    const d = JSON.parse(e.data);
    const map = {
      starting: '启动中…',
      running: '运行中',
      stopped: '已停止',
      error: '出错',
      gameover: '对局结束',
    };
    if (d.state === 'running' && d.gameUrl) els.gameUrl.textContent = d.gameUrl;
    setStatus(d.state, map[d.state] || d.state);
  });

  es.addEventListener('fen', (e) => {
    const d = JSON.parse(e.data);
    updateBoard(d.fen, lastAnalysis?.bestMove);
  });

  es.addEventListener('analysis', (e) => {
    const d = JSON.parse(e.data);
    lastAnalysis = d;
    els.bestMove.textContent = d.bestMove || d.cnMove || '—';
    els.scoreText.textContent = d.score != null ? `${d.scoreSide || ''} ${d.score}` : '—';
    if (lastFen) updateBoard(lastFen, d.bestMove);
  });

  es.addEventListener('move', (e) => {
    const d = JSON.parse(e.data);
    els.moveCount.textContent = d.count;
  });

  es.addEventListener('gameover', (e) => {
    const d = JSON.parse(e.data);
    appendLog(`[结束] ${d.turn || ''}`);
  });

  es.onerror = () => {
    // EventSource 会自动重连; 这里仅做提示
    setStatus('stopped', '连接中断，重连中…');
  };
}

// ===== 初始化 =====
setMode('selfplay');
connectEvents();
