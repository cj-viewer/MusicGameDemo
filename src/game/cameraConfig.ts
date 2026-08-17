/** 略微收紧主场景视野，为镜头前探保留安全边距。 */
export const MAIN_CAMERA_BASE_ZOOM = 1.065;
export const MAIN_CAMERA_LOOK_MAX_X = 45;
export const MAIN_CAMERA_LOOK_MAX_Y = 30;
/**
 * 较小的死区会更早把角色接近场地边缘的移动转换成镜头前探；阻尼仍保留，
 * 因而不会变成生硬的逐帧跟随。
 */
export const MAIN_CAMERA_LOOK_DEAD_ZONE = 0.03;
export const MAIN_CAMERA_LOOK_DAMPING_MS = 220;

export const screenLayerOffset = (viewSize: number): number =>
  (viewSize - viewSize / MAIN_CAMERA_BASE_ZOOM) / 2;

