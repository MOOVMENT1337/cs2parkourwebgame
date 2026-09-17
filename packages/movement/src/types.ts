export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MovementInput {
  forward: number;
  side: number;
  jump: boolean;
  yaw: number;
}

export const enum RunButton {
  Forward = 1 << 0,
  Back = 1 << 1,
  Left = 1 << 2,
  Right = 1 << 3,
  Jump = 1 << 4,
  PrimaryAttack = 1 << 5,
  SecondaryAttack = 1 << 6,
  Inspect = 1 << 7,
}

export interface RunInputFrame extends MovementInput {
  tick: number;
  pitch: number;
  buttons: number;
}

export interface MovementState {
  position: Vec3;
  velocity: Vec3;
  grounded: boolean;
  tick: number;
}

export interface MovementProfile {
  id: string;
  tickRate: number;
  maxGroundSpeed: number;
  groundAccelerate: number;
  airAccelerate: number;
  airWishSpeedCap: number;
  friction: number;
  stopSpeed: number;
  gravity: number;
  jumpVelocity: number;
  maxVelocity: number;
}

export interface MovementStepResult {
  velocity: Vec3;
  displacement: Vec3;
  jumped: boolean;
}

export interface RunCollision {
  normal: Vec3;
}

export interface RunCollisionResult {
  position: Vec3;
  grounded: boolean;
  collisions: readonly RunCollision[];
}

export interface RunTickEnvironment {
  resolveMovement: (
    state: Readonly<MovementState>,
    displacement: Readonly<Vec3>,
  ) => RunCollisionResult;
}

export interface RunTickOptions {
  maxSurfNormalY: number;
}

export interface RunTickResult {
  state: MovementState;
  surfing: boolean;
  jumped: boolean;
  stateHash: string;
}

export interface RunReplay {
  version: 1;
  profileId: string;
  tickRate: number;
  frames: RunInputFrame[];
  finalStateHash: string;
}
