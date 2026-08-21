import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const rooms = new Map();
const clients = new Map();
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const send = (ws, payload) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); };
const broadcast = (room, payload) => room.players.forEach((player) => send(player.ws, payload));
const roomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
};
const publicPlayers = (room) => room.players.map(({ id, weapon, x, y, hp }) => ({ id, weapon, x, y, hp }));

function leave(ws) {
  const info = clients.get(ws);
  clients.delete(ws);
  if (!info) return;
  const room = rooms.get(info.roomCode);
  if (!room) return;
  room.players = room.players.filter((p) => p.ws !== ws);
  if (room.players.length === 0) rooms.delete(info.roomCode);
  else {
    room.started = false;
    broadcast(room, { type: 'opponent-left' });
  }
}

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  send(ws, { type: 'connected' });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === 'create-room') {
      leave(ws);
      const code = roomCode();
      const room = { code, players: [], started: false };
      const player = { ws, id: 1, weapon: 'baton', x: 620, y: 720, hp: 100, lastAttackAt: 0 };
      room.players.push(player); rooms.set(code, room); clients.set(ws, { roomCode: code, playerId: 1 });
      send(ws, { type: 'room-created', roomCode: code, playerId: 1, weapon: 'baton', players: publicPlayers(room) });
      return;
    }
    if (msg.type === 'join-room') {
      leave(ws);
      const code = String(msg.roomCode || '').toUpperCase();
      const room = rooms.get(code);
      if (!room || room.players.length >= 2) { send(ws, { type: 'error', message: !room ? '房间不存在' : '房间已满' }); return; }
      const player = { ws, id: 2, weapon: 'glowsticks', x: 1940, y: 720, hp: 100, lastAttackAt: 0 };
      room.players.push(player); clients.set(ws, { roomCode: code, playerId: 2 });
      send(ws, { type: 'room-joined', roomCode: code, playerId: 2, weapon: 'glowsticks', players: publicPlayers(room) });
      room.started = true;
      broadcast(room, { type: 'match-start', roomCode: code, startAt: Date.now() + 1800, players: publicPlayers(room) });
      return;
    }
    const info = clients.get(ws); if (!info) return;
    const room = rooms.get(info.roomCode); if (!room || !room.started) return;
    const player = room.players.find((p) => p.id === info.playerId); if (!player) return;
    if (msg.type === 'state') {
      player.x = clamp(Number(msg.x) || player.x, 100, 2460);
      player.y = clamp(Number(msg.y) || player.y, 120, 1320);
      broadcast(room, { type: 'player-state', playerId: player.id, x: player.x, y: player.y, facing: Number(msg.facing) || 0, moving: Boolean(msg.moving) });
      return;
    }
    if (msg.type === 'attack') {
      const now = Date.now(); if (now - player.lastAttackAt < 140) return; player.lastAttackAt = now;
      const target = room.players.find((p) => p.id !== player.id); if (!target || target.hp <= 0) return;
      const dx = target.x - player.x, dy = target.y - player.y, distance = Math.hypot(dx, dy);
      const attackAngle = Number(msg.angle) || 0;
      const delta = Math.atan2(Math.sin(Math.atan2(dy, dx) - attackAngle), Math.cos(Math.atan2(dy, dx) - attackAngle));
      const heavy = Boolean(msg.heavy);
      const maxRange = player.weapon === 'baton' ? (heavy ? 250 : 190) : (heavy ? 720 : 620);
      const halfArc = player.weapon === 'baton' ? (heavy ? 1.25 : 0.9) : 0.42;
      const hit = distance <= maxRange && Math.abs(delta) <= halfArc;
      broadcast(room, { type: 'attack', playerId: player.id, heavy, angle: attackAngle, hit });
      if (!hit) return;
      const damage = player.weapon === 'baton' ? (heavy ? 24 : 16) : (heavy ? 18 : 10);
      target.hp = Math.max(0, target.hp - damage);
      broadcast(room, { type: 'health', players: publicPlayers(room), hitPlayerId: target.id, damage });
      if (target.hp <= 0) { room.started = false; broadcast(room, { type: 'match-over', winnerId: player.id }); }
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});
console.log(`MusicGameDemo multiplayer server listening on ws://127.0.0.1:${PORT}`);