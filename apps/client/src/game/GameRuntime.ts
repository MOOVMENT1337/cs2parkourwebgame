import RAPIER from "@dimforge/rapier3d-compat";
import {
  COMMUNITY_AUTOBHOP_SURF_V0,
  PLAYER_DIMENSIONS,
  RunButton,
  createRunReplay,
  isRunReplay,
  length2d,
  type MovementState,
  type RunInputFrame,
  type RunReplay,
  simulateRunTick,
  type Vec3,
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
import {
  VIEWMODEL_POSITION_CONFIG,
  resolveViewmodelPosition,
  type ViewmodelPosition,
} from "./viewmodelConfig";
import { CheckpointSystem } from "./CheckpointSystem";

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

export interface RuntimeOptions {
  fov?: number;
  mouseSensitivity?: number;
  autoBhop?: boolean;
  shadows?: boolean;
  pixelRatio?: number;
  antialias?: boolean;
  fpsLimit?: number;
  gameVolume?: number;
  knifeId?: KnifeId;
  gloveId?: GloveId;
  knifeFinish?: KnifeFinish;
  viewmodelOffset?: ViewmodelPosition;
}

const SOURCE_UNIT_METERS = 0.0254;
const MAX_FRAME_DELTA_SECONDS = 0.1;
const TELEMETRY_INTERVAL_SECONDS = 0.08;
const BEST_TIME_KEY = "parkour-flow:movement-lab:best";
const LAST_REPLAY_KEY = "parkour-flow:movement-lab:last-replay";
const MAX_WALKABLE_SLOPE_RADIANS = (44 * Math.PI) / 180;
const MAX_SURF_NORMAL_Y = Math.cos(MAX_WALKABLE_SLOPE_RADIANS);

const createInitialMovementState = (
  spawn: Vec3,
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
  private checkpointSystem: CheckpointSystem | null = null;
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
  private selectedKnifeFinish: KnifeFinish = "default";
  private selectedKnife: KnifeId = DEFAULT_KNIFE_ID;
  private selectedGloves: GloveId = DEFAULT_GLOVE_ID;
  private viewmodelOffset: ViewmodelPosition = {
    ...VIEWMODEL_POSITION_CONFIG.default,
  };
  private mouseSensitivity = 0.0021;
  private autoBhop = true;
  private jumpQueued = false;
  private fpsLimit = 0;
  private gameVolume = 0.8;
  private lastRenderSeconds = 0;
  private replayFrames: RunInputFrame[] = [];
  private playbackFrames: readonly RunInputFrame[] | null = null;
  private lastReplay: RunReplay | null = null;
  private primaryAttackHeld = false;
  private secondaryAttackHeld = false;
  private inspectHeld = false;
  private disposed = false;

  public constructor(
    canvas: HTMLCanvasElement,
    callbacks: RuntimeCallbacks,
    options: RuntimeOptions = {},
  ) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.selectedKnife = options.knifeId ?? this.selectedKnife;
    this.selectedGloves = options.gloveId ?? this.selectedGloves;
    this.selectedKnifeFinish = options.knifeFinish ?? this.selectedKnifeFinish;
    this.viewmodelOffset = options.viewmodelOffset
      ? { ...options.viewmodelOffset }
      : this.viewmodelOffset;
    this.mouseSensitivity = THREE.MathUtils.clamp(
      options.mouseSensitivity ?? this.mouseSensitivity,
      0.0008,
      0.0045,
    );
    this.autoBhop = options.autoBhop ?? this.autoBhop;
    this.fpsLimit = options.fpsLimit ?? this.fpsLimit;
    this.gameVolume = THREE.MathUtils.clamp(
      options.gameVolume ?? this.gameVolume,
      0,
      1,
    );
    this.camera.fov = THREE.MathUtils.clamp(options.fov ?? 82, 70, 105);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: options.antialias ?? true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(
      window.devicePixelRatio,
      options.pixelRatio ?? 1.75,
    ));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = options.shadows ?? true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.bestSeconds = this.readBestTime();
    this.lastReplay = this.readLastReplay();
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

  public setKnifeModel = async (knife: KnifeId): Promise<void> => {
    this.selectedKnife = knife;
    await this.viewmodel?.setKnife(knife);
  };

  public setGloveModel = async (gloves: GloveId): Promise<void> => {
    this.selectedGloves = gloves;
    await this.viewmodel?.setGloves(gloves);
  };

  public setFov = (fov: number): void => {
    this.camera.fov = THREE.MathUtils.clamp(fov, 70, 105);
    this.camera.updateProjectionMatrix();
  };

  public setMouseSensitivity = (sensitivity: number): void => {
    this.mouseSensitivity = THREE.MathUtils.clamp(sensitivity, 0.0008, 0.0045);
  };

  public setAutoBhop = (enabled: boolean): void => {
    this.autoBhop = enabled;
    this.jumpQueued = false;
  };

  public setGameVolume = (volume: number): void => {
    this.gameVolume = THREE.MathUtils.clamp(volume, 0, 1);
  };

  public setGraphics = (options: {
    shadows?: boolean;
    pixelRatio?: number;
    fpsLimit?: number;
  }): void => {
    if (options.shadows !== undefined) {
      this.renderer.shadowMap.enabled = options.shadows;
    }
    if (options.pixelRatio !== undefined) {
      this.renderer.setPixelRatio(Math.min(
        window.devicePixelRatio,
        THREE.MathUtils.clamp(options.pixelRatio, 0.75, 2),
      ));
      this.resize();
    }
    if (options.fpsLimit !== undefined) {
      this.fpsLimit = Math.max(0, Math.round(options.fpsLimit));
      this.lastRenderSeconds = 0;
    }
  };

  public setViewmodelOffset = (x: number, y: number, z: number): void => {
    this.viewmodelOffset = { x, y, z };
    const position = resolveViewmodelPosition(this.viewmodelOffset);
    this.viewmodel?.setOffset(position.x, position.y, position.z);
  };

  public reset = (): void => {
    if (!this.lab || !this.playerCollider) {
      return;
    }

    this.movementState = createInitialMovementState(this.lab.spawn);
    this.playerCollider.setTranslation(this.movementState.position);
    this.elapsedTicks = 0;
    this.accumulatorSeconds = 0;
    this.lastRenderSeconds = 0;
    this.currentCheckpoint = 0;
    this.checkpointSystem?.reset();
    this.surfing = false;
    this.jumpQueued = false;
    this.replayFrames = [];
    this.playbackFrames = null;
    this.yaw = 0;
    this.pitch = 0;
    this.syncCamera();
    this.emitTelemetry();
  };

  public playLastReplay = (): boolean => {
    if (!this.lastReplay || this.lastReplay.profileId !== COMMUNITY_AUTOBHOP_SURF_V0.id) {
      return false;
    }
    this.reset();
    this.playbackFrames = this.lastReplay.frames;
    this.setStatus("running");
    return true;
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
    this.setViewmodelOffset(
      this.viewmodelOffset.x,
      this.viewmodelOffset.y,
      this.viewmodelOffset.z,
    );
  }

  private createPhysics(): void {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / COMMUNITY_AUTOBHOP_SURF_V0.tickRate;
    this.lab = buildLab(this.scene, this.world);
    this.checkpointSystem = new CheckpointSystem(
      this.lab.checkpoints,
      this.lab.finish,
      {
        x: PLAYER_DIMENSIONS.radius,
        y: PLAYER_DIMENSIONS.standingHeight / 2,
        z: PLAYER_DIMENSIONS.radius,
      },
    );

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

    if (
      this.fpsLimit > 0
      && this.lastRenderSeconds > 0
      && timestampSeconds - this.lastRenderSeconds < 1 / this.fpsLimit
    ) {
      return;
    }
    this.lastRenderSeconds = timestampSeconds;

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

    const previousPosition = { ...this.movementState.position };
    const input = this.playbackFrames
      ? this.playbackFrames[this.movementState.tick]
      : this.readMovementInput();
    if (!input) {
      this.playbackFrames = null;
      this.setStatus("paused");
      return;
    }

    if (this.playbackFrames) {
      this.yaw = input.yaw;
      this.pitch = input.pitch;
    } else {
      this.replayFrames.push(input);
    }

    const result = simulateRunTick(
      this.movementState,
      input,
      COMMUNITY_AUTOBHOP_SURF_V0,
      {
        resolveMovement: (_state, displacement) => {
          this.characterController!.computeColliderMovement(
            this.playerCollider!,
            displacement,
          );
          const movement = this.characterController!.computedMovement();
          const currentPosition = this.playerCollider!.translation();
          const collisions = [];
          for (
            let index = 0;
            index < this.characterController!.numComputedCollisions();
            index += 1
          ) {
            const collision = this.characterController!.computedCollision(index);
            if (collision) collisions.push({ normal: { ...collision.normal1 } });
          }
          return {
            position: {
              x: currentPosition.x + movement.x,
              y: currentPosition.y + movement.y,
              z: currentPosition.z + movement.z,
            },
            grounded: this.characterController!.computedGrounded(),
            collisions,
          };
        },
      },
      { maxSurfNormalY: MAX_SURF_NORMAL_Y },
    );

    this.playerCollider.setTranslation(result.state.position);
    this.movementState = result.state;
    this.surfing = result.surfing;
    this.elapsedTicks += 1;
    this.updateProgress(previousPosition, result.state.position, result.stateHash);
    this.world.step();
  }

  private readMovementInput(): RunInputFrame {
    const forward =
      Number(this.pressedKeys.has("KeyW")) -
      Number(this.pressedKeys.has("KeyS"));
    const side =
      Number(this.pressedKeys.has("KeyD")) -
      Number(this.pressedKeys.has("KeyA"));

    const jump = this.autoBhop
      ? this.pressedKeys.has("Space")
      : this.jumpQueued;
    this.jumpQueued = false;
    let buttons = 0;
    if (this.pressedKeys.has("KeyW")) buttons |= RunButton.Forward;
    if (this.pressedKeys.has("KeyS")) buttons |= RunButton.Back;
    if (this.pressedKeys.has("KeyA")) buttons |= RunButton.Left;
    if (this.pressedKeys.has("KeyD")) buttons |= RunButton.Right;
    if (jump) buttons |= RunButton.Jump;
    if (this.primaryAttackHeld) buttons |= RunButton.PrimaryAttack;
    if (this.secondaryAttackHeld) buttons |= RunButton.SecondaryAttack;
    if (this.inspectHeld) buttons |= RunButton.Inspect;

    return {
      tick: (this.movementState?.tick ?? 0) + 1,
      forward,
      side,
      jump,
      yaw: this.yaw,
      pitch: this.pitch,
      buttons,
    };
  }

  private updateProgress(from: Vec3, to: Vec3, stateHash: string): void {
    if (!this.movementState || !this.lab || !this.checkpointSystem) return;

    const progress = this.checkpointSystem.update(from, to);
    this.currentCheckpoint = progress.checkpoint;

    if (this.movementState.position.y < -12 || this.movementState.position.z > 22) {
      this.respawnAtCheckpoint();
      return;
    }

    if (progress.finished) {
      const elapsedSeconds =
        this.elapsedTicks / COMMUNITY_AUTOBHOP_SURF_V0.tickRate;
      if (this.bestSeconds === null || elapsedSeconds < this.bestSeconds) {
        this.bestSeconds = elapsedSeconds;
        window.localStorage.setItem(BEST_TIME_KEY, String(elapsedSeconds));
      }
      this.finishReplay(stateHash);
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
    if (status !== "running") this.clearAttackInput();
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
    this.checkpointSystem?.reset(this.currentCheckpoint);
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

  private readLastReplay(): RunReplay | null {
    try {
      const stored = window.localStorage.getItem(LAST_REPLAY_KEY);
      if (!stored) return null;
      const replay = JSON.parse(stored) as unknown;
      return isRunReplay(replay)
        && replay.profileId === COMMUNITY_AUTOBHOP_SURF_V0.id
        && replay.tickRate === COMMUNITY_AUTOBHOP_SURF_V0.tickRate
        ? replay
        : null;
    } catch {
      return null;
    }
  }

  private finishReplay(stateHash: string): void {
    if (this.playbackFrames) {
      if (this.lastReplay && this.lastReplay.finalStateHash !== stateHash) {
        console.warn(
          "Replay verification failed",
          { expected: this.lastReplay.finalStateHash, actual: stateHash },
        );
      }
      this.playbackFrames = null;
      return;
    }

    const replay = createRunReplay(
      COMMUNITY_AUTOBHOP_SURF_V0,
      this.replayFrames,
      stateHash,
    );
    this.lastReplay = replay;
    try {
      window.localStorage.setItem(LAST_REPLAY_KEY, JSON.stringify(replay));
    } catch {
      // A long run can exceed storage quota. In-memory replay remains usable.
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (["Space", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
      event.preventDefault();
    }

    if (event.code === "KeyR" && !event.repeat) {
      this.reset();
      return;
    }

    if (event.code === "Space" && !event.repeat) {
      this.jumpQueued = true;
    }

    if (event.code === "KeyF" && !event.repeat && this.status === "running") {
      event.preventDefault();
      this.inspectHeld = true;
      this.viewmodel?.setInspectHeld(true);
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
    if (event.code === "KeyF") {
      this.inspectHeld = false;
      this.viewmodel?.setInspectHeld(false);
    }
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

  private onMouseDown = (event: MouseEvent): void => {
    if (this.status !== "running") return;
    if (event.button !== 0 && event.button !== 2) return;

    event.preventDefault();
    if (event.button === 0) {
      this.primaryAttackHeld = true;
      this.viewmodel?.attackPrimary();
    } else {
      this.secondaryAttackHeld = true;
      this.viewmodel?.attackSecondary();
    }
    this.syncAttackHeldState();
  };

  private onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.primaryAttackHeld = false;
    else if (event.button === 2) this.secondaryAttackHeld = false;
    else return;

    this.syncAttackHeldState();
  };

  private onContextMenu = (event: MouseEvent): void => {
    if (this.status === "running") event.preventDefault();
  };

  private onPointerLockChange = (): void => {
    const isLocked = document.pointerLockElement === this.canvas;
    if (isLocked) {
      this.lastFrameSeconds = 0;
      this.setStatus("running");
    } else if (this.status === "running") {
      this.pressedKeys.clear();
      this.clearAttackInput();
      this.setStatus("paused");
    }
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.status === "running") {
        this.clearAttackInput();
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
    window.addEventListener("mouseup", this.onMouseUp);
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("resize", this.resize);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  private detachEvents(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  private syncAttackHeldState(): void {
    this.viewmodel?.setAttackHeld(
      this.primaryAttackHeld,
      this.secondaryAttackHeld,
    );
  }

  private clearAttackInput(): void {
    this.primaryAttackHeld = false;
    this.secondaryAttackHeld = false;
    this.inspectHeld = false;
    this.syncAttackHeldState();
    this.viewmodel?.setInspectHeld(false);
  }
}
