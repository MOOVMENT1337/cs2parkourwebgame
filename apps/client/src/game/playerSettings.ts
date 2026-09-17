import {
  CROSSHAIR_CONFIG,
  createDefaultCrosshairSettings,
  type CrosshairSettings,
} from "./crosshairConfig";
import {
  DEFAULT_GLOVE_ID,
  DEFAULT_KNIFE_ID,
  GLOVE_CATALOG,
  KNIFE_CATALOG,
  type GloveId,
  type KnifeId,
} from "./viewmodelCatalog";
import {
  VIEWMODEL_POSITION_CONFIG,
  type ViewmodelPosition,
} from "./viewmodelConfig";

export const PLAYER_SETTINGS_KEY = "parkour-flow:player-settings";
export const PLAYER_SETTINGS_VERSION = 1 as const;

export type QualityLevel = "low" | "medium" | "high";

export interface PlayerSettings {
  version: typeof PLAYER_SETTINGS_VERSION;
  controls: {
    fov: number;
    sensitivity: number;
    autoBhop: boolean;
  };
  video: {
    shadows: boolean;
    pixelRatio: number;
    antialias: boolean;
    modelQuality: QualityLevel;
    textureQuality: QualityLevel;
    fpsLimit: number;
  };
  audio: {
    gameVolume: number;
  };
  hud: {
    scale: number;
    crosshair: CrosshairSettings;
  };
  viewmodel: {
    /** User offset only. The base -12/+13/+55 lives in viewmodelConfig. */
    offset: ViewmodelPosition;
    knifeId: KnifeId;
    gloveId: GloveId;
  };
}

interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const clamp = (value: unknown, minimum: number, maximum: number, fallback: number): number => {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

const boolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const quality = (value: unknown, fallback: QualityLevel): QualityLevel =>
  value === "low" || value === "medium" || value === "high" ? value : fallback;

const createDefaultSettings = (): PlayerSettings => ({
  version: PLAYER_SETTINGS_VERSION,
  controls: { fov: 82, sensitivity: 2.1, autoBhop: true },
  video: {
    shadows: true,
    pixelRatio: 1.75,
    antialias: true,
    modelQuality: "high",
    textureQuality: "high",
    fpsLimit: 0,
  },
  audio: { gameVolume: 80 },
  hud: { scale: 100, crosshair: createDefaultCrosshairSettings() },
  viewmodel: {
    offset: { ...VIEWMODEL_POSITION_CONFIG.default },
    knifeId: DEFAULT_KNIFE_ID,
    gloveId: DEFAULT_GLOVE_ID,
  },
});

export const DEFAULT_PLAYER_SETTINGS = Object.freeze(createDefaultSettings());

const sanitizeCrosshair = (value: unknown): CrosshairSettings => {
  const source = record(value);
  const fallback = CROSSHAIR_CONFIG.default;
  return {
    style: source.style === "cross" || source.style === "dot"
      ? source.style
      : fallback.style,
    color: typeof source.color === "string" && /^#[0-9a-f]{6}$/i.test(source.color)
      ? source.color
      : fallback.color,
    dotSize: clamp(source.dotSize, CROSSHAIR_CONFIG.ranges.dotSize.min, CROSSHAIR_CONFIG.ranges.dotSize.max, fallback.dotSize),
    lineLength: clamp(source.lineLength, CROSSHAIR_CONFIG.ranges.lineLength.min, CROSSHAIR_CONFIG.ranges.lineLength.max, fallback.lineLength),
    thickness: clamp(source.thickness, CROSSHAIR_CONFIG.ranges.thickness.min, CROSSHAIR_CONFIG.ranges.thickness.max, fallback.thickness),
    gap: clamp(source.gap, CROSSHAIR_CONFIG.ranges.gap.min, CROSSHAIR_CONFIG.ranges.gap.max, fallback.gap),
    opacity: clamp(source.opacity, CROSSHAIR_CONFIG.ranges.opacity.min, CROSSHAIR_CONFIG.ranges.opacity.max, fallback.opacity),
  };
};

export const sanitizePlayerSettings = (value: unknown): PlayerSettings => {
  const defaults = createDefaultSettings();
  const source = record(value);

  // Version 0 was the unversioned flat in-memory shape used during the demo.
  const controls = source.version === undefined ? source : record(source.controls);
  const video = record(source.video);
  const audio = record(source.audio);
  const hud = source.version === undefined ? source : record(source.hud);
  const viewmodel = source.version === undefined ? source : record(source.viewmodel);
  const offset = record(viewmodel.offset ?? source.viewmodelOffset);
  const knownKnifeIds = new Set<string>(KNIFE_CATALOG.map((item) => item.id));
  const knownGloveIds = new Set<string>(GLOVE_CATALOG.map((item) => item.id));
  const fpsLimit = clamp(video.fpsLimit, 0, 240, defaults.video.fpsLimit);

  return {
    version: PLAYER_SETTINGS_VERSION,
    controls: {
      fov: clamp(controls.fov, 70, 105, defaults.controls.fov),
      sensitivity: clamp(controls.sensitivity, 0.8, 4.5, defaults.controls.sensitivity),
      autoBhop: boolean(controls.autoBhop, defaults.controls.autoBhop),
    },
    video: {
      shadows: boolean(video.shadows, defaults.video.shadows),
      pixelRatio: clamp(video.pixelRatio, 0.75, 2, defaults.video.pixelRatio),
      antialias: boolean(video.antialias, defaults.video.antialias),
      modelQuality: quality(video.modelQuality, defaults.video.modelQuality),
      textureQuality: quality(video.textureQuality, defaults.video.textureQuality),
      fpsLimit: fpsLimit === 0 ? 0 : Math.round(fpsLimit),
    },
    audio: {
      gameVolume: clamp(audio.gameVolume, 0, 100, defaults.audio.gameVolume),
    },
    hud: {
      scale: clamp(hud.scale ?? source.hudScale, 85, 125, defaults.hud.scale),
      crosshair: sanitizeCrosshair(hud.crosshair ?? source.crosshair),
    },
    viewmodel: {
      offset: {
        x: clamp(offset.x, VIEWMODEL_POSITION_CONFIG.min, VIEWMODEL_POSITION_CONFIG.max, defaults.viewmodel.offset.x),
        y: clamp(offset.y, VIEWMODEL_POSITION_CONFIG.min, VIEWMODEL_POSITION_CONFIG.max, defaults.viewmodel.offset.y),
        z: clamp(offset.z, VIEWMODEL_POSITION_CONFIG.min, VIEWMODEL_POSITION_CONFIG.max, defaults.viewmodel.offset.z),
      },
      knifeId: typeof viewmodel.knifeId === "string" && knownKnifeIds.has(viewmodel.knifeId)
        ? viewmodel.knifeId as KnifeId
        : defaults.viewmodel.knifeId,
      gloveId: typeof viewmodel.gloveId === "string" && knownGloveIds.has(viewmodel.gloveId)
        ? viewmodel.gloveId as GloveId
        : defaults.viewmodel.gloveId,
    },
  };
};

export const loadPlayerSettings = (storage: SettingsStorage): PlayerSettings => {
  try {
    const serialized = storage.getItem(PLAYER_SETTINGS_KEY);
    return serialized ? sanitizePlayerSettings(JSON.parse(serialized)) : createDefaultSettings();
  } catch {
    return createDefaultSettings();
  }
};

export const savePlayerSettings = (
  storage: SettingsStorage,
  settings: PlayerSettings,
): void => {
  try {
    storage.setItem(PLAYER_SETTINGS_KEY, JSON.stringify(sanitizePlayerSettings(settings)));
  } catch {
    // Storage can be disabled or full. Settings still remain active in memory.
  }
};

export const resetPlayerSettings = (storage: SettingsStorage): PlayerSettings => {
  const defaults = createDefaultSettings();
  savePlayerSettings(storage, defaults);
  return defaults;
};
