import type { MovementProfile } from "./types";

const SOURCE_UNIT_METERS = 0.0254;

/**
 * Provisional profile for the first comparative prototype.
 * Values are versioned and must be replaced by captured CS2 reference traces
 * before movement fidelity can be claimed.
 */
export const COMMUNITY_AUTOBHOP_SURF_V0: MovementProfile = Object.freeze({
  id: "community-autobhop-surf-v0",
  tickRate: 64,
  maxGroundSpeed: 250 * SOURCE_UNIT_METERS,
  groundAccelerate: 5.5,
  airAccelerate: 150,
  airWishSpeedCap: 30 * SOURCE_UNIT_METERS,
  friction: 5.2,
  stopSpeed: 80 * SOURCE_UNIT_METERS,
  gravity: 800 * SOURCE_UNIT_METERS,
  jumpVelocity: 301.993 * SOURCE_UNIT_METERS,
  maxVelocity: 3500 * SOURCE_UNIT_METERS,
});

export const PLAYER_DIMENSIONS = Object.freeze({
  radius: 16 * SOURCE_UNIT_METERS,
  standingHeight: 72 * SOURCE_UNIT_METERS,
  eyeHeight: 64 * SOURCE_UNIT_METERS,
  stepHeight: 18 * SOURCE_UNIT_METERS,
});
