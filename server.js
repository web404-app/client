/* ============================================================
   SLITHER ARENA — Multiplayer Backend
   Node.js + Express + Socket.io
   ============================================================ */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Health check endpoint (useful for Render/Railway monitoring)
app.get('/health', (req, res) => res.send('OK'));

// ── Constants ──
const MAP_RADIUS = 2500;
const FOOD_INIT = 300;
const FOOD_MAX = 600;
const FOOD_MIN_THRESHOLD = 220;
const TICK_RATE = 20;
const SNAKE_SPEED = 2.5;
const BOOST_SPEED = 5.5;
const SEG_SPACE = 5;
const HEAD_R = 10;
const FOOD_R = 4;
const TURN_SPEED = 0.1;
const INIT_SEGS = 30;
const MAX_PLAYERS = 12;
const COLL_SKIP = 5;       // skip first N segments of target snake for collision
const GROW_PER_FOOD = 2;

const COLORS = [
  '#FF6B35', '#00E5A0', '#FFD23F', '#FF3366',
  '#00D4FF', '#B8FF00', '#FF8800', '#E040FB',
  '#FF4444', '#44FF88', '#FF9966', '#66FFCC'
];

// ── Helpers ──
function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += c[Math.floor(Math.random() * c.length)];
  return code;
}

function dist(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function randPos(margin) {
  margin = margin || 0;
  const a = Math.random() * Math.PI * 2;
  const maxD = (MAP_RADIUS - margin) * 0.85;
  const d = Math.random() * maxD + margin;
  return { x: Math.cos(a) * d, y: Math.sin(a) * d };
}

function genFood(count) {
  const food = [];
  for (let i = 0; i < count; i++) {
    const p = randPos(50);
    food.push({
      x: p.x, y: p.y,
      r: FOOD_R + Math.random() * 3,
      c: COLORS[Math.floor(Math.random() * COLORS.length)]
    });
  }
  return food;
}

// ── Snake Class ──
class Snake {
  constructor(id, name, color) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.angle = Math.random() * Math.PI * 2;
    this.targetAngle = this.angle;
    this.boosting = false;
    this.score = 0;
    this.segments = [];
    const pos = randPos(200);
    for (let i = 0; i < INIT_SEGS; i++) {
      this.segments.push({
        x: pos.x - Math.cos(this.angle) * i * SEG_SPACE,
        y: pos.y - Math.sin(this.angle) * i * SEG_SPACE
      });
    }
  }

  get head() { return this.segments[0]; }

  update() {
    // Smooth turn toward target angle
    let da = this.targetAngle - this.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    this.angle += Math.abs(da) < TURN_SPEED ? da : Math.sign(da) * TURN_SPEED;

    // Move head
    const spd = this.boosting ? BOOST_SPEED : SNAKE_SPEED;
    this.segments[0].x += Math.cos(this.angle) * spd;
    this.segments[0].y += Math.sin(this.angle) * spd;

    // Body follows head (maintain segment spacing)
    for (let i = 1; i < this.segments.length; i++) {
      const prev = this.segments[i - 1];
      const curr = this.segments[i];
      const dx = prev.x - curr.x;
      const dy = prev.y - curr.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > SEG_SPACE) {
        const ratio = SEG_SPACE / d;
        curr.x = prev.x - dx * ratio;
        curr.y = prev.y - dy * ratio;
      }
    }

    // Boost cost: shed tail segments
    if (this.boosting && this.segments.length > 12 && Math.random() < 0.14) {
      this.segments.pop();
      this.score = Math.max(0, this.score - 1);
    }
  }

  grow(n) {
    for (let i = 0; i < n; i++) {
      const tail = this.segments[this.segments.length - 1];
      this.segments.push({ x: tail.x, y: tail.y });
    }
    this.score += n;
  }
}

// ── Room Management ──
const rooms = {};

function createRoom(code) {
  rooms[code] = {
    snakes: {},
    players: {},
    food: genFood(FOOD_INIT),
    colorIdx: Math.floor(Math.random() * COLORS.length)
  };
  return rooms[code];
}

function getRoom(socket) {
  const code = socket.roomCode;
  return code ? rooms[code] : null;
}

function addPlayer(room, socketId, name) {
  const color = COLORS[room.colorIdx % COLORS.length];
  room.colorIdx++;
  const snake = new Snake(socketId, name, color);
  room.snakes[socketId] = snake;
  room.players[socketId] = { name, color, score: 0, alive: true };
  return snake;
}

function removePlayer(room, socketId) {
  const snake = room.snakes[socketId];
  if (snake) {
    // Spawn death food along body
    for (let i = 0; i < snake.segments.length; i += 3) {
      room.food.push({
        x: snake.segments[i].x + (Math.random() - 0.5) * 20,
        y: snake.segments[i].y + (Math.random() - 0.5) * 20,
        r: FOOD_R + Math.random() * 4,
        c: snake.color
      });
    }
    delete room.snakes[socketId];
  }
  delete room.players[socketId];
}

// ── Game Loop (runs for all rooms) ──
function updateRoom(code) {
  const room = rooms[code];
  if (!room) return;

  const ids = Object.keys(room.snakes);

  // 1) Update all snakes
  for (const id of ids) {
    room.snakes[id].update();
  }

  // 2) Food collision
  for (const id of ids) {
    const s = room.snakes[id];
    const hx = s.head.x, hy = s.head.y;
    for (let i = room.food.length - 1; i >= 0; i--) {
      const f = room.food[i];
      if (dist(hx, hy, f.x, f.y) < HEAD_R + f.r) {
        s.grow(GROW_PER_FOOD);
        room.food.splice(i, 1);
      }
    }
  }

  // 3) Collision detection: head vs boundary, head vs other snake body
  const deadIds = new Set();

  for (const id of ids) {
    const s = room.snakes[id];
    const hx = s.head.x, hy = s.head.y;

    // Boundary check
    if (dist(0, 0, hx, hy) > MAP_RADIUS) {
      deadIds.add(id);
      continue;
    }

    // Head vs other snakes
    for (const otherId of ids) {
      if (otherId === id) continue;
      const other = room.snakes[otherId];
      const segs = other.segments;

      // Skip segments near other snake's head
      for (let i = COLL_SKIP; i < segs.length; i++) {
        if (dist(hx, hy, segs[i].x, segs[i].y) < HEAD_R + HEAD_R * 0.65) {
          deadIds.add(id);
          break;
        }
      }
      if (deadIds.has(id)) break;
    }
  }

  // 4) Handle deaths
  for (const id of deadIds) {
    const s = room.snakes[id];
    room.players[id].alive = false;
    room.players[id].score = s.score;

    // Death food
    for (let i = 0; i < s.segments.length; i += 3) {
      room.food.push({
        x: s.segments[i].x + (Math.random() - 0.5) * 25,
        y: s.segments[i].y + (Math.random() - 0.5) * 25,
        r: FOOD_R + Math.random() * 5,
        c: s.color
      });
    }

    // Cap food count
    while (room.food.length > FOOD_MAX) room.food.shift();

    delete room.snakes[id];

    // Notify room
    io.to(code).emit('playerDied', { id, score: s.score, length: s.segments.length });
  }

  // 5) Replenish food
  while (room.food.length < FOOD_MIN_THRESHOLD) {
    const p = randPos(50);
    room.food.push({
      x: p.x, y: p.y,
      r: FOOD_R + Math.random() * 3,
      c: COLORS[Math.floor(Math.random() * COLORS.length)]
    });
  }

  // 6) Build & broadcast game state
  const state = {
    players: [],
    food: [],
    leaderboard: []
  };

  // Compact food: [x, y, r, colorHex]
  for (const f of room.food) {
    state.food.push([f.x, f.y, f.r, f.c]);
  }

  // Player snake data
  for (const id of Object.keys(room.snakes)) {
    const s = room.snakes[id];
    const segArr = [];
    // Send every 2nd segment for bandwidth savings; client renders them smoothly
    for (let i = 0; i < s.segments.length; i += 2) {
      segArr.push([s.segments[i].x, s.segments[i].y]);
    }
    // Always include the head (index 0) and ensure last segment is included
    state.players.push({
      id,
      name: s.name,
      segments: segArr,
      color: s.color,
      score: s.score,
      boosting: s.boosting,
      segStep: 2 // tells client the step used
    });
  }

  // Leaderboard from all players (alive + dead)
  const allP = Object.entries(room.players)
    .map(([id, p]) => ({ id, name: p.name, score: p.score, alive: p.alive }))
    .sort((a, b) => b.score - a.score);

  state.leaderboard = allP.slice(0, 8).map((p, i) => ({
    ...p,
    rank: i + 1
  }));

  io.to(code).emit('gameState', state);
}

// Main game tick
setInterval(() => {
  for (const code in rooms) {
    if (Object.keys(rooms[code].snakes).length > 0) {
      updateRoom(code);
    }
  }
}, Math.round(1000 / TICK_RATE));

// ── Socket Event Handlers ──
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('createRoom', ({ username }) => {
    if (!username || !username.trim()) {
      return socket.emit('error', { message: 'Please enter a name' });
    }

    let code;
    let attempts = 0;
    do { code = genCode(); attempts++; } while (rooms[code] && attempts < 50);

    const room = createRoom(code);
    socket.join(code);
    socket.roomCode = code;
    addPlayer(room, socket.id, username.trim().slice(0, 16));

    console.log(`[Room] ${username} created ${code}`);
    socket.emit('roomCreated', { code });
  });

  socket.on('joinRoom', ({ username, code }) => {
    code = (code || '').trim().toUpperCase();

    if (!username || !username.trim()) {
      return socket.emit('error', { message: 'Please enter a name' });
    }
    if (!rooms[code]) {
      return socket.emit('error', { message: 'Room not found' });
    }
    if (Object.keys(rooms[code].snakes).length >= MAX_PLAYERS) {
      return socket.emit('error', { message: 'Room is full (max ' + MAX_PLAYERS + ')' });
    }

    socket.join(code);
    socket.roomCode = code;
    addPlayer(rooms[code], socket.id, username.trim().slice(0, 16));

    console.log(`[Room] ${username} joined ${code}`);
    socket.emit('roomJoined', { code });
  });

  socket.on('setAngle', ({ angle }) => {
    const room = getRoom(socket);
    const snake = room && room.snakes[socket.id];
    if (snake) snake.targetAngle = angle;
  });

  socket.on('setBoost', ({ boosting }) => {
    const room = getRoom(socket);
    const snake = room && room.snakes[socket.id];
    if (snake) snake.boosting = !!boosting;
  });

  socket.on('respawn', () => {
    const room = getRoom(socket);
    if (!room) return;
