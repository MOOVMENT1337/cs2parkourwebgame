import { describe, expect, it } from "vitest";
import {
  applyFriction,
  clipVelocityToPlane,
  simulateMovement,
} from "./movement";
import { COMMUNITY_AUTOBHOP_SURF_V0 } from "./profile";
import type { MovementState } from "./types";

const createState = (overrides: Partial<MovementState> = {}): MovementState => ({
  position: { x: 0, y: 1, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  tick: 0,
  ...overrides,
});

describe("simulateMovement", () => {
  it("accelerates forward relative to camera yaw", () => {
    const result = simulateMovement(
      createState(),
      { forward: 1, side: 0, jump: false, yaw: 0 },
      COMMUNITY_AUTOBHOP_SURF_V0,
    );

    expect(result.velocity.z).toBeLessThan(0);
    expect(result.velocity.x).toBeCloseTo(0);
  });

  it("normalizes diagonal input", () => {
    const straight = simulateMovement(
      createState(),
      { forward: 1, side: 0, jump: false, yaw: 0 },
      COMMUNITY_AUTOBHOP_SURF_V0,
    );
    const diagonal = simulateMovement(
      createState(),
      { forward: 1, side: 1, jump: false, yaw: 0 },
      COMMUNITY_AUTOBHOP_SURF_V0,
    );

    expect(Math.hypot(diagonal.velocity.x, diagonal.velocity.z)).toBeCloseTo(
      Math.hypot(straight.velocity.x, straight.velocity.z),
    );
  });

  it("auto-jumps on the first eligible grounded tick", () => {
    const result = simulateMovement(
      createState(),
      { forward: 0, side: 0, jump: true, yaw: 0 },
      COMMUNITY_AUTOBHOP_SURF_V0,
    );

    expect(result.jumped).toBe(true);
    expect(result.velocity.y).toBeCloseTo(
      COMMUNITY_AUTOBHOP_SURF_V0.jumpVelocity -
        COMMUNITY_AUTOBHOP_SURF_V0.gravity /
          COMMUNITY_AUTOBHOP_SURF_V0.tickRate /
          2,
    );
  });

  it("does not apply ground friction on an auto-bhop tick", () => {
    const state = createState({ velocity: { x: 5, y: 0, z: 0 } });
    const result = simulateMovement(
      state,
      { forward: 0, side: 0, jump: true, yaw: 0 },
      COMMUNITY_AUTOBHOP_SURF_V0,
    );

    expect(result.velocity.x).toBeCloseTo(5);
  });

  it("produces deterministic output for the same input trace", () => {
    const runTrace = () => {
      let state = createState();
      for (let tick = 0; tick < 64; tick += 1) {
        const result = simulateMovement(
          state,
          { forward: 1, side: tick % 2, jump: tick === 0, yaw: tick * 0.004 },
          COMMUNITY_AUTOBHOP_SURF_V0,
        );
        state = {
          position: {
            x: state.position.x + result.displacement.x,
            y: state.position.y + result.displacement.y,
            z: state.position.z + result.displacement.z,
          },
          velocity: result.velocity,
          grounded: false,
          tick: tick + 1,
        };
      }
      return state;
    };

    expect(runTrace()).toEqual(runTrace());
  });
});

describe("applyFriction", () => {
  it("never reverses velocity while stopping", () => {
    const result = applyFriction(
      { x: 0.01, y: 2, z: 0 },
      COMMUNITY_AUTOBHOP_SURF_V0,
      1 / COMMUNITY_AUTOBHOP_SURF_V0.tickRate,
    );

    expect(result.x).toBe(0);
    expect(result.y).toBe(2);
  });
});

describe("clipVelocityToPlane", () => {
  it("preserves tangential surf speed and removes velocity into the ramp", () => {
    const inverseSqrtTwo = 1 / Math.sqrt(2);
    const normal = { x: inverseSqrtTwo, y: inverseSqrtTwo, z: 0 };
    const result = clipVelocityToPlane(
      { x: -4, y: -7, z: -8 },
      normal,
    );

    const remainingIntoPlane =
      result.x * normal.x + result.y * normal.y + result.z * normal.z;
    expect(remainingIntoPlane).toBeCloseTo(0, 7);
    expect(result.z).toBe(-8);
  });

  it("does not change velocity already moving away from a plane", () => {
    const velocity = { x: 2, y: 1, z: -5 };
    expect(clipVelocityToPlane(velocity, { x: 0, y: 1, z: 0 })).toEqual(
      velocity,
    );
  });
});
