import Phaser from 'phaser';

export interface EmissiveBloomOptions {
  glowStrength?: number;
  innerStrength?: number;
  glowDistance?: number;
  glowQuality?: number;
  blurRadius?: number;
  bloomAmount?: number;
  threshold?: number;
}

export interface EmissiveBloomHandle {
  glow: Phaser.Filters.Glow | null;
  bloom: Phaser.Filters.ParallelFilters | null;
  blur: Phaser.Filters.Blur | null;
}

/**
 * 让独立攻击特效保留正常混合的实色轮廓，只在边缘外侧附加小范围 Glow / Bloom。
 * 仅用于短时可见的角色攻击特效；大量弹幕使用 MainScene 的轻量连续衰减纹理。
 */
export function enableEmissiveBloom(
  sprite: Phaser.GameObjects.Sprite,
  color: number,
  options: EmissiveBloomOptions = {}
): EmissiveBloomHandle {
  sprite
    .setBlendMode(Phaser.BlendModes.NORMAL)
    .setTintMode(Phaser.TintModes.FILL)
    .setTint(color)
    .enableFilters();

  const filters = sprite.filters;
  if (!filters) return { glow: null, bloom: null, blur: null };

  const glow = filters.internal.addGlow(
    color,
    options.glowStrength ?? 0.24,
    options.innerStrength ?? 0.04,
    1,
    false,
    options.glowQuality ?? 2,
    options.glowDistance ?? 20
  );
  glow.setPaddingOverride(null);

  const bloom = filters.internal.addParallelFilters();
  bloom.top.addThreshold(options.threshold ?? 0.08, 1);
  const blurRadius = options.blurRadius ?? 8;
  const blur = bloom.top.addBlur(2, blurRadius, blurRadius, 0.2, color, 3);
  blur.setPaddingOverride(null);
  bloom.blend.blendMode = Phaser.BlendModes.ADD;
  bloom.blend.amount = options.bloomAmount ?? 0.06;
  bloom.setPaddingOverride(null);

  return { glow, bloom, blur };
}

/** 更新会在轻 / 重攻击之间复用的自发光 Sprite 颜色。 */
export function setEmissiveBloomColor(
  sprite: Phaser.GameObjects.Sprite,
  handle: EmissiveBloomHandle,
  color: number
): void {
  sprite.setTintMode(Phaser.TintModes.FILL).setTint(color);
  if (handle.glow) handle.glow.color = color;
  if (handle.blur) handle.blur.color = color;
}
