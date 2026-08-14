import { UI_SCALE } from './displayConfig';

/** 从旧 720p 的 0.8x 换算到 1080p，保持程序化场内对象的屏幕视觉尺寸不变。 */
export const WORLD_OBJECT_SCALE = 0.8 * UI_SCALE;

export const worldSize = (value: number): number => value * WORLD_OBJECT_SCALE;

/** TopDown 遮挡：以脚底 Y 排序，越靠屏幕下方 depth 越高。 */
export const worldDepth = (footY: number): number => 2 + Math.max(0, Math.min(1080, footY)) / 1500;
