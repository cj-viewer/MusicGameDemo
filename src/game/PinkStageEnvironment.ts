import Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH } from './displayConfig';

const TUTORIAL_BACKGROUND_KEY = 'pond-stage-background';
const PINK_STAGE_BACKGROUND_KEY = 'pink-stage-runtime-background';
/** 地图底图 → 判定框 → 角色 / 战斗特效。 */
export const STAGE_MAP_DEPTH = -20;
export const STAGE_JUDGEMENT_DEPTH = -19;

export interface StageEnvironmentController {
  showTutorial(): void;
  showSecondLevel(): void;
  releaseTutorial(): void;
  pulse(heavy: boolean): void;
}

/**
 * 性能模式使用 1280 x 720 的静态 WebP。正式关原 35 个分层物件已离线
 * 烘入同一张纹理，不再为背景创建逐拍 Tween、Glow 或粒子对象。
 */
export function preloadStageEnvironments(
  scene: Phaser.Scene,
  asset: (file: string) => string
): void {
  scene.load.image(
    TUTORIAL_BACKGROUND_KEY,
    asset('images/backgrounds/pond-stage/pond-stage-background-1280.webp')
  );
  scene.load.image(
    PINK_STAGE_BACKGROUND_KEY,
    asset('images/backgrounds/pink-stage/pink-stage-static-1280.webp')
  );
}

export function createStageEnvironments(scene: Phaser.Scene): StageEnvironmentController {
  scene.textures.get(TUTORIAL_BACKGROUND_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
  scene.textures.get(PINK_STAGE_BACKGROUND_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);

  const tutorialBackground = scene.add
    .image(0, 0, TUTORIAL_BACKGROUND_KEY)
    .setOrigin(0)
    .setDisplaySize(VIEW_WIDTH, VIEW_HEIGHT)
    .setDepth(STAGE_MAP_DEPTH)
    .setName('pond-stage-background');

  const pinkStageBackground = scene.add
    .image(0, 0, PINK_STAGE_BACKGROUND_KEY)
    .setOrigin(0)
    .setDisplaySize(VIEW_WIDTH, VIEW_HEIGHT)
    .setDepth(STAGE_MAP_DEPTH)
    .setName('pink-stage-background');

  const controller: StageEnvironmentController = {
    showTutorial: () => {
      tutorialBackground.setVisible(true);
      pinkStageBackground.setVisible(false);
    },
    showSecondLevel: () => {
      if (tutorialBackground.active) tutorialBackground.setVisible(false);
      pinkStageBackground.setVisible(true);
    },
    releaseTutorial: () => {
      if (tutorialBackground.active) tutorialBackground.destroy();
      if (scene.textures.exists(TUTORIAL_BACKGROUND_KEY)) {
        scene.textures.remove(TUTORIAL_BACKGROUND_KEY);
      }
    },
    // 背景节拍动画在性能模式中停用；保留接口以免影响 Conductor 调用链。
    pulse: (_heavy) => {}
  };

  controller.showTutorial();
  return controller;
}
