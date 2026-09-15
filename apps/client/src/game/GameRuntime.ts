import RAPIER from "@dimforge/rapier3d-compat";
import {
  COMMUNITY_AUTOBHOP_SURF_V0,
  PLAYER_DIMENSIONS,
  clipVelocityToPlane,
  length2d,
  simulateMovement,
  type MovementInput,
  type MovementState,
} from "@parkour/movement";
import * as THREE from "three";
import { buildLab, type LabDefinition } from "./buildLab";
import {
  createFirstPersonViewmodel,
  type FirstPersonViewmodel,
  type KnifeFinish,
} from "./createViewmodel";
import {
  DEFAULT_GLOVE_ID,
  DEFAULT_KNIFE_ID,
  type GloveId,
  type KnifeId,
} from "./viewmodelCatalog";

export type { KnifeFinish } from "./createViewmodel";
export type { GloveId, KnifeId } from "./viewmodelCatalog";

export type RuntimeStatus =
  | "loading"
  | "ready"
  | "running"
  | "paused"
  | "finished";

export interface RuntimeTelemetry {
  status: RuntimeStatus;
  elapsedSeconds: number;
  speedUps: number;
  verticalSpeedUps: number;
  grounded: boolean;
  surfing: boolean;
  fps: number;
  tick: number;
  checkpoint: number;
  checkpointCount: number;
  profileId: string;
  bestSeconds: number | null;
}

interface RuntimeCallbacks {
  onTelemetry: (telemetry: RuntimeTelemetry) => void;
  onStatus: (status: RuntimeStatus) => void;
}

const SOURCE_UNIT_METERS = 0.0254;
const MAX_FRAME_DELTA_SECONDS = 0.1;
const TELEMETRY_INTERVAL_SECONDS = 0.08;
const BEST_TIME_KEY = "parkour-flow:movement-lab:best";
const MAX_WALKABLE_SLOPE_RADIANS = (44 * Math.PI) / 180;
const MAX_SURF_NORMAL_Y = Math.cos(MAX_WALKABLE_SLOPE_RADIANS);

const createInitialMovementState = (
  spawn: THREE.Vector3,
): MovementState => ({
  position: { x: spawn.x, y: spawn.y, z: spawn.z },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  tick: 0,
});

export class GameRuntime {
  private readonly scene = new THREE.Scene();
  private readonly viewmodelScene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(82, 1, 0.04, 420);
  private readonly viewmodelCamera = new THREE.PerspectiveCamera(68, 1, 0.01, 10);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly pressedKeys = new Set<string>();
  private readonly callbacks: RuntimeCallbacks;
  private readonly canvas: HTMLCanvasElement;

  private world: RAPIER.World | null = null;
  private playerCollider: RAPIER.Collider | null = null;
  private characterController: RAPIER.KinematicCharacterController | null = null;
  private lab: LabDefinition | null = null;
  private viewmodel: FirstPersonViewmodel | null = null;
  private movementState: MovementState | null = null;
  private status: RuntimeStatus = "loading";
  private yaw = 0;
  private pitch = 0;
  private accumulatorSeconds = 0;
  private lastFrameSeconds = 0;
  private telemetryAccumulatorSeconds = 0;
  private elapsedTicks = 0;
  private fps = 60;
  private currentCheckpoint = 0;
  private bestSeconds: number | null = null;
  private surfing = false;
  private selectedKnifeFinish: KnifeFinish = "emerald";
  private selectedKnife: KnifeId = DEFAULT_KNIFE_ID;
  private selectedGloves: GloveId = DEFAULT_GLOVE_ID;
  private mouseSensitivity = 0.0021;
  private disposed = false;

  public constructor(canvas: HTMLCanvasElement, callbacks: RuntimeCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.bestSeconds = this.readBestTime();
    this.attachEvents();
  }

  public async initialize(): Promise<void> {
    await RAPIER.init();
    if (this.disposed) {
      return;
    }

    this.configureScene();
    await this.viewmodel?.loadAssets();
    if (this.disposed) {
      return;
    }
    this.createPhysics();
    this.resize();
    this.setStatus("ready");
    this.renderer.setAnimationLoop(this.frame);
  }

  public start = (): void => {
    if (this.status === "finished") {
      this.reset();
    }

    void this.canvas.requestPointerLock().catch(() => {
      // Embedded QA browsers may disallow Pointer Lock. Keep the simulation
      // available for keyboard smoke tests; regular Chrome uses the locked path.
      this.canvas.focus();
      this.setStatus("running");
    });
  };

  public returnToMenu = (): void => {
    this.reset();
    this.setStatus("ready");
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  };

  public setKnifeFinish = (finish: KnifeFinish): void => {
    this.selectedKnifeFinish = finish;
    this.viewmodel?.setFinish(finish);
  };

  public setKnifeModel = (knife: KnifeId): void => {
    this.selectedKnife = knife;
    void this.viewmodel?.setKnife(knife);
  };

  public setGloveModel = (gloves: GloveId): void => {
    this.selectedGloves = gloves;
    void this.viewmodel?.setGloves(gloves);
  };

  public setFov = (fov: number): void => {
    this.camera.fov = THREE.MathUtils.clamp(fov, 70, 105);
    this.camera.updateProjectionMatrix();
  };

  public setMouseSensitivity = (sensitivity: number): void => {
    this.mouseSensitivity = THREE.MathUtils.clamp(sensitivity, 0.0008, 0.0045);
  };

  public reset = (): void => {
    if (!this.lab || !this.playerCollider) {
      return;
    }

    this.movementState = createInitialMovementState(this.lab.spawn);
    this.playerCollider.setTranslation(this.movementState.position);
    this.elapsedTicks = 0;
    this.accumulatorSeconds = 0;
    this.currentCheckpoint = 0;
    this.surfing = false;
    this.yaw = 0;
    this.pitch = 0;
    this.syncCamera();
    this.emitTelemetry();
  };

  public dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.detachEvents();
    this.characterController?.free();
    this.world?.free();
    this.viewmodel?.dispose();
    this.renderer.dispose();

    for (const object of this.scene.children) {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) {
          for (const material of object.material) material.dispose();
        } else {
          object.material.dispose();
        }
      }
    }
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(0x071019);
    this.scene.fog = new THREE.FogExp2(0x071019, 0.0115);

    const hemisphere = new THREE.HemisphereLight(0x8cd7ff, 0x0b1020, 1.7);
    this.scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xc9f4ff, 3.2);
    keyLight.position.set(12, 24, 10);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -30;
    keyLight.shadow.camera.right = 30;
    keyLight.shadow.camera.top = 30;
    keyLight.shadow.camera.bottom = -180;
    this.scene.add(keyLight);

    const ambientGlow = new THREE.PointLight(0x34d399, 20, 55, 1.5);
    ambientGlow.position.set(0, 7, -76);
    this.scene.add(ambientGlow);

    this.camera.rotation.order = "YXZ";
    this.viewmodelCamera.position.set(0, 0, 0);
    this.viewmodelCamera.lookAt(0, 0, -1);
    this.viewmodelScene.add(this.viewmodelCamera);
    this.viewmodel = createFirstPersonViewmodel(
      this.selectedKnifeFinish,
      this.selectedKnife,
      this.selectedGloves,
    );
    this.viewmodelCamera.add(this.viewmodel.group);
  }

  private createPhysics(): void {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / COMMUNITY_AUTOBHOP_SURF_V0.tickRate;
    this.lab = buildLab(this.scene, this.world);

    const halfHeight =
      (PLAYER_DIMENSIONS.standingHeight - PLAYER_DIMENSIONS.radius * 2) / 2;
    const descriptor = RAPIER.ColliderDesc.capsule(
      halfHeight,
      PLAYER_DIMENSIONS.radius,
    ).setTranslation(this.lab.spawn.x, this.lab.spawn.y, this.lab.spawn.z);

    this.playerCollider = this.world.createCollider(descriptor);
    this.characterController = this.world.createCharacterController(0.00254);
    this.characterController.setSlideEnabled(true);
    this.characterController.enableAutostep(
      PLAYER_DIMENSIONS.stepHeight,
      PLAYER_DIMENSIONS.radius * 0.5,
      false,
    );
    this.characterController.enableSnapToGround(0.08);
    this.characterController.setMaxSlopeClimbAngle(MAX_WALKABLE_SLOPE_RADIANS);
    this.characterController.setMinSlopeSlideAngle((44.5 * Math.PI) / 180);

    this.world.step();
    this.reset();
  }

  private frame = (timestampMilliseconds: number): void => {
    const timestampSeconds = timestampMilliseconds / 1000;
    if (this.lastFrameSeconds === 0) {
      this.lastFrameSeconds = timestampSeconds;
    }

    const rawDeltaSeconds = timestampSeconds - this.lastFrameSeconds;
    const frameDeltaSeconds = Math.min(
      Math.max(rawDeltaSeconds, 0),
      MAX_FRAME_DELTA_SECONDS,
    );
    this.lastFrameSeconds = timestampSeconds;
    if (rawDeltaSeconds > 0) {
      const instantaneousFps = 1 / rawDeltaSeconds;
      this.fps += (instantaneousFps - this.fps) * 0.08;
    }

    if (this.status === "running") {
      const fixedDeltaSeconds = 1 / COMMUNITY_AUTOBHOP_SURF_V0.tickRate;
      this.accumulatorSeconds += frameDeltaSeconds;
      this.telemetryAccumulatorSeconds += frameDeltaSeconds;

      while (this.accumulatorSeconds >= fixedDeltaSeconds) {
        this.fixedStep();
        this.accumulatorSeconds -= fixedDeltaSeconds;
      }

      if (this.telemetryAccumulatorSeconds >= TELEMETRY_INTERVAL_SECONDS) {
        this.telemetryAccumulatorSeconds = 0;
        this.emitTelemetry();
      }
    }

    this.syncCamera();
    this.viewmodel?.update(
      timestampSeconds,
      this.movementState
        ? length2d(this.movementState.velocity) / SOURCE_UNIT_METERS
        : 0,
      this.movementState?.grounded ?? false,
      this.status === "running",
    );
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodelScene, this.viewmodelCamera);
  };

  private fixedStep(): void {
    if (
      !this.world ||
      !this.playerCollider ||
      !this.characterController ||
      !this.movementState ||
      !this.lab
    ) {
      return;
    }

    const input = this.readMovementInput();
    const result = simulateMovement(
      this.movementState,
      input,
      COMMUNITY_AUTOBHOP_SURF_V0,
    );

    this.characterController.computeColliderMovement(
      this.playerCollider,
      result.displacement,
    );
    const movement = this.characterController.computedMovement();
    const currentPosition = this.playerCollider.translation();
    const nextPosition = {
      x: currentPosition.x + movement.x,
      y: currentPosition.y + movement.y,
      z: currentPosition.z + movement.z,
    };
    this.playerCollider.setTranslation(nextPosition);

    let velocity = { ...result.velocity };
    let surfing = false;
    for (
      let index = 0;
      index < this.characterController.numComputedCollisions();
      index += 1
    ) {
      const collision = this.characterController.computedCollision(index);
      if (!collision) continue;

      const normal = collision.normal1;
      if (normal.y > 0.01 && normal.y < MAX_SURF_NORMAL_Y) {
        surfing = true;
      }
      velocity = clipVelocityToPlane(velocity, normal);
    }

    const grounded = this.characterController.computedGrounded() && !surfing;
    if (grounded && velocity.y < 0) {
      velocity.y = 0;
    }

    this.movementState = {
      position: nextPosition,
      velocity,
      grounded,
      tick: this.movementState.tick + 1,
    };
    this.surfing = surfing;
    this.elapsedTicks += 1;
    this.updateProgress();
    this.world.step();
  }

  private readMovementInput(): MovementInput {
    const forward =
      Number(this.pressedKeys.has("KeyW")) -
      Number(this.pressedKeys.has("KeyS"));
    const side =
      Number(this.pressedKeys.has("KeyD")) -
      Number(this.pressedKeys.has("KeyA"));

    return {
      forward,
      side,
      jump: this.pressedKeys.has("Space"),
      yaw: this.yaw,
    };
  }

  private updateProgress(): void {
    if (!this.movementState || !this.lab) return;

    const passedCheckpoints = this.lab.checkpoints.filter(
      (checkpoint) => this.movementState!.position.z <= checkpoint.z,
    ).length;
    this.currentCheckpoint = Math.max(
      this.currentCheckpoint,
      passedCheckpoints,
    );

    if (this.movementState.position.y < -12 || this.movementState.position.z > 22) {
      this.respawnAtCheckpoint();
      return;
    }

    if (this.movementState.position.z <= this.lab.finishZ) {
      const elapsedSeconds =
        this.elapsedTicks / COMMUNITY_AUTOBHOP_SURF_V0.tickRate;
      if (this.bestSeconds === null || elapsedSeconds < this.bestSeconds) {
        this.bestSeconds = elapsedSeconds;
        window.localStorage.setItem(BEST_TIME_KEY, String(elapsedSeconds));
      }
      this.setStatus("finished");
      document.exitPointerLock();
      this.emitTelemetry();
    }
  }

  private syncCamera(): void {
    if (!this.movementState) return;

    const centerToFeet = PLAYER_DIMENSIONS.standingHeight / 2;
    const eyeOffset = PLAYER_DIMENSIONS.eyeHeight - centerToFeet;
    this.camera.position.set(
      this.movementState.position.x,
      this.movementState.position.y + eyeOffset,
      this.movementState.position.z,
    );
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  private emitTelemetry(): void {
    const state = this.movementState;
    this.callbacks.onTelemetry({
      status: this.status,
      elapsedSeconds:
        this.elapsedTicks / COMMUNITY_AUTOBHOP_SURF_V0.tickRate,
      speedUps: state ? length2d(state.velocity) / SOURCE_UNIT_METERS : 0,
      verticalSpeedUps: state ? state.velocity.y / SOURCE_UNIT_METERS : 0,
      grounded: state?.grounded ?? false,
      surfing: this.surfing,
      fps: this.fps,
      tick: state?.tick ?? 0,
      checkpoint: this.currentCheckpoint,
      checkpointCount: this.lab?.checkpoints.length ?? 0,
      profileId: COMMUNITY_AUTOBHOP_SURF_V0.id,
      bestSeconds: this.bestSeconds,
    });
  }

  private setStatus(status: RuntimeStatus): void {
    this.status = status;
    this.callbacks.onStatus(status);
    this.emitTelemetry();
  }

  private respawnAtCheckpoint(): void {
    if (!this.lab || !this.playerCollider) return;

    const checkpoint =
      this.currentCheckpoint > 0
        ? this.lab.checkpoints[this.currentCheckpoint - 1]
        : undefined;
    const spawn = checkpoint?.spawn ?? this.lab.spawn;
    this.movementState = createInitialMovementState(spawn);
    this.playerCollider.setTranslation(this.movementState.position);
    this.accumulatorSeconds = 0;
    this.surfing = false;
    this.yaw = 0;
    this.pitch = 0;
    this.syncCamera();
    this.emitTelemetry();
  }

  private teleportToNextCheckpoint(): void {
    if (!this.lab || !this.playerCollider) return;

    const checkpointIndex = Math.min(
      this.currentCheckpoint,
      this.lab.checkpoints.length - 1,
    );
    const checkpoint = this.lab.checkpoints[checkpointIndex];
    if (!checkpoint) return;

    this.currentCheckpoint = checkpointIndex + 1;
    this.movementState = createInitialMovementState(checkpoint.spawn);
    this.playerCollider.setTranslation(this.movementState.position);
    this.accumulatorSeconds = 0;
    this.surfing = false;
    this.yaw = 0;
    this.pitch = 0;
    this.syncCamera();
    this.emitTelemetry();
  }

  private readBestTime(): number | null {
    const stored = window.localStorage.getItem(BEST_TIME_KEY);
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (["Space", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
      event.preventDefault();
    }

    if (event.code === "KeyR" && !event.repeat) {
      this.reset();
      return;
    }

    if (event.code === "KeyF" && !event.repeat && this.status === "running") {
      this.viewmodel?.inspect();
      return;
    }

    if (event.code === "KeyN" && !event.repeat && this.status === "running") {
      this.teleportToNextCheckpoint();
      return;
    }

    if (
      event.code === "Escape" &&
      !event.repeat &&
      this.status === "running" &&
      document.pointerLockElement !== this.canvas
    ) {
      this.pressedKeys.clear();
      this.setStatus("paused");
      return;
    }

    this.pressedKeys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;

    this.yaw -= event.movementX * this.mouseSensitivity;
    this.pitch -= event.movementY * this.mouseSensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    );
  };

  private onPointerLockChange = (): void => {
    const isLocked = document.pointerLockElement === this.canvas;
    if (isLocked) {
      this.lastFrameSeconds = 0;
      this.setStatus("running");
    } else if (this.status === "running") {
      this.pressedKeys.clear();
      this.setStatus("paused");
    }
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.status === "running") {
        document.exitPointerLock();
      }
      this.renderer.setAnimationLoop(null);
    } else if (!this.disposed) {
      this.lastFrameSeconds = 0;
      this.renderer.setAnimationLoop(this.frame);
    }
  };

  private resize = (): void => {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.viewmodelCamera.aspect = width / height;
    this.viewmodelCamera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private attachEvents(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("resize", this.resize);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  private detachEvents(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }
}
