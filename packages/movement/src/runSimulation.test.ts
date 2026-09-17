import { describe, expect, it } from "vitest";
import { COMMUNITY_AUTOBHOP_SURF_V0 } from "./profile";
import { hashMovementState, simulateRunTick } from "./runSimulation";
import type {
  MovementState,
  RunInputFrame,
  RunTickEnvironment,
} from "./types";

const startState = (): MovementState => ({
  position: { x: 0, y: 1, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  tick: 0,
});

const flatWorld: RunTickEnvironment = {
  resolveMovement: (state, displacement) => {
    const position = {
      x: state.position.x + displacement.x,
      y: state.position.y + displacement.y,
      z: state.position.z + displacement.z,
    };
    if (position.y <= 1) {
      position.y = 1;
      return {
        position,
        grounded: true,
        collisions: [{ normal: { x: 0, y: 1, z: 0 } }],
      };
    }
    return { position, grounded: false, collisions: [] };
  },
};

const frame = (tick: number, overrides: Partial<RunInputFrame> = {}): RunInputFrame => ({
  tick,
  forward: 1,
  side: 0,
  jump: true,
  yaw: tick * 0.002,
  pitch: 0,
  buttons: 0,
  ...overrides,
});

describe("simulateRunTick", () => {
  it("repeats at least 20 auto-bhop jumps without a release tick", () => {
    let state = startState();
    let jumps = 0;
    for (let tick = 1; tick <= 2_000 && jumps < 20; tick += 1) {
      const result = simulateRunTick(
        state,
        frame(tick),
        COMMUNITY_AUTOBHOP_SURF_V0,
        flatWorld,
        { maxSurfNormalY: 0.72 },
      );
      state = result.state;
      if (result.jumped) jumps += 1;
    }
    expect(jumps).toBe(20);
  });

  it("keeps a long air-strafe finite and within the velocity cap", () => {
    let state = startState();
    for (let tick = 1; tick <= 1_200; tick += 1) {
      const result = simulateRunTick(
        state,
        frame(tick, {
          side: tick % 2 === 0 ? 1 : -1,
          yaw: tick * 0.012,
          jump: tick === 1,
        }),
        COMMUNITY_AUTOBHOP_SURF_V0,
        flatWorld,
        { maxSurfNormalY: 0.72 },
      );
      state = result.state;
    }
    expect(Object.values(state.position).every(Number.isFinite)).toBe(true);
    expect(Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z))
      .toBeLessThanOrEqual(COMMUNITY_AUTOBHOP_SURF_V0.maxVelocity + 1e-8);
  });

  it("enters and exits a steep surf contact", () => {
    let touchingRamp = true;
    const surfWorld: RunTickEnvironment = {
      resolveMovement: (state, displacement) => ({
        position: {
          x: state.position.x + displacement.x,
          y: state.position.y + displacement.y,
          z: state.position.z + displacement.z,
        },
        grounded: touchingRamp,
        collisions: touchingRamp
          ? [{ normal: { x: 0.8, y: 0.6, z: 0 } }]
          : [],
      }),
    };
    const first = simulateRunTick(
      startState(),
      frame(1, { jump: false }),
      COMMUNITY_AUTOBHOP_SURF_V0,
      surfWorld,
      { maxSurfNormalY: 0.72 },
    );
    expect(first.surfing).toBe(true);
    expect(first.state.grounded).toBe(false);
    touchingRamp = false;
    const second = simulateRunTick(
      first.state,
      frame(2, { jump: false }),
      COMMUNITY_AUTOBHOP_SURF_V0,
      surfWorld,
      { maxSurfNormalY: 0.72 },
    );
    expect(second.surfing).toBe(false);
  });

  it.each([60, 120, 144])("produces the same state at %i render FPS", (renderFps) => {
    const targetTicks = 640;
    let state = startState();
    let accumulator = 0;
    while (state.tick < targetTicks) {
      accumulator += 1 / renderFps;
      while (
        accumulator + Number.EPSILON >= 1 / COMMUNITY_AUTOBHOP_SURF_V0.tickRate
        && state.tick < targetTicks
      ) {
        const result = simulateRunTick(
          state,
          frame(state.tick + 1, { jump: state.tick % 48 === 0 }),
          COMMUNITY_AUTOBHOP_SURF_V0,
          flatWorld,
          { maxSurfNormalY: 0.72 },
        );
        state = result.state;
        accumulator -= 1 / COMMUNITY_AUTOBHOP_SURF_V0.tickRate;
      }
    }
    expect(hashMovementState(state)).toBe("e80a33d5");
  });
});
