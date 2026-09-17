import type { Vec3 } from "@parkour/movement";

export interface TriggerZone {
  center: Vec3;
  size: Vec3;
  /** Unit-ish vector that describes the valid travel direction. */
  direction: Vec3;
}

export interface CheckpointDefinition {
  id: string;
  trigger: TriggerZone;
  spawn: Vec3;
}

export interface CheckpointUpdate {
  checkpoint: number;
  checkpointEntered: string | null;
  finished: boolean;
}

const dot = (left: Vec3, right: Vec3): number =>
  left.x * right.x + left.y * right.y + left.z * right.z;

const isInsideExpandedZone = (
  point: Vec3,
  zone: TriggerZone,
  playerHalfExtents: Vec3,
): boolean =>
  Math.abs(point.x - zone.center.x) <= zone.size.x / 2 + playerHalfExtents.x
  && Math.abs(point.y - zone.center.y) <= zone.size.y / 2 + playerHalfExtents.y
  && Math.abs(point.z - zone.center.z) <= zone.size.z / 2 + playerHalfExtents.z;

/** Slab test against a trigger expanded by the player's capsule bounds. */
export const segmentIntersectsTrigger = (
  from: Vec3,
  to: Vec3,
  zone: TriggerZone,
  playerHalfExtents: Vec3,
): boolean => {
  let minimumTime = 0;
  let maximumTime = 1;

  for (const axis of ["x", "y", "z"] as const) {
    const extent = zone.size[axis] / 2 + playerHalfExtents[axis];
    const minimum = zone.center[axis] - extent;
    const maximum = zone.center[axis] + extent;
    const origin = from[axis];
    const delta = to[axis] - origin;

    if (Math.abs(delta) < 1e-9) {
      if (origin < minimum || origin > maximum) return false;
      continue;
    }

    let near = (minimum - origin) / delta;
    let far = (maximum - origin) / delta;
    if (near > far) [near, far] = [far, near];
    minimumTime = Math.max(minimumTime, near);
    maximumTime = Math.min(maximumTime, far);
    if (minimumTime > maximumTime) return false;
  }

  return maximumTime >= 0 && minimumTime <= 1;
};

const crossesTriggerInDirection = (
  from: Vec3,
  to: Vec3,
  zone: TriggerZone,
  playerHalfExtents: Vec3,
): boolean => {
  const movement = {
    x: to.x - from.x,
    y: to.y - from.y,
    z: to.z - from.z,
  };
  return dot(movement, zone.direction) > 1e-7
    && !isInsideExpandedZone(from, zone, playerHalfExtents)
    && segmentIntersectsTrigger(from, to, zone, playerHalfExtents);
};

export class CheckpointSystem {
  private checkpoint = 0;

  public constructor(
    private readonly checkpoints: readonly CheckpointDefinition[],
    private readonly finish: TriggerZone,
    private readonly playerHalfExtents: Vec3,
  ) {}

  public get current(): number {
    return this.checkpoint;
  }

  public reset(checkpoint = 0): void {
    this.checkpoint = Math.min(
      Math.max(Math.trunc(checkpoint), 0),
      this.checkpoints.length,
    );
  }

  public update(from: Vec3, to: Vec3): CheckpointUpdate {
    const next = this.checkpoints[this.checkpoint];
    let checkpointEntered: string | null = null;

    if (
      next
      && crossesTriggerInDirection(
        from,
        to,
        next.trigger,
        this.playerHalfExtents,
      )
    ) {
      checkpointEntered = next.id;
      this.checkpoint += 1;
    }

    const finished = this.checkpoint === this.checkpoints.length
      && crossesTriggerInDirection(
        from,
        to,
        this.finish,
        this.playerHalfExtents,
      );

    return { checkpoint: this.checkpoint, checkpointEntered, finished };
  }
}
