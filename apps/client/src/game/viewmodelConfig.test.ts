import { describe, expect, it } from "vitest";
import {
  VIEWMODEL_POSITION_CONFIG,
  resolveViewmodelPosition,
} from "./viewmodelConfig";

describe("viewmodel position configuration", () => {
  it("shows zero offsets while resolving to the configured base position", () => {
    expect(VIEWMODEL_POSITION_CONFIG.default).toEqual({ x: 0, y: 0, z: 0 });

    const resolved = resolveViewmodelPosition(
      VIEWMODEL_POSITION_CONFIG.default,
    );

    expect(resolved).toEqual({
      x: VIEWMODEL_POSITION_CONFIG.base.x
        * VIEWMODEL_POSITION_CONFIG.unitsToWorld,
      y: VIEWMODEL_POSITION_CONFIG.base.y
        * VIEWMODEL_POSITION_CONFIG.unitsToWorld,
      z: VIEWMODEL_POSITION_CONFIG.base.z
        * VIEWMODEL_POSITION_CONFIG.unitsToWorld,
    });
  });

  it("adds integer slider offsets to the configured base position", () => {
    const resolved = resolveViewmodelPosition({ x: 33, y: -7, z: 100 });

    expect(resolved.x).toBeCloseTo(0.21);
    expect(resolved.y).toBeCloseTo(0.06);
    expect(resolved.z).toBeCloseTo(1.55);
  });

  it("clamps offsets before adding the configured base position", () => {
    const resolved = resolveViewmodelPosition({ x: -500, y: 500, z: 0 });

    expect(resolved.x).toBeCloseTo(-1.12);
    expect(resolved.y).toBeCloseTo(1.13);
    expect(resolved.z).toBeCloseTo(0.55);
  });
});
