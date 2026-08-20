import Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH, ui } from '../game/displayConfig';
import { MultiplayerClient, type MultiplayerMessage, type MultiplayerWeapon, type NetworkPlayerState } from '../net/MultiplayerClient';

interface MatchStartData {
  client: MultiplayerClient;
  roomCode: string;
  playerId: number;
  weapon: MultiplayerWeapon;
  players: NetworkPlayerState[];
  startAt: number;
}

export class MultiplayerLobbyScene extends Phaser.Scene {
  private client?: MultiplayerClient;
  private statusText?: Phaser.GameObjects.Text;
  private roomText?: Phaser.GameObjects.Text;
  private code = '';
  private localPlayerId = 0;
  private weapon: MultiplayerWeapon = 'baton';
  private unsubscribe?: () => void;
  private transitioning = false;

  constructor() { super('MultiplayerLobbyScene'); }

  create(): void {
    this.cameras.main.setBackgroundColor('#080b1b');
    this.add.rectangle(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, VIEW_WIDTH, VIEW_HEIGHT, 0x11152d);
    this.add.circle(ui(220), ui(150), ui(300), 0x8b2d72, 0.18);
    this.add.circle(VIEW_WIDTH - ui(160), VIEW_HEIGHT - ui(100), ui(360), 0x14b8a6, 0.14);
    this.add.text(VIEW_WIDTH / 2, ui(118), '双 人 联 机', {
      fontFamily: 'Microsoft YaHei UI, sans-serif', fontSize: ui(48) + 'px', fontStyle: 'bold', color: '#fff7dc'
    }).setOrigin(0.5);
    this.add.text(VIEW_WIDTH / 2, ui(172), '两台浏览器输入同一个房间码 · 房主警棍 / 加入者荧光棒', {
      fontFamily: 'Microsoft YaHei UI, sans-serif', fontSize: ui(18) + 'px', color: '#b9c4e4'
    }).setOrigin(0.5);

    this.makeButton(VIEW_WIDTH / 2, ui(300), '创建房间', () => this.createRoom());
    this.roomText = this.add.text(VIEW_WIDTH / 2, ui(405), '房间码：-----', {
      fontFamily: 'Consolas, Microsoft YaHei UI, sans-serif', fontSize: ui(36) + 'px', fontStyle: 'bold', color: '#67e8f9',
      backgroundColor: '#080b1bcc', padding: { x: ui(28), y: ui(14) }
    }).setOrigin(0.5);

    this.add.text(VIEW_WIDTH / 2, ui(510), '输入房间码后加入', {
      fontFamily: 'Microsoft YaHei UI, sans-serif', fontSize: ui(17) + 'px', color: '#e5e7eb'
    }).setOrigin(0.5);
    const codeBox = this.add.rectangle(VIEW_WIDTH / 2 - ui(100), ui(570), ui(250), ui(58), 0x171c36, 0.95)
      .setStrokeStyle(ui(2), 0x8b5cf6, 1);
    const codeText = this.add.text(codeBox.x, codeBox.y, '点击后键盘输入', {
      fontFamily: 'Consolas, Microsoft YaHei UI, sans-serif', fontSize: ui(24) + 'px', color: '#ffffff'
    }).setOrigin(0.5);
    codeBox.setInteractive({ useHandCursor: true }).on('pointerdown', () => codeText.setText(this.code || '_____'));
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (/^[a-z0-9]$/i.test(event.key) && this.code.length < 5) this.code += event.key.toUpperCase();
      else if (event.key === 'Backspace') this.code = this.code.slice(0, -1);
      codeText.setText(this.code.padEnd(5, '_'));
    });
    this.makeButton(VIEW_WIDTH / 2 + ui(180), ui(570), '加入房间', () => this.joinRoom());
    this.makeButton(ui(120), VIEW_HEIGHT - ui(70), '返回主菜单', () => this.back(), ui(190));

    this.statusText = this.add.text(VIEW_WIDTH / 2, ui(680), '正在连接联机服务器…', {
      fontFamily: 'Microsoft YaHei UI, sans-serif', fontSize: ui(20) + 'px', color: '#fef3c7'
    }).setOrigin(0.5);
    this.connect();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      if (!this.transitioning) this.client?.close();
    });
  }

  private makeButton(x: number, y: number, label: string, action: () => void, width = ui(250)): void {
    const button = this.add.rectangle(x, y, width, ui(62), 0x6d285d, 0.9).setStrokeStyle(ui(2), 0xf8d9ec, 0.9)
      .setInteractive({ useHandCursor: true });
    this.add.text(x, y, label, { fontFamily: 'Microsoft YaHei UI, sans-serif', fontSize: ui(22) + 'px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
    button.on('pointerover', () => button.setFillStyle(0x9d3c7c, 1)).on('pointerout', () => button.setFillStyle(0x6d285d, 0.9)).on('pointerdown', action);
  }

  private async connect(): Promise<void> {
    this.client = new MultiplayerClient();
    this.unsubscribe = this.client.on((message) => this.onMessage(message));
    try {
      await this.client.connect();
      this.statusText?.setText('服务器已连接，可以创建或加入房间').setColor('#86efac');
    } catch {
      this.statusText?.setText('无法连接联机服务器，请先运行 npm run multiplayer:server').setColor('#fca5a5');
    }
  }

  private createRoom(): void { this.statusText?.setText('正在创建房间…'); this.client?.createRoom(); }
  private joinRoom(): void {
    if (this.code.length !== 5) { this.statusText?.setText('请输入 5 位房间码').setColor('#fca5a5'); return; }
    this.statusText?.setText('正在加入房间…'); this.client?.joinRoom(this.code);
  }

  private onMessage(message: MultiplayerMessage): void {
    if (message.type === 'room-created' || message.type === 'room-joined') {
      this.localPlayerId = message.playerId ?? 0;
      this.weapon = message.weapon ?? 'baton';
      this.roomText?.setText('房间码：' + message.roomCode);
      this.statusText?.setText(message.type === 'room-created' ? '等待另一位玩家加入…' : '已加入，准备开战！').setColor('#fef3c7');
    } else if (message.type === 'error') {
      this.statusText?.setText(message.message ?? '联机发生错误').setColor('#fca5a5');
    } else if (message.type === 'match-start' && message.roomCode && message.players && message.startAt && this.client) {
      this.transitioning = true;
      const data: MatchStartData = { client: this.client, roomCode: message.roomCode, playerId: this.localPlayerId, weapon: this.weapon, players: message.players, startAt: message.startAt };
      this.scene.start('MultiplayerScene', data);
    }
  }

  private back(): void { this.client?.close(); this.scene.start('IntroScene'); }
}
