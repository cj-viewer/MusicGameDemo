import { UI_SCALE, VIEW_HEIGHT } from './displayConfig';

/** 从旧 720p 的 0.8x 换算到 2K，保持程序化场内对象的相对屏幕占比不变。 */
export const WORLD_OBJECT_SCALE = 0.8 * UI_SCALE;

export const worldSize = (value: number): number => value * WORLD_OBJECT_SCALE;

/** TopDown 遮挡：以脚底 Y 排序，越靠屏幕下方 depth 越高。 */
export const worldDepth = (footY: number): number => 2 + Math.max(0, Math.min(VIEW_HEIGHT, footY)) / (VIEW_HEIGHT * 1.4);
