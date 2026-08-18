/** 正式显示画布使用 2K（2560 × 1440）基准。 */
export const VIEW_WIDTH = 2560;
export const VIEW_HEIGHT = 1440;

/** 旧原型 UI 以 1280×720 排版；按 2 倍迁移到 2K 内部画布。 */
export const LEGACY_VIEW_WIDTH = 1280;
export const LEGACY_VIEW_HEIGHT = 720;
export const UI_SCALE = VIEW_WIDTH / LEGACY_VIEW_WIDTH;

export const ui = (value: number): number => value * UI_SCALE;
