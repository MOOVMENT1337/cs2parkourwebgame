export type CrosshairStyle = "dot" | "cross";

export type CrosshairSettings = Readonly<{
  style: CrosshairStyle;
  color: string;
  dotSize: number;
  lineLength: number;
  thickness: number;
  gap: number;
  opacity: number;
}>;

export const CROSSHAIR_CONFIG = Object.freeze({
  default: Object.freeze<CrosshairSettings>({
    style: "dot",
    color: "#ffffff",
    dotSize: 4,
    lineLength: 9,
    thickness: 2,
    gap: 4,
    opacity: 100,
  }),
  ranges: Object.freeze({
    dotSize: Object.freeze({ min: 2, max: 12, step: 1 }),
    lineLength: Object.freeze({ min: 3, max: 24, step: 1 }),
    thickness: Object.freeze({ min: 1, max: 6, step: 1 }),
    gap: Object.freeze({ min: 0, max: 16, step: 1 }),
    opacity: Object.freeze({ min: 20, max: 100, step: 5 }),
  }),
});

export const createDefaultCrosshairSettings = (): CrosshairSettings => ({
  ...CROSSHAIR_CONFIG.default,
});
