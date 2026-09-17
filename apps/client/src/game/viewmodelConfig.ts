export type ViewmodelPosition = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export const VIEWMODEL_POSITION_CONFIG = Object.freeze({
  base: Object.freeze<ViewmodelPosition>({ x: -12, y: 13, z: 55 }),
  default: Object.freeze<ViewmodelPosition>({ x: 0, y: 0, z: 0 }),
  min: -100,
  max: 100,
  step: 1,
  unitsToWorld: 0.01,
});

export const resolveViewmodelPosition = (
  offset: ViewmodelPosition,
): ViewmodelPosition => {
  const clamp = (value: number): number =>
    Math.min(
      VIEWMODEL_POSITION_CONFIG.max,
      Math.max(VIEWMODEL_POSITION_CONFIG.min, value),
    );

  return {
    x: (VIEWMODEL_POSITION_CONFIG.base.x + clamp(offset.x))
      * VIEWMODEL_POSITION_CONFIG.unitsToWorld,
    y: (VIEWMODEL_POSITION_CONFIG.base.y + clamp(offset.y))
      * VIEWMODEL_POSITION_CONFIG.unitsToWorld,
    z: (VIEWMODEL_POSITION_CONFIG.base.z + clamp(offset.z))
      * VIEWMODEL_POSITION_CONFIG.unitsToWorld,
  };
};
