/* ============================================================
   SLITHER ARENA — Client Game Engine
   ============================================================
   CONFIGURATION: Change SERVER_URL to your deployed backend.
   ============================================================ */

const SERVER_URL = 'https://your-server.onrender.com'; // <— CHANGE THIS

// ── Constants ──
const HEAD_RADIUS = 10;
const MAP_RADIUS = 2500;
const GRID_SPACING = 80;
const CAMERA_LERP = 0.08;
const MIN_SEGMENTS_DRAW = 2;

// ── State ──
let socket = null;
let myId = null;
let roomCode = null;
let gameState = null;
let camera = { x: 0, y: 0 };
let isBoosting = false;
let isAlive = false;
let animFrame = null;
let lastScore = 0;
let lastLength = 0;

// ── DOM ──
const menuScreen = document.getElementById('menuScreen');
const gameScreen = document.getElementById('gameScreen');
const deathScreen = document.getElementById('deathScreen');
const bgCanvas = document.getElementById('bgCanvas');
const bgCtx = bgCanvas.getContext('2d');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const usernameInput = document.getElementById('usernameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const serverStatus = document.getElementById('serverStatus');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const scoreDisplay = document.getElementById('scoreDisplay');
const lengthDisplay = document.getElementById('lengthDisplay');
const lbEntries = document.getElementById('lbEntries');
const boostIndicator = document.getElementById('boostIndicator');
const deathScore = document.getElementById('deathScore');
const deathLength = document.getElementById('deathLength');
const respawnBtn = document.getElementById('respawnBtn');
const leaveBtn = document.getElementById('leaveBtn');
const toastEl = document.getElementById('toast');

// ── Helpers ──
function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function parseHex(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  };
}

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  bgCanvas.width = window.innerWidth;
  bgCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── Menu Background Animation ──
const bgParticles = [];
for (let i = 0; i < 60; i++) {
  bgParticles.push({
    x: Math.random() * 2000,
    y: Math.random() * 2000,
    r: 2 + Math.random() * 4,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
    color: ['#00E5A0','#FFD23F','#FF6B35','#00D4FF','#FF3366','#B8FF00'][Math.floor(Math.random()*6)]
  });
}

function renderBg() {
  if (menuScreen.style.display === 'none') return;
  const w = bgCanvas.width, h = bgCanvas.height;
  bgCtx.fillStyle = '#060a06';
  bgCtx.fillRect(0, 0, w, h);

  for (const p of bgParticles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < -20) p.x = w + 20;
    if (p.x > w + 20) p.x = -20;
    if (p.y < -20) p.y = h + 20;
    if (p.y > h + 20) p.y = -20;

    bgCtx.beginPath();
    bgCtx.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2);
    bgCtx.fillStyle = hexToRgba(p.color, 0.08);
    bgCtx.fill();

    bgCtx.beginPath();
    bgCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    bgCtx.fillStyle = hexToRgba(p.color, 0.35);
    bgCtx.fill();
  }
  requestAnimationFrame(renderBg);
}
renderBg();

// ── Screen Management ──
function showMenu() {
  menuScreen.style.display = '';
  gameScreen.style.display = 'none';
  deathScreen.style.display = 'none';
  isAlive = false;
  gameState = null;
  camera = { x: 0, y: 0 };
  renderBg();
}

function showGame() {
  menuScreen.style.display = 'none';
  gameScreen.style.display = '';
  deathScreen.style.display = 'none';
  isAlive = true;
  resizeCanvas();
  if (!animFrame) renderLoop();
}

function showDeath(score, length) {
  isAlive = false;
  deathScore.textContent = score;
  deathLength.textContent = length;
  deathScreen.style.display = '';
}

function hideDeath() {
  deathScreen.style.display = 'none';
}

// ── Connection ──
function connect() {
  socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    timeout: 8000
  });

  socket.on('connect', () => {
    serverStatus.textContent = 'Connected';
    serverStatus.className = 'status connected';
  });

  socket.on('disconnect', () => {
    serverStatus.textContent = 'Disconnected';
    serverStatus.className = 'status disconnected';
    if (gameScreen.style.display !== 'none') {
      showToast('Lost connection to server');
    }
  });

  socket.on('connect_error', () => {
    serverStatus.textContent = 'Connection failed';
    serverStatus.className = 'status disconnected';
  });

  socket.on('error', (data) => {
    showToast(data.message);
  });

  socket.on('roomCreated', (data) => {
    roomCode = data.code;
    roomCodeDisplay.textContent = data.code;
    showGame();
  });

  socket.on('roomJoined', (data) => {
    roomCode = data.code;
    roomCodeDisplay.textContent = data.code;
    showGame();
  });

  socket.on('gameState', (data) => {
    gameState = data;
    // Detect respawn
    if (!isAlive && gameState.players) {
      const me = gameState.players.find(p => p.id === myId);
      if (me) {
        isAlive = true;
        hideDeath();
      }
    }
  });

  socket.on('playerDied', (data) => {
    if (data.id === myId) {
      const me = gameState ? gameState.players.find(p => p.id === myId) : null;
      showDeath(data.score, me ? me.segments.length : 0);
    }
  });

  socket.on('kicked', () => {
    showToast('Removed from room');
    showMenu();
  });
}

// ── Input ──
function setupInput() {
  // Mouse move → send angle
  canvas.addEventListener('mousemove', (e) => {
    if (!isAlive || !socket) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
    socket.emit('setAngle', { angle });
  });

  // Touch support
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!isAlive || !socket) return;
    const touch = e.touches[0];
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const angle = Math.atan2(touch.clientY - cy, touch.clientX - cx);
    socket.emit('setAngle', { angle });
  }, { passive: false });

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!isAlive || !socket) return;
    isBoosting = true;
    socket.emit('setBoost', { boosting: true });
    boostIndicator.style.display = '';
  }, { passive: false });

  canvas.addEventListener('touchend', () => {
    isBoosting = false;
    if (socket) socket.emit('setBoost', { boosting: false });
    boostIndicator.style.display = 'none';
  });

  // Keyboard
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!isAlive || !socket) return;
      if (!isBoosting) {
        isBoosting = true;
        socket.emit('setBoost', { boosting: true });
        boostIndicator.style.display = '';
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      isBoosting = false;
      if (socket) socket.emit('setBoost', { boosting: false });
      boostIndicator.style.display = 'none';
    }
  });

  // Menu buttons
  createRoomBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (!name) { showToast('Please enter your name'); usernameInput.focus(); return; }
    if (!socket || !socket.connected) { showToast('Not connected to server'); return; }
    myId = socket.id;
    socket.emit('createRoom', { username: name });
  });

  joinRoomBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!name) { showToast('Please enter your name'); usernameInput.focus(); return; }
    if (!code) { showToast('Please enter a room code'); roomCodeInput.focus(); return; }
    if (!socket || !socket.connected) { showToast('Not connected to server'); return; }
    myId = socket.id;
    socket.emit('joinRoom', { username: name, code });
  });

  // Enter key on inputs
  usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createRoomBtn.click(); });
  roomCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoomBtn.click(); });

  // Copy room code
  copyCodeBtn.addEventListener('click', () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode).then(() => showToast('Room code copied!'));
    }
  });

  // Death screen
  respawnBtn.addEventListener('click', () => {
    if (socket) socket.emit('respawn');
  });

  leaveBtn.addEventListener('click', () => {
    if (socket && roomCode) {
      socket.emit('leaveRoom');
    }
    showMenu();
  });
}

// ── Rendering ──
function renderLoop() {
  animFrame = requestAnimationFrame(renderLoop);
  if (!gameState) return;

  const w = canvas.width, h = canvas.height;

  // Find my snake for camera
  const me = gameState.players ? gameState.players.find(p => p.id === myId) : null;
  if (me && me.segments.length > 0) {
    const tx = me.segments[0][0];
    const ty = me.segments[0][1];
    camera.x += (tx - camera.x) * CAMERA_LERP;
    camera.y += (ty - camera.y) * CAMERA_LERP;
  }

  // Clear
  ctx.fillStyle = '#060a06';
  ctx.fillRect(0, 0, w, h);

  // Camera transform
  ctx.save();
  ctx.translate(Math.round(w / 2 - camera.x), Math.round(h / 2 - camera.y));

  drawGrid(w, h);
  drawBoundary();
  drawFood(w, h);

  // Draw snakes: others first, me on top
  if (gameState.players) {
    const others = gameState.players.filter(p => p.id !== myId);
    for (const p of others) drawSnake(p);
    if (me) drawSnake(me);
  }

  ctx.restore();

  // Minimap & HUD
  drawMinimap(w, h);
  updateHUD(me);
}

function drawGrid(w, h) {
  const left = camera.x - w / 2;
  const top = camera.y - h / 2;
  const right = camera.x + w / 2;
  const bottom = camera.y + h / 2;

  const startX = Math.floor(left / GRID_SPACING) * GRID_SPACING;
  const startY = Math.floor(top / GRID_SPACING) * GRID_SPACING;

  ctx.fillStyle = 'rgba(0,229,160,0.04)';
  for (let x = startX; x <= right; x += GRID_SPACING) {
    for (let y = startY; y <= bottom; y += GRID_SPACING) {
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBoundary() {
  // Outer darkening ring
  const grad = ctx.createRadialGradient(0, 0, MAP_RADIUS - 120, 0, 0, MAP_RADIUS + 30);
  grad.addColorStop(0, 'rgba(0,229,160,0)');
  grad.addColorStop(0.8, 'rgba(0,229,160,0.025)');
  grad.addColorStop(1, 'rgba(255,51,102,0.06)');

  ctx.beginPath();
  ctx.arc(0, 0, MAP_RADIUS + 30, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Main boundary line
  ctx.beginPath();
  ctx.arc(0, 0, MAP_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,229,160,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Soft outer glow
  ctx.beginPath();
  ctx.arc(0, 0, MAP_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,229,160,0.08)';
  ctx.lineWidth = 16;
  ctx.stroke();
}

function drawFood(w, h) {
  if (!gameState.food) return;
  const margin = 40;

  for (const f of gameState.food) {
    const sx = f[0] - camera.x + w / 2;
    const sy = f[1] - camera.y + h / 2;
    if (sx < -margin || sx > w + margin || sy < -margin || sy > h + margin) continue;

    // Glow
    ctx.beginPath();
    ctx.arc(f[0], f[1], f[2] * 2.8, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(f[3], 0.1);
    ctx.fill();

    // Core
    ctx.beginPath();
    ctx.arc(f[0], f[1], f[2], 0, Math.PI * 2);
    ctx.fillStyle = f[3];
    ctx.fill();
  }
}

function drawSnake(player) {
  const segs = player.segments;
  if (!segs || segs.length < MIN_SEGMENTS_DRAW) return;

  const color = player.color;
  const rgb = parseHex(color);
  const len = segs.length;
  const isMe = player.id === myId;

  // Boost trail particles
  if (player.boosting && len > 2) {
    const hx = segs[0][0], hy = segs[0][1];
    const nx = segs[1][0], ny = segs[1][1];
    const angle = Math.atan2(hy - ny, hx - nx);
    const time = Date.now() * 0.008;
    for (let i = 0; i < 6; i++) {
      const off = (i + 1) * 14;
      const wobble = Math.sin(time + i * 1.7) * 10;
      const px = hx - Math.cos(angle) * off - Math.sin(angle) * wobble;
      const py = hy - Math.sin(angle) * off + Math.cos(angle) * wobble;
      const pr = Math.max(0.5, 4.5 - i * 0.7);
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(color, 0.35 - i * 0.05);
      ctx.fill();
    }
  }

  // Body segments (tail → head)
  for (let i = len - 1; i >= 0; i--) {
    const t = i / len; // 0 at head, 1 at tail
    const radius = Math.max(1, HEAD_RADIUS * (1 - t * 0.45));
    const alpha = 1 - t * 0.35;
    const darken = 1 - t * 0.35;

    ctx.beginPath();
    ctx.arc(segs[i][0], segs[i][1], radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${Math.floor(rgb.r * darken)},${Math.floor(rgb.g * darken)},${Math.floor(rgb.b * darken)},${alpha})`;
    ctx.fill();
  }

  // Head features
  if (len >= 2) {
    const hx = segs[0][0], hy = segs[0][1];
    const nx = segs[1][0], ny = segs[1][1];
    const angle = Math.atan2(hy - ny, hx - nx);

    // Head glow when boosting
    if (player.boosting) {
      ctx.beginPath();
      ctx.arc(hx, hy, HEAD_RADIUS * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(color, 0.15);
      ctx.fill();
    }

    // Head outline for own snake
    if (isMe) {
      ctx.beginPath();
      ctx.arc(hx, hy, HEAD_RADIUS + 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(color, 0.5);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Eyes
    const eyeOff = HEAD_RADIUS * 0.45;
    const eyeR = HEAD_RADIUS * 0.38;
    const pupilR = eyeR * 0.52;

    const lx = hx + Math.cos(angle - 0.55) * eyeOff;
    const ly = hy + Math.sin(angle - 0.55) * eyeOff;
    const rx = hx + Math.cos(angle + 0.55) * eyeOff;
    const ry = hy + Math.sin(angle + 0.55) * eyeOff;

    const pupilShift = eyeR * 0.3;

    // White
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(lx, ly, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(rx, ry, eyeR, 0, Math.PI * 2); ctx.fill();

    // Pupils
    const px = Math.cos(angle) * pupilShift;
    const py = Math.sin(angle) * pupilShift;
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.arc(lx + px, ly + py, pupilR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(rx + px, ry + py, pupilR, 0, Math.PI * 2); ctx.fill();

    // Name tag
    ctx.font = '600 12px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = isMe ? 'rgba(0,229,160,0.9)' : 'rgba(255,255,255,0.7)';
    ctx.fillText(player.name, hx, hy - HEAD_RADIUS - 8);
  }
}

function drawMinimap(w, h) {
  const size = 140;
  const padding = 16;
  const mx = w - size - padding;
  const my = h - size - padding;
  const scale = size / (MAP_RADIUS * 2);

  // Background
  ctx.fillStyle = 'rgba(8,18,8,0.85)';
  ctx.strokeStyle = 'rgba(0,229,160,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(mx + size / 2, my + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Boundary circle
  ctx.beginPath();
  ctx.arc(mx + size / 2, my + size / 2, (MAP_RADIUS * scale), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,229,160,0.25)';
  ctx.stroke();

  // Food dots (sample a few)
  if (gameState.food) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    const step = Math.max(1, Math.floor(gameState.food.length / 60));
    for (let i = 0; i < gameState.food.length; i += step) {
      const f = gameState.food[i];
      const fx = mx + size / 2 + f[0] * scale;
      const fy = my + size / 2 + f[1] * scale;
      ctx.fillRect(fx, fy, 1, 1);
    }
  }

  // Snake dots
  if (gameState.players) {
    for (const p of gameState.players) {
      if (!p.segments || p.segments.length === 0) continue;
      const sx = mx + size / 2 + p.segments[0][0] * scale;
      const sy = my + size / 2 + p.segments[0][1] * scale;
      const isMe = p.id === myId;

      ctx.beginPath();
      ctx.arc(sx, sy, isMe ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = isMe ? '#00E5A0' : p.color;
      ctx.fill();

      if (isMe) {
        ctx.beginPath();
        ctx.arc(sx, sy, 7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,229,160,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
}

function updateHUD(me) {
  if (!me) return;
  const score = me.score;
  const length = me.segments ? me.segments.length : 0;

  if (score !== lastScore) {
    scoreDisplay.textContent = score;
    lastScore = score;
  }
  if (length !== lastLength) {
    lengthDisplay.textContent = length;
    lastLength = length;
  }

  // Leaderboard
  if (gameState.leaderboard) {
    let html = '';
    for (const entry of gameState.leaderboard) {
      const cls = entry.id === myId ? 'lb-entry me' : (entry.alive ? 'lb-entry' : 'lb-entry dead');
      html += `<div class="${cls}">
        <span class="lb-rank">${entry.rank}</span>
        <span class="lb-name">${entry.name}</span>
        <span class="lb-score">${entry.score}</span>
      </div>`;
    }
    lbEntries.innerHTML = html;
  }
}

// ── Custom Cursor on Canvas ──
canvas.addEventListener('mousemove', (e) => {
  // Cursor is hidden via CSS; could draw a custom one here
});

// ── Initialize ──
connect();
setupInput();
