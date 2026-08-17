import Phaser from 'phaser';
import { PLAYER_ANIMATION_ASSETS, playerAssetPath, playerTextureKey } from './playerAnimation';
import {
  FAN_ATTACK_EFFECT_FRAMES,
  FAN_CHARACTER_FRAME_COUNT,
  fanAttackEffectAssetPath,
  fanAttackEffectTextureKey,
  fanCharacterAssetPath,
  fanCharacterTextureKey
} from './fanAnimation';
import {
  GUARD_ATTACK_EFFECT_FRAMES,
  guardAttackEffectAssetPath,
  guardAttackEffectTextureKey
} from './guardAnimation';
import { BGM_TRACKS, DEFAULT_TUTORIAL_BGM_SLOT, bgmAssetPath, type BgmTrack } from './bgmTracks';
import { preloadStageEnvironments } from './PinkStageEnvironment';

const asset = (file: string): string => `${import.meta.env.BASE_URL}assets/${file}`;

/**
 * 进入教学关之前必须就绪的资源：全部贴图、打击音效、以及教学关默认使用的那一首 BGM。
 * Loader 会跳过缓存里已有的 key，所以同一批资源可以在 IntroScene 先排队预热，
 * MainScene.preload() 再调用一次时基本全是缓存命中。
 */
export function queueCoreAssets(scene: Phaser.Scene): void {
  preloadStageEnvironments(scene, asset);
  scene.load.image('guard', asset('images/characters/guard.png'));
  for (const action of ['idle', 'run'] as const) {
    for (let frame = 1; frame <= FAN_CHARACTER_FRAME_COUNT; frame++) {
      scene.load.image(
        fanCharacterTextureKey(action, frame),
        asset(fanCharacterAssetPath(action, frame))
      );
    }
  }
  for (const effect of ['attack-light', 'attack-hard'] as const) {
    for (const frame of FAN_ATTACK_EFFECT_FRAMES[effect]) {
      scene.load.image(
        fanAttackEffectTextureKey(effect, frame),
        asset(fanAttackEffectAssetPath(effect, frame))
      );
    }
  }
  for (const effect of ['attack-light', 'attack-hard'] as const) {
    for (const frame of GUARD_ATTACK_EFFECT_FRAMES[effect]) {
      scene.load.image(
        guardAttackEffectTextureKey(effect, frame),
        asset(guardAttackEffectAssetPath(effect, frame))
      );
    }
  }
  for (const spec of PLAYER_ANIMATION_ASSETS) {
    for (let frame = 1; frame <= spec.frameCount; frame++) {
      scene.load.image(playerTextureKey(spec.action, frame), asset(playerAssetPath(spec, frame)));
    }
  }
  scene.load.image('player-weapon-glowsticks', asset('images/weapons/light_stick/player/light_stick_player.png'));
  scene.load.image('player-weapon-baton', asset('images/weapons/baton/player/baton_player01.png'));
  scene.load.image(
    'npc-fan-weapon-glowstick',
    asset('images/weapons/light_stick/npc_fan01/light_stick_fan01.png')
  );
  scene.load.audio('beat-light', asset('audio/sfx/sfx-beat-light.mp3'));
  scene.load.audio('beat-heavy', asset('audio/sfx/sfx-beat-heavy.mp3'));
  queueBgmTrack(scene, BGM_TRACKS[DEFAULT_TUTORIAL_BGM_SLOT]);
}

/**
 * 教学关用不到的 BGM。它们合计几十 MB，放在开场/教学阶段后台慢慢下，
 * 不再阻塞 MainScene 的 preload。
 */
export function queueDeferredBgm(scene: Phaser.Scene): void {
  for (let slot = 0; slot < BGM_TRACKS.length; slot++) {
    if (slot === DEFAULT_TUTORIAL_BGM_SLOT) continue;
    queueBgmTrack(scene, BGM_TRACKS[slot]);
  }
}

/** 单独排队某一首 BGM（用于把玩家当前需要的曲目提到前面）。 */
export function queueBgmTrack(scene: Phaser.Scene, track: BgmTrack): void {
  if (scene.cache.audio.exists(track.key)) return;
  scene.load.audio(track.key, asset(bgmAssetPath(track)));
}

/** 在不打断当前 Scene 的前提下，让排队中的资源开始下载。 */
export function startBackgroundLoad(scene: Phaser.Scene): void {
  if (!scene.load.isLoading()) scene.load.start();
}
