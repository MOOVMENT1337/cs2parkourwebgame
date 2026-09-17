const clampRoll = (roll: number): number =>
  Math.min(1 - Number.EPSILON, Math.max(0, roll));

export const chooseCs2LightMissIndex = (
  variantCount: number,
  roll: number,
): number => {
  if (variantCount <= 1) return 0;
  return Math.floor(clampRoll(roll) * variantCount);
};

export const chooseCs2InspectIndex = (
  variantCount: number,
  roll: number,
): number => {
  if (variantCount <= 1) return 0;
  const normalizedRoll = clampRoll(roll);

  if (variantCount === 2) return normalizedRoll < 2 / 3 ? 0 : 1;
  return normalizedRoll < 1 / 2 ? 0 : normalizedRoll < 3 / 4 ? 1 : 2;
};

export const chooseHeldKnifeAttack = (
  primaryHeld: boolean,
  secondaryHeld: boolean,
): "primary" | "secondary" | null => {
  if (primaryHeld) return "primary";
  if (secondaryHeld) return "secondary";
  return null;
};
