export const MAIN_CAMERA_BASE_ZOOM = 0.965;
export const MAIN_CAMERA_LOOK_MAX_X = 30;
export const MAIN_CAMERA_LOOK_MAX_Y = 20;
export const MAIN_CAMERA_LOOK_DEAD_ZONE = 0.24;
export const MAIN_CAMERA_LOOK_DAMPING_MS = 220;

export const screenLayerOffset = (viewSize: number): number =>
  (viewSize - viewSize / MAIN_CAMERA_BASE_ZOOM) / 2;

