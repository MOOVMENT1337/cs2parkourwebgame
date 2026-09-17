import { describe, expect, it } from "vitest";
import {
  CheckpointSystem,
  segmentIntersectsTrigger,
  type CheckpointDefinition,
  type TriggerZone,
} from "./CheckpointSystem";

const halfExtents = { x: 0.35, y: 0.9, z: 0.35 };
const trigger = (z: number): TriggerZone => ({
  center: { x: 0, y: 1, z },
  size: { x: 4, y: 4, z: 0.4 },
  direction: { x: 0, y: 0, z: -1 },
});
const checkpoints: CheckpointDefinition[] = [-10, -20].map((z, index) => ({
  id: `checkpoint-${index + 1}`,
  trigger: trigger(z),
  spawn: { x: 0, y: 1, z: z - 2 },
}));

describe("CheckpointSystem", () => {
  it("detects a swept player crossing instead of checking only Z", () => {
    expect(segmentIntersectsTrigger(
      { x: 0, y: 1, z: -9 },
      { x: 0, y: 1, z: -11 },
      trigger(-10),
      halfExtents,
    )).toBe(true);
    expect(segmentIntersectsTrigger(
      { x: 20, y: 1, z: -9 },
      { x: 20, y: 1, z: -11 },
      trigger(-10),
      halfExtents,
    )).toBe(false);
  });

  it("requires checkpoints in order and blocks an early finish", () => {
    const system = new CheckpointSystem(checkpoints, trigger(-30), halfExtents);
    expect(system.update(
      { x: 0, y: 1, z: -29 },
      { x: 0, y: 1, z: -31 },
    ).finished).toBe(false);

    expect(system.update(
      { x: 0, y: 1, z: -19 },
      { x: 0, y: 1, z: -21 },
    ).checkpoint).toBe(0);
    expect(system.update(
      { x: 0, y: 1, z: -9 },
      { x: 0, y: 1, z: -11 },
    ).checkpoint).toBe(1);
    expect(system.update(
      { x: 0, y: 1, z: -19 },
      { x: 0, y: 1, z: -21 },
    ).checkpoint).toBe(2);
    expect(system.update(
      { x: 0, y: 1, z: -29 },
      { x: 0, y: 1, z: -31 },
    ).finished).toBe(true);
  });

  it("rejects reverse crossings", () => {
    const system = new CheckpointSystem(checkpoints, trigger(-30), halfExtents);
    expect(system.update(
      { x: 0, y: 1, z: -11 },
      { x: 0, y: 1, z: -9 },
    ).checkpoint).toBe(0);
  });
});
