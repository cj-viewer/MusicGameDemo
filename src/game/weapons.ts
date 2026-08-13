export type BeatKey = 'L' | 'H';

export type WeaponId = 'glowsticks' | 'baton';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** 每小节 4 拍的输入循环 */
  pattern: [BeatKey, BeatKey, BeatKey, BeatKey];
  color: number;
}

/** 扇形近战攻击 */
export interface ArcAttack {
  kind: 'arc';
  radius: number;
  /** 半张角（度），>=180 表示全圆 */
  halfArcDeg: number;
  damage: number;
  color: number;
}

/** 突进（自身位移 + 少量伤害） */
export interface DashAttack {
  kind: 'dash';
  distance: number;
  damage: number;
  color: number;
}

/** 蓄力（无伤害，仅表现） */
export interface ChargeAttack {
  kind: 'charge';
  color: number;
}

export type AttackSpec = ArcAttack | DashAttack | ChargeAttack;

export const GLOWSTICKS: WeaponDef = {
  id: 'glowsticks',
  name: '荧光棒',
  pattern: ['L', 'L', 'L', 'H'],
  color: 0x67e8f9
};

export const BATON: WeaponDef = {
  id: 'baton',
  name: '警棍',
  pattern: ['L', 'L', 'H', 'H'],
  color: 0xfbbf24
};

const LIGHT_COLOR = 0x93e6fc;
const HEAVY_COLOR = 0xfbbf24;

/** 各武器每拍的攻击行为（伤害为基础值，实际乘 ComboMeter 加成） */
const ATTACK_TABLE: Record<WeaponId, [AttackSpec, AttackSpec, AttackSpec, AttackSpec]> = {
  glowsticks: [
    { kind: 'arc', radius: 75, halfArcDeg: 45, damage: 10, color: LIGHT_COLOR },
    { kind: 'arc', radius: 75, halfArcDeg: 45, damage: 10, color: LIGHT_COLOR },
    { kind: 'arc', radius: 95, halfArcDeg: 70, damage: 22, color: HEAVY_COLOR },
    { kind: 'arc', radius: 90, halfArcDeg: 180, damage: 18, color: 0xc084fc }
  ],
  baton: [
    { kind: 'arc', radius: 85, halfArcDeg: 50, damage: 12, color: LIGHT_COLOR },
    { kind: 'charge', color: 0xffffff },
    { kind: 'dash', distance: 130, damage: 8, color: HEAVY_COLOR },
    { kind: 'arc', radius: 95, halfArcDeg: 60, damage: 26, color: HEAVY_COLOR }
  ]
};

export function getAttackSpec(id: WeaponId, beatIdx: number): AttackSpec {
  return ATTACK_TABLE[id][beatIdx % 4];
}
