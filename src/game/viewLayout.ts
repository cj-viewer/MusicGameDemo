/** 两个等大的 16:9 游戏视口横向并列。 */
export const VIEW_WIDTH = 1280;
export const VIEW_HEIGHT = 720;
export const MAIN_VIEW_X = 0;
export const FPV_VIEW_X = VIEW_WIDTH;
export const DUAL_VIEW_WIDTH = VIEW_WIDTH * 2;
export const DUAL_VIEW_HEIGHT = VIEW_HEIGHT;

export function isInsideMainView(x: number, y: number): boolean {
  return x >= MAIN_VIEW_X && x < MAIN_VIEW_X + VIEW_WIDTH && y >= 0 && y < VIEW_HEIGHT;
}
