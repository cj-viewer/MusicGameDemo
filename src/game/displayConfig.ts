/** 正式像素素材以 1080p 为唯一内部开发基准。 */
export const VIEW_WIDTH = 1920;
export const VIEW_HEIGHT = 1080;

/** 旧原型 UI 以 1280×720 排版；按 1.5 倍迁移到 1080p 内部画布。 */
export const LEGACY_VIEW_WIDTH = 1280;
export const LEGACY_VIEW_HEIGHT = 720;
export const UI_SCALE = VIEW_WIDTH / LEGACY_VIEW_WIDTH;

export const ui = (value: number): number => value * UI_SCALE;
