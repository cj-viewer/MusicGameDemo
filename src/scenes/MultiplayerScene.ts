import Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH, ui } from '../game/displayConfig';
import { queueCoreAssets } from '../game/assetManifest';
import { createStageEnvironments, type StageEnvironmentController } from '../game/PinkStageEnvironment';
import { PLAYER_SPRITE_SCALE, PLAYER_WEAPON_SCALE, playPlayerAnimation, registerPlayerAnimations } from '../game/playerAnimation';
import { MultiplayerClient, type MultiplayerMessage, type MultiplayerWeapon, type NetworkPlayerState } from '../net/MultiplayerClient';

interface MatchData { client: MultiplayerClient; roomCode: string; playerId: number; weapon: MultiplayerWeapon; players: NetworkPlayerState[]; startAt: number; }
interface Fighter {
  id: number; weapon: MultiplayerWeapon; sprite: Phaser.GameObjects.Sprite; weaponImage: Phaser.GameObjects.Image;
  targetX: number; targetY: number; hp: number; facing: number;
}

const BPM = 132;
const BEAT_MS = 60000 / BPM;
const HIT_WINDOW_MS = 190;
const UI_FONT = 'Microsoft YaHei UI, Microsoft YaHei, PingFang SC, sans-serif';
const PANEL = 0xf0c9df;
const PANEL_LIGHT = 0xffe9f5;
const FRAME = 0x6b4b78;
const TEXT = '#4f3b63';
const CYAN = 0x4ec8c9;

function addPixelTabs(scene: Phaser.Scene, x: number, y: number, width: number, height: number, color: number, depth = 52): void {
  const tabW = ui(14);
  const tabH = ui(6);
  const dx = width / 2 - ui(28);
  const dy = height / 2 + tabH / 2;
  scene.add.rectangle(x - dx, y - dy, tabW, tabH, color, 0.92).setDepth(depth);
  scene.add.rectangle(x + dx, y - dy, tabW, tabH, color, 0.92).setDepth(depth);
  scene.add.rectangle(x - dx, y + dy, tabW, tabH, color, 0.92).setDepth(depth);
  scene.add.rectangle(x + dx, y + dy, tabW, tabH, color, 0.92).setDepth(depth);
}

export class MultiplayerScene extends Phaser.Scene {
  private client!: MultiplayerClient;
  private roomCode = '';
  private localId = 0;
  private startAt = 0;
  private fighters = new Map<number, Fighter>();
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private unsubscribe?: () => void;
  private lastStateAt = 0;
  private lastAttackBeat = -1;
  private hpBars = new Map<number, Phaser.GameObjects.Rectangle>();
  private judgement?: Phaser.GameObjects.Text;
  private beatDot?: Phaser.GameObjects.Arc;
  private environment?: StageEnvironmentController;
  private matchEnded = false;

  constructor() { super('MultiplayerScene'); }
  preload(): void { queueCoreAssets(this); }

  create(data: MatchData): void {
    this.client = data.client; this.roomCode = data.roomCode; this.localId = data.playerId; this.startAt = data.startAt;
    this.environment = createStageEnvironments(this); this.environment.showSecondLevel();
    registerPlayerAnimations(this);
    data.players.forEach((state) => this.createFighter(state));
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.wasd = this.input.keyboard?.addKeys('W,S,A,D') as Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
    this.input.keyboard?.on('keydown-Z', () => this.tryAttack(false));
    this.input.keyboard?.on('keydown-X', () => this.tryAttack(true));
    this.input.keyboard?.on('keydown-J', () => this.tryAttack(false));
    this.input.keyboard?.on('keydown-K', () => this.tryAttack(true));
    this.unsubscribe = this.client.on((message) => this.onMessage(message));
    this.createHud();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribe?.());
  }

  update(time: number, delta: number): void {
    const local = this.fighters.get(this.localId);
    if (!local || this.matchEnded) return;
    const left = this.cursors?.left.isDown || this.wasd?.left.isDown;
    const right = this.cursors?.right.isDown || this.wasd?.right.isDown;
    const up = this.cursors?.up.isDown || this.wasd?.up.isDown;
    const down = this.cursors?.down.isDown || this.wasd?.down.isDown;
    const direction = new Phaser.Math.Vector2(Number(right) - Number(left), Number(down) - Number(up));
    if (direction.lengthSq() > 0) direction.normalize();
    const speed = 350;
    local.sprite.x = Phaser.Math.Clamp(local.sprite.x + direction.x * speed * delta / 1000, ui(60), VIEW_WIDTH - ui(60));
    local.sprite.y = Phaser.Math.Clamp(local.sprite.y + direction.y * speed * delta / 1000, ui(150), VIEW_HEIGHT - ui(70));
    const opponent = [...this.fighters.values()].find((fighter) => fighter.id !== this.localId);
    if (opponent) local.facing = Phaser.Math.Angle.Between(local.sprite.x, local.sprite.y, opponent.sprite.x, opponent.sprite.y);
    local.sprite.setFlipX(Math.cos(local.facing) < 0);
    this.positionWeapon(local);
    playPlayerAnimation(local.sprite, direction.lengthSq() > 0 ? 'run' : 'idle');
    this.fighters.forEach((fighter) => {
      if (fighter.id === this.localId) return;
      fighter.sprite.x = Phaser.Math.Linear(fighter.sprite.x, fighter.targetX, Math.min(1, delta / 80));
      fighter.sprite.y = Phaser.Math.Linear(fighter.sprite.y, fighter.targetY, Math.min(1, delta / 80));
      fighter.sprite.setFlipX(Math.cos(fighter.facing) < 0);
      this.positionWeapon(fighter);
    });
    if (time - this.lastStateAt >= 50) {
      this.lastStateAt = time;
      this.client.send({ type: 'state', x: local.sprite.x, y: local.sprite.y, facing: local.facing, moving: direction.lengthSq() > 0 });
    }
    const phase = Math.max(0, Date.now() - this.startAt) % BEAT_MS;
    const pulse = 1 + 0.35 * (1 - Math.min(1, Math.min(phase, BEAT_MS - phase) / (BEAT_MS * 0.35)));
    this.beatDot?.setScale(pulse);
  }

  private createFighter(state: NetworkPlayerState): void {
    const sprite = this.add.sprite(state.x, state.y, 'player-idle-1').setScale(PLAYER_SPRITE_SCALE).setDepth(10);
    const weaponImage = this.add.image(state.x, state.y, state.weapon === 'baton' ? 'player-weapon-baton' : 'player-weapon-glowsticks')
      .setScale(PLAYER_WEAPON_SCALE).setDepth(11);
    playPlayerAnimation(sprite, 'idle');
    this.fighters.set(state.id, { id: state.id, weapon: state.weapon, sprite, weaponImage, targetX: state.x, targetY: state.y, hp: state.hp, facing: state.id === 1 ? 0 : Math.PI });
    this.add.text(state.x, state.y - ui(80), state.id === this.localId ? '你' : '对手', {
      fontFamily: UI_FONT, fontSize: ui(15) + 'px', fontStyle: 'bold', color: state.id === 1 ? '#8b6925' : '#1e7577',
      backgroundColor: '#f0c9dfdd', padding: { x: ui(6), y: ui(3) }
    }).setOrigin(0.5).setDepth(20).setData('followId', state.id);
  }

  private positionWeapon(fighter: Fighter): void {
    const side = Math.cos(fighter.facing) < 0 ? -1 : 1;
    fighter.weaponImage.setPosition(fighter.sprite.x + side * ui(24), fighter.sprite.y - ui(3)).setFlipX(side < 0).setRotation(side < 0 ? -0.2 : 0.2);
    this.children.list.forEach((child) => {
      if (child instanceof Phaser.GameObjects.Text && child.getData('followId') === fighter.id) child.setPosition(fighter.sprite.x, fighter.sprite.y - ui(80));
    });
  }

  private createHud(): void {
    this.add.rectangle(VIEW_WIDTH / 2, ui(48), VIEW_WIDTH, ui(96), PANEL, 0.72).setDepth(50);
    this.add.rectangle(VIEW_WIDTH / 2, ui(48), VIEW_WIDTH - ui(28), ui(72), 0xffffff, 0).setStrokeStyle(ui(3), FRAME, 0.72).setDepth(51);
    addPixelTabs(this, VIEW_WIDTH / 2, ui(48), VIEW_WIDTH - ui(28), ui(72), FRAME, 52);
    [1, 2].forEach((id) => {
      const x = id === 1 ? ui(60) : VIEW_WIDTH - ui(60);
      const origin = id === 1 ? 0 : 1;
      this.add.text(x, ui(20), id === 1 ? 'P1 警棍' : 'P2 荧光棒', { fontFamily: UI_FONT, fontSize: ui(17) + 'px', fontStyle: 'bold', color: id === 1 ? '#8b6925' : '#1e7577' }).setOrigin(origin, 0).setDepth(52);
      this.add.rectangle(x, ui(65), ui(430), ui(22), PANEL_LIGHT, 0.76).setOrigin(origin, 0.5).setStrokeStyle(ui(2), FRAME, 0.62).setDepth(52);
      const bar = this.add.rectangle(x, ui(65), ui(430), ui(22), id === 1 ? 0xe2b844 : CYAN).setOrigin(origin, 0.5).setDepth(53);
      this.hpBars.set(id, bar);
    });
    this.add.text(VIEW_WIDTH / 2, ui(18), '房间 ' + this.roomCode, { fontFamily: 'Consolas, Microsoft YaHei UI, sans-serif', fontSize: ui(14) + 'px', color: TEXT }).setOrigin(0.5).setDepth(52);
    this.beatDot = this.add.circle(VIEW_WIDTH / 2, ui(66), ui(12), 0xe2b844, 1).setStrokeStyle(ui(2), FRAME, 0.75).setDepth(53);
    this.add.text(VIEW_WIDTH / 2, VIEW_HEIGHT - ui(42), '方向键 / WASD 移动　Z / J 轻击　X / K 重击　攻击必须踩拍', {
      fontFamily: UI_FONT, fontSize: ui(16) + 'px', color: TEXT,
      backgroundColor: '#f0c9dfdd', padding: { x: ui(18), y: ui(8) }
    }).setOrigin(0.5).setDepth(51);
    this.judgement = this.add.text(VIEW_WIDTH / 2, ui(125), '', { fontFamily: UI_FONT, fontSize: ui(28) + 'px', fontStyle: 'bold', color: TEXT, stroke: '#fff0fa', strokeThickness: ui(2) }).setOrigin(0.5).setDepth(55);
  }

  private tryAttack(heavy: boolean): void {
    if (this.matchEnded || Date.now() < this.startAt) return;
    const elapsed = Date.now() - this.startAt;
    const beat = Math.round(elapsed / BEAT_MS);
    const offset = Math.abs(elapsed - beat * BEAT_MS);
    if (offset > HIT_WINDOW_MS || beat === this.lastAttackBeat) {
      this.showJudgement('MISS', '#fb7185');
      return;
    }
    this.lastAttackBeat = beat;
    const local = this.fighters.get(this.localId); if (!local) return;
    this.showJudgement(offset <= 70 ? 'PERFECT' : offset <= 130 ? 'GOOD' : 'POOR', offset <= 70 ? '#fde047' : '#ffffff');
    this.environment?.pulse(heavy);
    this.client.send({ type: 'attack', heavy, angle: local.facing });
  }

  private onMessage(message: MultiplayerMessage): void {
    if (message.type === 'player-state' && message.playerId !== this.localId) {
      const fighter = this.fighters.get(message.playerId ?? 0); if (!fighter) return;
      fighter.targetX = message.x ?? fighter.targetX; fighter.targetY = message.y ?? fighter.targetY; fighter.facing = message.facing ?? fighter.facing;
      playPlayerAnimation(fighter.sprite, message.moving ? 'run' : 'idle');
    } else if (message.type === 'attack' && message.playerId) {
      const fighter = this.fighters.get(message.playerId); if (fighter) this.showAttack(fighter, Boolean(message.heavy), Boolean(message.hit));
    } else if (message.type === 'health' && message.players) {
      message.players.forEach((state) => { const fighter = this.fighters.get(state.id); if (fighter) { fighter.hp = state.hp; this.hpBars.get(state.id)?.setScale(state.hp / 100, 1); } });
      const hit = this.fighters.get(message.hitPlayerId ?? 0); if (hit) this.tweens.add({ targets: hit.sprite, alpha: 0.25, duration: 70, yoyo: true, repeat: 2 });
    } else if (message.type === 'match-over') {
      this.endMatch(message.winnerId === this.localId ? '胜 利！' : '失 败', message.winnerId === this.localId ? '#fde047' : '#fb7185');
    } else if (message.type === 'opponent-left') this.endMatch('对手已离开', '#fca5a5');
  }

  private showAttack(fighter: Fighter, heavy: boolean, hit: boolean): void {
    const color = fighter.weapon === 'baton' ? 0xfbbf24 : 0x22d3ee;
    const range = fighter.weapon === 'baton' ? (heavy ? ui(160) : ui(115)) : (heavy ? ui(420) : ui(330));
    const endX = fighter.sprite.x + Math.cos(fighter.facing) * range;
    const endY = fighter.sprite.y + Math.sin(fighter.facing) * range;
    const graphics = this.add.graphics().setDepth(9);
    graphics.lineStyle(heavy ? ui(14) : ui(8), color, hit ? 1 : 0.75).lineBetween(fighter.sprite.x, fighter.sprite.y, endX, endY);
    this.tweens.add({ targets: graphics, alpha: 0, duration: heavy ? 240 : 150, onComplete: () => graphics.destroy() });
    this.tweens.add({ targets: fighter.weaponImage, angle: fighter.weaponImage.angle + (heavy ? 75 : 40), duration: 100, yoyo: true });
  }

  private showJudgement(text: string, color: string): void {
    this.judgement?.setText(text).setColor(color).setAlpha(1).setScale(1.25);
    if (!this.judgement) return;
    this.tweens.killTweensOf(this.judgement);
    this.tweens.add({ targets: this.judgement, alpha: 0, scale: 1, duration: 420 });
  }

  private endMatch(label: string, color: string): void {
    if (this.matchEnded) return; this.matchEnded = true;
    this.add.rectangle(VIEW_WIDTH / 2 + ui(6), VIEW_HEIGHT / 2 + ui(6), ui(600), ui(310), 0x2c2346, 0.32).setDepth(100);
    this.add.rectangle(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, ui(600), ui(310), PANEL, 0.96).setStrokeStyle(ui(4), FRAME, 0.92).setDepth(101);
    addPixelTabs(this, VIEW_WIDTH / 2, VIEW_HEIGHT / 2, ui(600), ui(310), FRAME, 102);
    this.add.rectangle(VIEW_WIDTH / 2, VIEW_HEIGHT / 2 - ui(125), ui(560), ui(34), PANEL_LIGHT, 0.5).setDepth(102);
    this.add.text(VIEW_WIDTH / 2, VIEW_HEIGHT / 2 - ui(60), label, { fontFamily: UI_FONT, fontSize: ui(52) + 'px', fontStyle: 'bold', color, stroke: '#fff0fa', strokeThickness: ui(2) }).setOrigin(0.5).setDepth(102);
    const back = this.add.rectangle(VIEW_WIDTH / 2, VIEW_HEIGHT / 2 + ui(70), ui(250), ui(62), CYAN, 0.9).setStrokeStyle(ui(3), 0x1e7577, 0.95).setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(back.x, back.y, '返回主菜单', { fontFamily: UI_FONT, fontSize: ui(22) + 'px', fontStyle: 'bold', color: '#174f51' }).setOrigin(0.5).setDepth(103);
    back.on('pointerdown', () => { this.client.close(); this.scene.start('IntroScene'); });
  }
}
