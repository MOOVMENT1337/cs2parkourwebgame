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
