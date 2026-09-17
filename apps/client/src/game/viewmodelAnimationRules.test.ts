import { describe, expect, it } from "vitest";
import {
  chooseCs2InspectIndex,
  chooseCs2LightMissIndex,
  chooseHeldKnifeAttack,
} from "./viewmodelAnimationRules";

describe("CS2 knife animation selection", () => {
  it("selects two light misses with equal 50/50 weight", () => {
    expect(chooseCs2LightMissIndex(2, 0)).toBe(0);
    expect(chooseCs2LightMissIndex(2, 0.499999)).toBe(0);
    expect(chooseCs2LightMissIndex(2, 0.5)).toBe(1);
    expect(chooseCs2LightMissIndex(2, 0.999999)).toBe(1);
  });

  it("uses 2/3 and 1/3 weights for two inspect variants", () => {
    expect(chooseCs2InspectIndex(2, 2 / 3 - 0.000001)).toBe(0);
    expect(chooseCs2InspectIndex(2, 2 / 3)).toBe(1);
  });

  it("uses 1/2, 1/4 and 1/4 weights for three inspect variants", () => {
    expect(chooseCs2InspectIndex(3, 0.499999)).toBe(0);
    expect(chooseCs2InspectIndex(3, 0.5)).toBe(1);
    expect(chooseCs2InspectIndex(3, 0.749999)).toBe(1);
    expect(chooseCs2InspectIndex(3, 0.75)).toBe(2);
  });

  it("continues the knife combo while the primary button is held", () => {
    expect(chooseHeldKnifeAttack(true, false)).toBe("primary");
    expect(chooseHeldKnifeAttack(false, true)).toBe("secondary");
    expect(chooseHeldKnifeAttack(false, false)).toBeNull();
  });
});
