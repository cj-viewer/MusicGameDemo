export const GAMEPAD_STICK_DEADZONE = 0.2;

export const GAMEPAD_BUTTON = {
  dodge: 4,
  attack: 5
} as const;

export type RumbleKind = 'light' | 'heavy' | 'dodge';

export function applyStickDeadzone(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length <= GAMEPAD_STICK_DEADZONE) return { x: 0, y: 0 };
  const magnitude = Math.min(1, (length - GAMEPAD_STICK_DEADZONE) / (1 - GAMEPAD_STICK_DEADZONE));
  return { x: (x / length) * magnitude, y: (y / length) * magnitude };
}

export function rumbleParameters(kind: RumbleKind): GamepadEffectParameters {
  if (kind === 'heavy') {
    return { duration: 130, weakMagnitude: 0.65, strongMagnitude: 0.9 };
  }
  if (kind === 'dodge') {
    return { duration: 90, weakMagnitude: 0.45, strongMagnitude: 0.35 };
  }
  return { duration: 60, weakMagnitude: 0.25, strongMagnitude: 0.08 };
}
