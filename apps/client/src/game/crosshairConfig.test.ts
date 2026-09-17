import { describe, expect, it } from "vitest";
import {
  CROSSHAIR_CONFIG,
  createDefaultCrosshairSettings,
} from "./crosshairConfig";

describe("crosshair configuration", () => {
  it("uses a visible center dot as the default crosshair", () => {
    expect(CROSSHAIR_CONFIG.default).toMatchObject({
      style: "dot",
      color: "#ffffff",
      dotSize: 4,
      opacity: 100,
    });
  });

  it("returns an independent settings object for reset", () => {
    const settings = createDefaultCrosshairSettings();

    expect(settings).toEqual(CROSSHAIR_CONFIG.default);
    expect(settings).not.toBe(CROSSHAIR_CONFIG.default);
  });
});
