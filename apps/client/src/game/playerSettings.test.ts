import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYER_SETTINGS,
  PLAYER_SETTINGS_KEY,
  loadPlayerSettings,
  savePlayerSettings,
  sanitizePlayerSettings,
} from "./playerSettings";

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
};

describe("player settings", () => {
  it("restores a saved versioned object", () => {
    const storage = createStorage();
    const settings = sanitizePlayerSettings({
      version: 1,
      controls: { fov: 96, sensitivity: 3.2, autoBhop: false },
      hud: { scale: 115, crosshair: { style: "cross", color: "#34d399" } },
      viewmodel: { knifeId: "knife_bowie", gloveId: "bare", offset: { x: 8, y: -3, z: 2 } },
    });
    savePlayerSettings(storage, settings);
    expect(loadPlayerSettings(storage)).toEqual(settings);
  });

  it("migrates the old flat shape and replaces invalid values", () => {
    const migrated = sanitizePlayerSettings({
      fov: 400,
      sensitivity: "bad",
      hudScale: 90,
      knifeId: "not-a-knife",
      gloveId: "bare",
      viewmodelOffset: { x: -500, y: 7, z: 9 },
    });
    expect(migrated.version).toBe(1);
    expect(migrated.controls.fov).toBe(105);
    expect(migrated.controls.sensitivity).toBe(DEFAULT_PLAYER_SETTINGS.controls.sensitivity);
    expect(migrated.hud.scale).toBe(90);
    expect(migrated.viewmodel.offset).toEqual({ x: -100, y: 7, z: 9 });
    expect(migrated.viewmodel.knifeId).toBe(DEFAULT_PLAYER_SETTINGS.viewmodel.knifeId);
  });

  it("survives malformed storage", () => {
    const storage = createStorage();
    storage.values.set(PLAYER_SETTINGS_KEY, "{broken");
    expect(loadPlayerSettings(storage)).toEqual(DEFAULT_PLAYER_SETTINGS);
  });
});
