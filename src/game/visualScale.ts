/** 战斗区内角色、武器、弹幕、掉落和对应场内特效的统一视觉 / 判定尺寸倍率。 */
export const WORLD_OBJECT_SCALE = 0.8;

export const worldSize = (value: number): number => value * WORLD_OBJECT_SCALE;

/** TopDown 遮挡：以脚底 Y 排序，越靠屏幕下方 depth 越高。 */
export const worldDepth = (footY: number): number => 2 + Math.max(0, Math.min(720, footY)) / 1000;
