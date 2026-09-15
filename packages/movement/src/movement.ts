import type {
  MovementInput,
  MovementProfile,
  MovementState,
  MovementStepResult,
  Vec3,
} from "./types";
import { clampMagnitude, dot2d, length2d } from "./vector";

/**
 * Removes the component of a velocity that points into a collision plane.
 * This is the core response used for walls and steep surf ramps. Applying it
 * successively also handles corners without turning a surf ramp into ground.
 */
export const clipVelocityToPlane = (
  velocity: Vec3,
  normal: Vec3,
  overbounce = 1,
): Vec3 => {
  const intoPlane =
    velocity.x * normal.x +
    velocity.y * normal.y +
    velocity.z * normal.z;

  if (intoPlane >= 0) {
    return { ...velocity };
  }

  const backoff = intoPlane * overbounce;
  const clipped = {
    x: velocity.x - normal.x * backoff,
    y: velocity.y - normal.y * backoff,
    z: velocity.z - normal.z * backoff,
  };

  return {
    x: Math.abs(clipped.x) < 1e-7 ? 0 : clipped.x,
    y: Math.abs(clipped.y) < 1e-7 ? 0 : clipped.y,
    z: Math.abs(clipped.z) < 1e-7 ? 0 : clipped.z,
  };
};

const normalizeInput = (forward: number, side: number): [number, number] => {
  const magnitude = Math.hypot(forward, side);
  if (magnitude <= 1) {
    return [forward, side];
  }

  return [forward / magnitude, side / magnitude];
};

const getWishVelocity = (
  input: MovementInput,
  maximumSpeed: number,
): { direction: Vec3; speed: number } => {
  const [forwardInput, sideInput] = normalizeInput(input.forward, input.side);
  const sinYaw = Math.sin(input.yaw);
  const cosYaw = Math.cos(input.yaw);

  const x = -sinYaw * forwardInput + cosYaw * sideInput;
  const z = -cosYaw * forwardInput - sinYaw * sideInput;
  const magnitude = Math.hypot(x, z);

  if (magnitude === 0) {
    return { direction: { x: 0, y: 0, z: 0 }, speed: 0 };
  }

  return {
    direction: { x: x / magnitude, y: 0, z: z / magnitude },
    speed: maximumSpeed * Math.hypot(forwardInput, sideInput),
  };
};

export const applyFriction = (
  velocity: Vec3,
  profile: MovementProfile,
  deltaSeconds: number,
): Vec3 => {
  const speed = length2d(velocity);
  if (speed < 1e-6) {
    return { x: 0, y: velocity.y, z: 0 };
  }

  const control = Math.max(speed, profile.stopSpeed);
  const droppedSpeed = control * profile.friction * deltaSeconds;
  const nextSpeed = Math.max(0, speed - droppedSpeed);
  const scale = nextSpeed / speed;

  return { x: velocity.x * scale, y: velocity.y, z: velocity.z * scale };
};

export const accelerate = (
  velocity: Vec3,
  wishDirection: Vec3,
  wishSpeed: number,
  acceleration: number,
  deltaSeconds: number,
): Vec3 => {
  const currentSpeed = dot2d(velocity, wishDirection);
  const additionalSpeed = wishSpeed - currentSpeed;
  if (additionalSpeed <= 0) {
    return { ...velocity };
  }

  const accelerationSpeed = Math.min(
    additionalSpeed,
    acceleration * wishSpeed * deltaSeconds,
  );

  return {
    x: velocity.x + accelerationSpeed * wishDirection.x,
    y: velocity.y,
    z: velocity.z + accelerationSpeed * wishDirection.z,
  };
};

export const airAccelerate = (
  velocity: Vec3,
  wishDirection: Vec3,
  uncappedWishSpeed: number,
  profile: MovementProfile,
  deltaSeconds: number,
): Vec3 => {
  const cappedWishSpeed = Math.min(
    uncappedWishSpeed,
    profile.airWishSpeedCap,
  );
  const currentSpeed = dot2d(velocity, wishDirection);
  const additionalSpeed = cappedWishSpeed - currentSpeed;

  if (additionalSpeed <= 0) {
    return { ...velocity };
  }

  const accelerationSpeed = Math.min(
    additionalSpeed,
    profile.airAccelerate * uncappedWishSpeed * deltaSeconds,
  );

  return {
    x: velocity.x + accelerationSpeed * wishDirection.x,
    y: velocity.y,
    z: velocity.z + accelerationSpeed * wishDirection.z,
  };
};

export const simulateMovement = (
  state: MovementState,
  input: MovementInput,
  profile: MovementProfile,
): MovementStepResult => {
  const deltaSeconds = 1 / profile.tickRate;
  const wish = getWishVelocity(input, profile.maxGroundSpeed);
  let velocity = { ...state.velocity };
  let jumped = false;

  if (!state.grounded) {
    velocity.y -= (profile.gravity * deltaSeconds) / 2;
  }

  if (state.grounded && input.jump) {
    velocity.y = profile.jumpVelocity;
    jumped = true;
  } else if (state.grounded) {
    velocity = applyFriction(velocity, profile, deltaSeconds);
  }

  if (state.grounded && !jumped) {
    velocity = accelerate(
      velocity,
      wish.direction,
      wish.speed,
      profile.groundAccelerate,
      deltaSeconds,
    );
    velocity.y = Math.min(velocity.y, 0);
  } else {
    velocity = airAccelerate(
      velocity,
      wish.direction,
      wish.speed,
      profile,
      deltaSeconds,
    );
    velocity.y -= (profile.gravity * deltaSeconds) / 2;
  }

  velocity = clampMagnitude(velocity, profile.maxVelocity);

  return {
    velocity,
    displacement: {
      x: velocity.x * deltaSeconds,
      y: velocity.y * deltaSeconds,
      z: velocity.z * deltaSeconds,
    },
    jumped,
  };
};
