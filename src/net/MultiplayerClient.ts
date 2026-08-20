export type MultiplayerWeapon = 'baton' | 'glowsticks';
export interface NetworkPlayerState { id: number; weapon: MultiplayerWeapon; x: number; y: number; hp: number; }
export interface MultiplayerMessage { type: string; roomCode?: string; playerId?: number; weapon?: MultiplayerWeapon; players?: NetworkPlayerState[]; startAt?: number; x?: number; y?: number; facing?: number; moving?: boolean; heavy?: boolean; angle?: number; hit?: boolean; hitPlayerId?: number; damage?: number; winnerId?: number; message?: string; }

export class MultiplayerClient {
  private socket?: WebSocket;
  private listeners = new Set<(message: MultiplayerMessage) => void>();
  readonly url: string;
  constructor(url = import.meta.env.VITE_MULTIPLAYER_WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8080`) { this.url = url; }
  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url); this.socket = socket;
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('无法连接多人服务器')), { once: true });
      socket.addEventListener('message', (event) => { try { const message = JSON.parse(String(event.data)) as MultiplayerMessage; this.listeners.forEach((listener) => listener(message)); } catch { /* ignore malformed server packet */ } });
    });
  }
  on(listener: (message: MultiplayerMessage) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  send(message: Record<string, unknown>): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  createRoom(): void { this.send({ type: 'create-room' }); }
  joinRoom(roomCode: string): void { this.send({ type: 'join-room', roomCode }); }
  close(): void { this.socket?.close(); this.socket = undefined; }
}