import Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH } from './displayConfig';
import {
  PINK_STAGE_PROPS,
  PINK_STAGE_SOURCE_HEIGHT,
  PINK_STAGE_SOURCE_WIDTH
} from './pinkStageProps.generated';

const TUTORIAL_BACKGROUND_KEY = 'pond-stage-background';
const PINK_STAGE_BACKGROUND_KEY = 'pink-stage-runtime-background';
/** 地图底图 → 判定框 → 环境物件 → 角色 / 战斗特效。 */
export const STAGE_MAP_DEPTH = -20;
export const STAGE_JUDGEMENT_DEPTH = -19;
const STAGE_PROP_DEPTH_BASE = -18;
const STAGE_PROP_DEPTH_RANGE = 0.5;

export interface StageEnvironmentController {
  showTutorial(): void;
  showSecondLevel(): void;
  pulse(heavy: boolean): void;
}

interface PropBaseScale {
  scaleX: number;
  scaleY: number;
}

const LIGHT_PULSE_SCALE_X = 1.003;
const LIGHT_PULSE_SCALE_Y = 1.01;
const LIGHT_PULSE_DURATION_MS = 80;
const HEAVY_PULSE_SCALE_X = 1.006;
const HEAVY_PULSE_SCALE_Y = 1.022;
const HEAVY_PULSE_DURATION_MS = 110;

// 只让场景标注确认过的独立前景物件随拍回弹；底图与其余分层物件保持静止。
const RHYTHM_PULSE_PROP_IDS = new Set<number>([
  5, 9, 17, 18, 19, 22, 25,
  26, 27, 28, 29, 30, 31, 32, 33, 34, 36
]);

function propTextureKey(id: number): string {
  return `pink-stage-prop-${String(id).padStart(2, '0')}`;
}

/** 背景物件彼此按底边排序，但整体始终处于角色与战斗层之下。 */
function stagePropDepth(footY: number): number {
  return STAGE_PROP_DEPTH_BASE + Phaser.Math.Clamp(footY / VIEW_HEIGHT, 0, 1) * STAGE_PROP_DEPTH_RANGE;
}

export function preloadStageEnvironments(
  scene: Phaser.Scene,
  asset: (file: string) => string
): void {
  scene.load.image(TUTORIAL_BACKGROUND_KEY, asset('images/backgrounds/pond-stage/pond-stage-background.png?v=11111-20260820'));
  scene.load.image(
    PINK_STAGE_BACKGROUND_KEY,
    asset('images/backgrounds/pink-stage/pink-stage-runtime-base.png')
  );
  for (const prop of PINK_STAGE_PROPS) {
    scene.load.image(propTextureKey(prop.id), asset(`images/environment/pink-stage/objects/${prop.file}`));
  }
}

export function createStageEnvironments(scene: Phaser.Scene): StageEnvironmentController {
  const scaleX = VIEW_WIDTH / PINK_STAGE_SOURCE_WIDTH;
  const scaleY = VIEW_HEIGHT / PINK_STAGE_SOURCE_HEIGHT;

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

  const pinkStageProps = PINK_STAGE_PROPS.map((prop) =>
    scene.add
      .image(
        (prop.x + prop.width / 2) * scaleX,
        (prop.y + prop.visibleBottom) * scaleY,
        propTextureKey(prop.id)
      )
      // 以真实 Alpha 可见底边为缩放锚点；透明安全边不再把主体脚底向上拉出接缝。
      .setOrigin(0.5, prop.visibleBottom / prop.height)
      .setDisplaySize(prop.width * scaleX, prop.height * scaleY)
      // 保留物件间的 TopDown 底边排序，但它们全部属于背景层，不遮挡角色。
      .setDepth(stagePropDepth((prop.y + prop.height) * scaleY))
      .setName(`pink-stage-prop-${prop.id}`)
  );
  const propBaseScales = new Map<Phaser.GameObjects.Image, PropBaseScale>(
    pinkStageProps.map((prop) => [prop, { scaleX: prop.scaleX, scaleY: prop.scaleY }])
  );
  const pulsingPinkStageProps = PINK_STAGE_PROPS.flatMap((prop, index) =>
    RHYTHM_PULSE_PROP_IDS.has(prop.id) ? [pinkStageProps[index]] : []
  );
  // 粒子花只挂在允许回弹的前景物件上，避免未框区域仍有同步缩放。
  const propBeatFlowers = pulsingPinkStageProps.map((prop) => {
    const flower = scene.add
      .container(prop.x, prop.y - prop.displayOriginY * prop.scaleY)
      .setDepth(prop.depth + 0.02)
      .setScale(0.78)
      .setAlpha(0.78)
      .setVisible(false);
    flower.add(scene.add.circle(0, 0, 3, 0xfbbf24, 0.9).setBlendMode(Phaser.BlendModes.ADD));
    for (let index = 0; index < 6; index++) {
      const angle = (Math.PI * 2 * index) / 6;
      flower.add(
        scene.add
          .rectangle(Math.cos(angle) * 9, Math.sin(angle) * 9, 14, 3, index % 2 ? 0xffffff : 0xfbbf24, 0.82)
          .setRotation(angle)
          .setBlendMode(Phaser.BlendModes.ADD)
      );
    }
    return flower;
  });
  const propBeatFlowerGlows = new Map<Phaser.GameObjects.Container, Phaser.Filters.Glow>();
  propBeatFlowers.forEach((flower) => {
    flower.enableFilters();
    const glow = flower.filters?.internal.addGlow(0xfff1ad, 1.35, 0.08, 1, false, 2, 16);
    if (!glow) return;
    glow.setPaddingOverride(null);
    propBeatFlowerGlows.set(flower, glow);
  });

  const resetPinkStageProps = (): void => {
    pinkStageProps.forEach((prop) => {
      const baseScale = propBaseScales.get(prop);
      if (!baseScale) return;
      scene.tweens.killTweensOf(prop);
      prop.setScale(baseScale.scaleX, baseScale.scaleY);
    });
    propBeatFlowers.forEach((flower) => {
      scene.tweens.killTweensOf(flower);
      flower.setScale(0.78).setAlpha(0.78);
      const glow = propBeatFlowerGlows.get(flower);
      if (glow) glow.outerStrength = 1.35;
    });
  };

  const setPinkStageVisible = (visible: boolean): void => {
    pinkStageBackground.setVisible(visible);
    pinkStageProps.forEach((prop) => prop.setVisible(visible));
    propBeatFlowers.forEach((flower) => flower.setVisible(visible));
  };

  const controller: StageEnvironmentController = {
    showTutorial: () => {
      resetPinkStageProps();
      tutorialBackground.setVisible(true);
      setPinkStageVisible(false);
    },
    showSecondLevel: () => {
      resetPinkStageProps();
      tutorialBackground.setVisible(false);
      setPinkStageVisible(true);
    },
    pulse: (heavy) => {
      if (!pinkStageBackground.visible) return;

      const pulseScaleX = heavy ? HEAVY_PULSE_SCALE_X : LIGHT_PULSE_SCALE_X;
      const pulseScaleY = heavy ? HEAVY_PULSE_SCALE_Y : LIGHT_PULSE_SCALE_Y;
      const duration = heavy ? HEAVY_PULSE_DURATION_MS : LIGHT_PULSE_DURATION_MS;

      pulsingPinkStageProps.forEach((prop, index) => {
        const baseScale = propBaseScales.get(prop);
        if (!baseScale) return;
        scene.tweens.killTweensOf(prop);
        prop.setScale(baseScale.scaleX, baseScale.scaleY);
        scene.tweens.add({
          targets: prop,
          scaleX: baseScale.scaleX * pulseScaleX,
          scaleY: baseScale.scaleY * pulseScaleY,
          duration,
          ease: 'Quad.easeOut',
          yoyo: true,
          onComplete: () => prop.setScale(baseScale.scaleX, baseScale.scaleY)
        });
        const flower = propBeatFlowers[index];
        scene.tweens.killTweensOf(flower);
        flower.setScale(0.78).setAlpha(heavy ? 1 : 0.94);
        const glow = propBeatFlowerGlows.get(flower);
        if (glow) glow.outerStrength = heavy ? 4.8 : 2.8;
        scene.tweens.add({
          targets: flower,
          scale: heavy ? 1.7 : 1.15,
          alpha: heavy ? 1 : 0.94,
          duration: heavy ? 150 : 95,
          ease: 'Quad.easeOut',
          yoyo: true,
          onComplete: () => {
            flower.setScale(0.78).setAlpha(0.78);
            if (glow) glow.outerStrength = 1.35;
          }
        });
      });
    }
  };

  controller.showTutorial();
  return controller;
}
