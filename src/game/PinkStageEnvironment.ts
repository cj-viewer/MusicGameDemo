import Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH } from './displayConfig';
import {
  PINK_STAGE_PROPS,
  PINK_STAGE_SOURCE_HEIGHT,
  PINK_STAGE_SOURCE_WIDTH
} from './pinkStageProps.generated';

const TUTORIAL_BACKGROUND_KEY = 'pond-stage-background';
const PINK_STAGE_BACKGROUND_KEY = 'pink-stage-runtime-background';

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

function propTextureKey(id: number): string {
  return `pink-stage-prop-${String(id).padStart(2, '0')}`;
}

export function preloadStageEnvironments(
  scene: Phaser.Scene,
  asset: (file: string) => string
): void {
  scene.load.image(TUTORIAL_BACKGROUND_KEY, asset('images/backgrounds/pond-stage/pond-stage-background.png'));
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
    .setDepth(-20)
    .setName('pond-stage-background');

  const pinkStageBackground = scene.add
    .image(0, 0, PINK_STAGE_BACKGROUND_KEY)
    .setOrigin(0)
    .setDisplaySize(VIEW_WIDTH, VIEW_HEIGHT)
    .setDepth(-20)
    .setName('pink-stage-background');

  const pinkStageProps = PINK_STAGE_PROPS.map((prop) =>
    scene.add
      .image(
        (prop.x + prop.width / 2) * scaleX,
        (prop.y + prop.height) * scaleY,
        propTextureKey(prop.id)
      )
      .setOrigin(0.5, 1)
      .setDisplaySize(prop.width * scaleX, prop.height * scaleY)
      .setDepth(-19)
      .setName(`pink-stage-prop-${prop.id}`)
  );
  const propBaseScales = new Map<Phaser.GameObjects.Image, PropBaseScale>(
    pinkStageProps.map((prop) => [prop, { scaleX: prop.scaleX, scaleY: prop.scaleY }])
  );

  const resetPinkStageProps = (): void => {
    pinkStageProps.forEach((prop) => {
      const baseScale = propBaseScales.get(prop);
      if (!baseScale) return;
      scene.tweens.killTweensOf(prop);
      prop.setScale(baseScale.scaleX, baseScale.scaleY);
    });
  };

  const setPinkStageVisible = (visible: boolean): void => {
    pinkStageBackground.setVisible(visible);
    pinkStageProps.forEach((prop) => prop.setVisible(visible));
  };

  const controller: StageEnvironmentController = {
    showTutorial: () => {
      resetPinkStageProps();
      tutorialBackground.setVisible(true);
      setPinkStageVisible(false);
    },
    showSecondLevel: () => {
      tutorialBackground.setVisible(false);
      setPinkStageVisible(true);
    },
    pulse: (heavy) => {
      if (!pinkStageBackground.visible) return;

      const pulseScaleX = heavy ? HEAVY_PULSE_SCALE_X : LIGHT_PULSE_SCALE_X;
      const pulseScaleY = heavy ? HEAVY_PULSE_SCALE_Y : LIGHT_PULSE_SCALE_Y;
      const duration = heavy ? HEAVY_PULSE_DURATION_MS : LIGHT_PULSE_DURATION_MS;

      pinkStageProps.forEach((prop) => {
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
      });
    }
  };

  controller.showTutorial();
  return controller;
}
