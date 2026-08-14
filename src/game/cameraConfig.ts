export const MAIN_CAMERA_BASE_ZOOM = 1;
export const MAIN_CAMERA_LOOK_MAX_X = 45;
export const MAIN_CAMERA_LOOK_MAX_Y = 30;
export const MAIN_CAMERA_LOOK_DEAD_ZONE = 0.12;
export const MAIN_CAMERA_LOOK_DAMPING_MS = 220;

export const screenLayerOffset = (viewSize: number): number =>
  (viewSize - viewSize / MAIN_CAMERA_BASE_ZOOM) / 2;

