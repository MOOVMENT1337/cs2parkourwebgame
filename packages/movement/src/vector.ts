import type { Vec3 } from "./types";

export const length2d = (value: Vec3): number =>
  Math.hypot(value.x, value.z);

export const dot2d = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.z * b.z;

export const clampMagnitude = (value: Vec3, maximum: number): Vec3 => {
  const magnitude = Math.hypot(value.x, value.y, value.z);
  if (magnitude <= maximum || magnitude === 0) {
    return { ...value };
  }

  const scale = maximum / magnitude;
  return {
    x: value.x * scale,
    y: value.y * scale,
    z: value.z * scale,
  };
};
