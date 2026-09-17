import { clipVelocityToPlane, simulateMovement } from "./movement";
import type {
  MovementProfile,
  MovementState,
  RunInputFrame,
  RunReplay,
  RunTickEnvironment,
  RunTickOptions,
  RunTickResult,
  Vec3,
} from "./types";

const HASH_PRECISION = 100_000;

const quantize = (value: number): number =>
  Math.round((Number.isFinite(value) ? value : 0) * HASH_PRECISION);

/** A compact deterministic hash suitable for replay verification. */
export const hashMovementState = (state: Readonly<MovementState>): string => {
  const values = [
    state.tick,
    quantize(state.position.x),
    quantize(state.position.y),
    quantize(state.position.z),
    quantize(state.velocity.x),
    quantize(state.velocity.y),
    quantize(state.velocity.z),
    Number(state.grounded),
  ];
  let hash = 0x811c9dc5;
  for (const value of values) {
    let current = value | 0;
    for (let byte = 0; byte < 4; byte += 1) {
      hash ^= current & 0xff;
      hash = Math.imul(hash, 0x01000193);
      current >>= 8;
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const simulateRunTick = (
  state: Readonly<MovementState>,
  input: Readonly<RunInputFrame>,
  profile: Readonly<MovementProfile>,
  environment: RunTickEnvironment,
  options: RunTickOptions,
): RunTickResult => {
  if (input.tick !== state.tick + 1) {
    throw new Error(
      `Non-sequential replay tick: expected ${state.tick + 1}, got ${input.tick}`,
    );
  }

  const movement = simulateMovement(state, input, profile);
  const collisionResult = environment.resolveMovement(
    state,
    movement.displacement,
  );
  let velocity: Vec3 = { ...movement.velocity };
  let surfing = false;

  for (const collision of collisionResult.collisions) {
    if (
      collision.normal.y > 0.01
      && collision.normal.y < options.maxSurfNormalY
    ) {
      surfing = true;
    }
    velocity = clipVelocityToPlane(velocity, collision.normal);
  }

  const grounded = collisionResult.grounded && !surfing;
  if (grounded && velocity.y < 0) velocity.y = 0;

  const nextState: MovementState = {
    position: { ...collisionResult.position },
    velocity,
    grounded,
    tick: input.tick,
  };

  return {
    state: nextState,
    surfing,
    jumped: movement.jumped,
    stateHash: hashMovementState(nextState),
  };
};

export const createRunReplay = (
  profile: Readonly<MovementProfile>,
  frames: readonly RunInputFrame[],
  finalStateHash: string,
): RunReplay => ({
  version: 1,
  profileId: profile.id,
  tickRate: profile.tickRate,
  frames: frames.map((frame) => ({ ...frame })),
  finalStateHash,
});

export const isRunReplay = (value: unknown): value is RunReplay => {
  if (!value || typeof value !== "object") return false;
  const replay = value as Partial<RunReplay>;
  return replay.version === 1
    && typeof replay.profileId === "string"
    && Number.isFinite(replay.tickRate)
    && typeof replay.finalStateHash === "string"
    && Array.isArray(replay.frames)
    && replay.frames.length <= 250_000
    && replay.frames.every((frame, index) => {
      if (!frame || typeof frame !== "object") return false;
      const candidate = frame as Partial<RunInputFrame>;
      return candidate.tick === index + 1
        && Number.isFinite(candidate.forward)
        && Number.isFinite(candidate.side)
        && typeof candidate.jump === "boolean"
        && Number.isFinite(candidate.yaw)
        && Number.isFinite(candidate.pitch)
        && Number.isInteger(candidate.buttons);
    });
};
