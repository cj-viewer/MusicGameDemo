import Phaser from 'phaser';

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

/**
 * 屏幕锚定容器的子对象也必须显式设为 scrollFactor 0。
 * Phaser 渲染时会把子对象 scrollFactor 与容器相乘（1 × 0 = 0），但输入命中检测只读子对象自身的
 * scrollFactor；若保持默认 1，命中区会整体偏移一个相机 scroll（基础约 78 × 44 世界单位，并随镜头
 * 前探漂移），表现为“要把鼠标放到偏上偏左的位置才能按到滑块”。嵌套容器需递归处理。
 */
export function applyScreenLayerScrollFactor(container: Phaser.GameObjects.Container): void {
  container.setScrollFactor(0);
  container.each((child: Phaser.GameObjects.GameObject) => {
    if (child instanceof Phaser.GameObjects.Container) {
      applyScreenLayerScrollFactor(child);
    } else {
      const scrollable = child as Partial<Phaser.GameObjects.Components.ScrollFactor>;
      scrollable.setScrollFactor?.(0);
    }
  });
}
