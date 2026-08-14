import Phaser from 'phaser';
import { worldSize } from './visualScale';

/**
 * 弹幕特效使用固定深度，保证任何生成顺序下都是“线在后、点在前”。
 * 外发光使用 ADD 混合，实体核心保留 NORMAL 混合，避免高亮重叠后丢失轮廓。
 */
export const PROJECTILE_FX_DEPTH = {
  line: 3.8,
  pointGlow: 4.1,
  point: 4.2
} as const;

export type PointProjectileStyle = 'capsule' | 'orb';

function addRoundedLayer(
  gfx: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  color: number,
  alpha: number
): void {
  gfx.fillStyle(color, alpha);
  gfx.fillRoundedRect(-width / 2, -height / 2, width, height, height / 2);
}

/** 玩家直线弹：宽柔光、中层色光、饱和色实体与白色高亮核心。 */
export function createLineProjectileFx(
  scene: Phaser.Scene,
  x: number,
  y: number,
  angle: number,
  length: number,
  thickness: number,
  color: number
): Phaser.GameObjects.Container {
  const glow = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
  addRoundedLayer(glow, length + worldSize(18), thickness * 3.4, color, 0.1);
  addRoundedLayer(glow, length + worldSize(10), thickness * 2.1, color, 0.22);

  const core = scene.add.graphics();
  addRoundedLayer(core, length, thickness, color, 1);
  addRoundedLayer(core, length - worldSize(7), Math.max(worldSize(2), thickness * 0.32), 0xffffff, 0.95);

  return scene.add
    .container(x, y, [glow, core])
    .setRotation(angle)
    .setDepth(PROJECTILE_FX_DEPTH.line)
    .setSize(length + worldSize(18), thickness * 3.4);
}

/**
 * 敌方点状弹：柔光只负责亮度，实体描边负责在任何背景和线光上保持清晰前景。
 * capsule 对应青白胶囊点，orb 对应暖色圆点；后续均可直接替换为正式美术贴图。
 */
export function createPointProjectileFx(
  scene: Phaser.Scene,
  x: number,
  y: number,
  angle: number,
  color: number,
  style: PointProjectileStyle,
  scale = 1
): Phaser.GameObjects.Container {
  const glow = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
  const shell = scene.add.graphics();
  let width: number;
  let height: number;

  if (style === 'capsule') {
    width = worldSize(18) * scale;
    height = worldSize(8) * scale;
    addRoundedLayer(glow, width + worldSize(14), height + worldSize(14), color, 0.07);
    addRoundedLayer(glow, width + worldSize(8), height + worldSize(8), color, 0.2);
    addRoundedLayer(shell, width + worldSize(4), height + worldSize(4), 0x116b67, 1);
    addRoundedLayer(shell, width + worldSize(1), height + worldSize(1), color, 1);
    addRoundedLayer(shell, width - worldSize(5), Math.max(worldSize(3), height - worldSize(3)), 0xf4ffff, 1);
  } else {
    width = worldSize(12) * scale;
    height = worldSize(12) * scale;
    addRoundedLayer(glow, width + worldSize(14), height + worldSize(14), color, 0.1);
    addRoundedLayer(glow, width + worldSize(8), height + worldSize(8), color, 0.23);
    addRoundedLayer(shell, width + worldSize(5), height + worldSize(5), 0x71160e, 1);
    addRoundedLayer(shell, width + worldSize(2), height + worldSize(2), color, 1);
    addRoundedLayer(shell, Math.max(worldSize(5), width - worldSize(5)), Math.max(worldSize(5), height - worldSize(5)), 0xfff4d6, 1);
  }

  glow.setDepth(PROJECTILE_FX_DEPTH.pointGlow);
  shell.setDepth(PROJECTILE_FX_DEPTH.point);
  return scene.add
    .container(x, y, [glow, shell])
    .setRotation(angle)
    .setDepth(PROJECTILE_FX_DEPTH.point)
    .setSize(width + worldSize(18), height + worldSize(18));
}
