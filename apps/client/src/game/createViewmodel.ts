import * as THREE from "three";
import {
  DEFAULT_GLOVE_ID,
  DEFAULT_KNIFE_ID,
  getGloveModelUrl,
  getGloveSleeveUrl,
  getKnifeModelUrl,
  type GloveId,
  type KnifeId,
} from "./viewmodelCatalog";
import {
  chooseCs2InspectIndex,
  chooseCs2LightMissIndex,
  chooseHeldKnifeAttack,
} from "./viewmodelAnimationRules";
import {
  loadCachedJson,
  loadFbxModel,
  loadGltfModel,
} from "./viewmodelLoader";

export type KnifeFinish = "default" | "emerald" | "amber" | "violet";

const FINISH_COLORS: Record<
  Exclude<KnifeFinish, "default">,
  { blade: number; accent: number }
> = {
  emerald: { blade: 0x76e6c2, accent: 0x10b981 },
  amber: { blade: 0xffcb70, accent: 0xf59e0b },
  violet: { blade: 0xc4a8ff, accent: 0x8b5cf6 },
};

const prepareViewmodelMesh = (mesh: THREE.Mesh): void => {
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  for (const material of materials) {
    // World depth is cleared before this scene is rendered. Keeping depth on
    // here gives correct self-occlusion between fingers, handle and blade.
    material.depthTest = true;
    material.depthWrite = true;
    if ("fog" in material) material.fog = false;
  }
};

const disposeObjectResources = (root: THREE.Object3D): void => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of objectMaterials) materials.add(material);
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
};

const frameImportedArms = (arms: THREE.Group): void => {
  arms.position.set(0, 0, 0);
  arms.rotation.set(0, Math.PI, 0);
  arms.scale.setScalar(1);
  arms.updateMatrixWorld(true);

  const initialBounds = new THREE.Box3().setFromObject(arms, true);
  if (initialBounds.isEmpty()) return;

  const initialSize = initialBounds.getSize(new THREE.Vector3());
  const scaleByWidth = initialSize.x > 0 ? 0.92 / initialSize.x : 1;
  const scaleByHeight = initialSize.y > 0 ? 0.56 / initialSize.y : 1;
  const fittedScale = Math.min(scaleByWidth, scaleByHeight, 1.15);
  arms.scale.setScalar(fittedScale);
  arms.updateMatrixWorld(true);

  const fittedCenter = new THREE.Box3()
    .setFromObject(arms, true)
    .getCenter(new THREE.Vector3());
  arms.position.add(
    new THREE.Vector3(0.12, -0.4, -0.94).sub(fittedCenter),
  );
};

const retargetSleeveToArms = (
  sleeve: THREE.Group,
  arms: THREE.Group,
): void => {
  const targetBones = new Map<string, THREE.Bone>();
  arms.traverse((object) => {
    if (object instanceof THREE.Bone) targetBones.set(object.name, object);
  });

  sleeve.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const sourceSkeleton = object.skeleton;
    const mappedBones = sourceSkeleton.bones.map((sourceBone) => {
      const targetBone = targetBones.get(sourceBone.name);
      if (!targetBone) {
        throw new Error(`CT sleeve bone not found on arms rig: ${sourceBone.name}`);
      }
      return targetBone;
    });
    const mappedSkeleton = new THREE.Skeleton(
      mappedBones,
      sourceSkeleton.boneInverses.map((matrix) => matrix.clone()),
    );
    object.bind(mappedSkeleton, object.bindMatrix.clone());
    prepareViewmodelMesh(object);
  });

  // The sleeve scene still contains its original helper skeleton after the
  // mesh is rebound. Rename those bones so animation binding and hand lookup
  // cannot confuse them with the active arms rig.
  sleeve.traverse((object) => {
    if (object instanceof THREE.Bone) object.name = `ct_sleeve_source_${object.name}`;
  });

  sleeve.name = "ct-sleeve";
  arms.add(sleeve);
};

type ViewmodelAnimationKind =
  | "idle"
  | "draw"
  | `inspect${number}Start`
  | `inspect${number}Loop`
  | `inspect${number}End`
  | `light${number}`
  | `heavy${number}`;
type KnifeAttackType = "primary" | "secondary";

const isAttackAnimation = (
  kind: ViewmodelAnimationKind | null,
): boolean =>
  kind?.startsWith("light") === true || kind?.startsWith("heavy") === true;

const isInspectAnimation = (
  kind: ViewmodelAnimationKind | null,
): boolean => kind?.startsWith("inspect") === true;

const isInspectStartAnimation = (
  kind: ViewmodelAnimationKind | null,
): boolean => /^inspect\d+Start$/.test(kind ?? "");

const isInspectLoopAnimation = (
  kind: ViewmodelAnimationKind | null,
): boolean => /^inspect\d+Loop$/.test(kind ?? "");

const isInspectEndAnimation = (
  kind: ViewmodelAnimationKind | null,
): boolean => /^inspect\d+End$/.test(kind ?? "");

interface SerializedAnimationTrack {
  node: string;
  property: "position" | "quaternion";
  times: number[];
  values: number[];
}

interface SerializedAnimationClip {
  name: ViewmodelAnimationKind;
  duration: number;
  tracks: SerializedAnimationTrack[];
}

interface SerializedViewmodelAnimations {
  version: 1;
  source: string;
  clips: Record<string, SerializedAnimationClip>;
}

interface TargetAnimationClips {
  arms: THREE.AnimationClip;
  knife: THREE.AnimationClip;
}

interface TargetAnimationActions {
  arms: THREE.AnimationAction;
  knife: THREE.AnimationAction;
}

interface InspectAnimationSet {
  start: ViewmodelAnimationKind;
  loop: ViewmodelAnimationKind;
  end: ViewmodelAnimationKind;
}

const loadViewmodelAnimations = async (
  id: KnifeId,
): Promise<SerializedViewmodelAnimations> => {
  const requiredClips: ViewmodelAnimationKind[] = [
    "idle",
    "draw",
    "inspect1Start",
    "inspect1Loop",
    "inspect1End",
    "light1",
    "heavy1",
  ];
  const isAnimationDocument = (
    value: unknown,
  ): value is SerializedViewmodelAnimations => {
    if (!value || typeof value !== "object") return false;
    const document = value as Partial<SerializedViewmodelAnimations>;
    if (
      document.version !== 1
      || document.source !== id
      || !document.clips
      || requiredClips.some((kind) => !document.clips?.[kind])
    ) return false;

    let keyframeCount = 0;
    return Object.values(document.clips).every((clip) => {
      if (
        !clip
        || typeof clip.name !== "string"
        || !Number.isFinite(clip.duration)
        || clip.duration <= 0
        || !Array.isArray(clip.tracks)
        || clip.tracks.length > 512
      ) return false;
      return clip.tracks.every((track) => {
        if (
          !track
          || typeof track.node !== "string"
          || (track.property !== "position" && track.property !== "quaternion")
          || !Array.isArray(track.times)
          || !Array.isArray(track.values)
          || !track.times.every(Number.isFinite)
          || !track.values.every(Number.isFinite)
        ) return false;
        const valuesPerKey = track.property === "quaternion" ? 4 : 3;
        keyframeCount += track.times.length;
        return keyframeCount <= 250_000
          && track.values.length === track.times.length * valuesPerKey;
      });
    });
  };

  return loadCachedJson(
    `/assets/viewmodels/cs2/animations/${id}.json`,
    24 * 1024 * 1024,
    isAnimationDocument,
  );
};

const createAnimationClip = (
  source: SerializedAnimationClip,
  acceptsNode: (node: string) => boolean,
  suffix: string,
): THREE.AnimationClip => {
  const tracks = source.tracks
    .filter((track) => acceptsNode(track.node))
    .map((track) => {
      const trackName = `${track.node}.${track.property}`;
      return track.property === "quaternion"
        ? new THREE.QuaternionKeyframeTrack(
            trackName,
            track.times,
            track.values,
          )
        : new THREE.VectorKeyframeTrack(trackName, track.times, track.values);
    });
  return new THREE.AnimationClip(`${source.name}-${suffix}`, source.duration, tracks);
};

interface FactoryKnifeMaterialState {
  color?: number;
  emissive?: number;
  emissiveIntensity?: number;
}

const rememberFactoryKnifeMaterial = (material: THREE.Material): void => {
  if (material.userData.factoryKnifeMaterial) return;

  const state: FactoryKnifeMaterialState = {};
  if ("color" in material && material.color instanceof THREE.Color) {
    state.color = material.color.getHex();
  }
  if ("emissive" in material && material.emissive instanceof THREE.Color) {
    state.emissive = material.emissive.getHex();
  }
  if (
    "emissiveIntensity" in material
    && typeof material.emissiveIntensity === "number"
  ) {
    state.emissiveIntensity = material.emissiveIntensity;
  }
  material.userData.factoryKnifeMaterial = state;
};

const applyImportedKnifeFinish = (
  root: THREE.Object3D,
  finish: KnifeFinish,
): void => {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      rememberFactoryKnifeMaterial(material);
      const factory = material.userData
        .factoryKnifeMaterial as FactoryKnifeMaterialState;

      if (finish === "default") {
        if (
          factory.color !== undefined
          && "color" in material
          && material.color instanceof THREE.Color
        ) {
          material.color.setHex(factory.color);
        }
        if (
          factory.emissive !== undefined
          && "emissive" in material
          && material.emissive instanceof THREE.Color
        ) {
          material.emissive.setHex(factory.emissive);
        }
        if (
          factory.emissiveIntensity !== undefined
          && "emissiveIntensity" in material
        ) {
          material.emissiveIntensity = factory.emissiveIntensity;
        }
        continue;
      }

      const colors = FINISH_COLORS[finish];
      if ("color" in material && material.color instanceof THREE.Color) {
        material.color.setHex(colors.blade);
      }
      if ("emissive" in material && material.emissive instanceof THREE.Color) {
        material.emissive.setHex(colors.accent);
      }
    }
  });
};

const createGlovedArm = (
  side: "left" | "right",
  sleeveMaterial: THREE.MeshStandardMaterial,
  gloveMaterial: THREE.MeshStandardMaterial,
  plateMaterial: THREE.MeshStandardMaterial,
): THREE.Group => {
  const direction = side === "left" ? -1 : 1;
  const arm = new THREE.Group();
  arm.position.set(direction * 0.43, -0.55, -0.72);
  arm.rotation.set(-0.55, 0, direction * 0.23);

  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.082, 0.115, 0.62, 16),
    sleeveMaterial,
  );
  sleeve.position.y = -0.04;
  prepareViewmodelMesh(sleeve);
  arm.add(sleeve);

  const cuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.096, 0.1, 0.12, 16),
    plateMaterial,
  );
  cuff.position.y = 0.29;
  prepareViewmodelMesh(cuff);
  arm.add(cuff);

  const palm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.056, 0.16, 5, 12),
    gloveMaterial,
  );
  palm.position.set(direction * 0.008, 0.415, -0.012);
  palm.scale.set(0.9, 1, 0.7);
  palm.rotation.z = direction * -0.07;
  prepareViewmodelMesh(palm);
  arm.add(palm);

  const knucklePlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.048, 0.025),
    plateMaterial,
  );
  knucklePlate.position.set(direction * 0.005, 0.49, -0.054);
  knucklePlate.rotation.z = direction * -0.06;
  prepareViewmodelMesh(knucklePlate);
  arm.add(knucklePlate);

  for (const fingerOffset of [-0.039, -0.013, 0.013, 0.039]) {
    const finger = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.014, 0.052, 3, 7),
      gloveMaterial,
    );
    finger.position.set(fingerOffset, 0.55, -0.008);
    finger.rotation.x = -0.16;
    finger.rotation.z = direction * -0.035;
    prepareViewmodelMesh(finger);
    arm.add(finger);
  }

  const thumb = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.026, 0.065, 4, 9),
    gloveMaterial,
  );
  thumb.position.set(direction * -0.057, 0.415, -0.012);
  thumb.rotation.z = direction * 0.72;
  prepareViewmodelMesh(thumb);
  arm.add(thumb);

  return arm;
};

const createBladeGeometry = (): THREE.ExtrudeGeometry => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.052, 0.16);
  shape.lineTo(0.055, 0.19);
  shape.lineTo(0.088, 0.61);
  shape.lineTo(0.004, 0.82);
  shape.lineTo(-0.064, 0.58);
  shape.closePath();

  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.026,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.007,
    bevelThickness: 0.006,
  });
};

export interface FirstPersonViewmodel {
  group: THREE.Group;
  loadAssets: () => Promise<void>;
  setKnife: (id: KnifeId) => Promise<void>;
  setGloves: (id: GloveId) => Promise<void>;
  setFinish: (finish: KnifeFinish) => void;
  setOffset: (x: number, y: number, z: number) => void;
  setInspectHeld: (held: boolean) => void;
  attackPrimary: () => void;
  attackSecondary: () => void;
  setAttackHeld: (primary: boolean, secondary: boolean) => void;
  update: (
    elapsedSeconds: number,
    horizontalSpeedUps: number,
    grounded: boolean,
    running: boolean,
  ) => void;
  dispose: () => void;
}

export const createFirstPersonViewmodel = (
  initialFinish: KnifeFinish,
  initialKnife: KnifeId = DEFAULT_KNIFE_ID,
  initialGloves: GloveId = DEFAULT_GLOVE_ID,
): FirstPersonViewmodel => {
  const group = new THREE.Group();
  group.name = "first-person-viewmodel";
  group.position.set(0, -0.045, 0);

  const proceduralArms = new THREE.Group();
  proceduralArms.name = "procedural-arms-fallback";
  group.add(proceduralArms);

  const sleeveMaterial = new THREE.MeshStandardMaterial({
    color: 0x20364a,
    roughness: 0.9,
    metalness: 0.02,
  });
  const gloveMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a2530,
    roughness: 0.7,
    metalness: 0.08,
  });
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: 0x344959,
    roughness: 0.62,
    metalness: 0.18,
  });

  const leftArm = createGlovedArm(
    "left",
    sleeveMaterial,
    gloveMaterial,
    plateMaterial,
  );
  leftArm.position.x -= 0.04;
  leftArm.position.y -= 0.035;
  leftArm.position.z -= 0.045;
  proceduralArms.add(leftArm);

  const rightArm = createGlovedArm(
    "right",
    sleeveMaterial,
    gloveMaterial,
    plateMaterial,
  );
  rightArm.position.x -= 0.045;
  rightArm.position.y -= 0.01;
  proceduralArms.add(rightArm);

  const handleMaterial = new THREE.MeshStandardMaterial({
    color: 0x0c1218,
    roughness: 0.56,
    metalness: 0.38,
  });
  const initialColors = initialFinish === "default"
    ? { blade: 0xb9c0c5, accent: 0x38434b }
    : FINISH_COLORS[initialFinish];
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: initialColors.accent,
    emissive: initialColors.accent,
    emissiveIntensity: 0.48,
    roughness: 0.36,
    metalness: 0.5,
  });
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: initialColors.blade,
    emissive: initialColors.accent,
    emissiveIntensity: 0.1,
    roughness: 0.22,
    metalness: 0.86,
  });

  const proceduralKnife = new THREE.Group();
  proceduralKnife.name = "procedural-knife-fallback";
  proceduralKnife.position.set(0.29, -0.31, -0.91);
  proceduralKnife.rotation.set(-0.08, -0.12, -0.15);
  group.add(proceduralKnife);

  const blade = new THREE.Mesh(createBladeGeometry(), bladeMaterial);
  blade.position.z = -0.013;
  prepareViewmodelMesh(blade);
  proceduralKnife.add(blade);

  const bladeSpine = new THREE.Mesh(
    new THREE.BoxGeometry(0.028, 0.42, 0.04),
    accentMaterial,
  );
  bladeSpine.position.set(-0.047, 0.39, 0.008);
  bladeSpine.rotation.z = 0.018;
  prepareViewmodelMesh(bladeSpine);
  proceduralKnife.add(bladeSpine);

  const handle = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.048, 0.22, 5, 12),
    handleMaterial,
  );
  handle.position.y = 0.01;
  prepareViewmodelMesh(handle);
  proceduralKnife.add(handle);

  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.045, 0.072),
    accentMaterial,
  );
  guard.position.y = 0.17;
  guard.rotation.z = -0.03;
  prepareViewmodelMesh(guard);
  proceduralKnife.add(guard);

  const pommel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.052, 0.058, 12),
    accentMaterial,
  );
  pommel.position.y = -0.165;
  prepareViewmodelMesh(pommel);
  proceduralKnife.add(pommel);

  for (const y of [-0.075, -0.025, 0.025, 0.075]) {
    const gripBand = new THREE.Mesh(
      new THREE.TorusGeometry(0.052, 0.007, 5, 12),
      plateMaterial,
    );
    gripBand.position.y = y;
    gripBand.rotation.x = Math.PI / 2;
    prepareViewmodelMesh(gripBand);
    proceduralKnife.add(gripBand);
  }

  const fillLight = new THREE.HemisphereLight(0xd8f3ff, 0x0d1721, 2.2);
  group.add(fillLight);
  const keyLight = new THREE.PointLight(0xe2f7ff, 4.5, 3, 1.3);
  keyLight.position.set(-0.2, 0.55, 0.15);
  group.add(keyLight);

  let importedArms: THREE.Group | null = null;
  let framedArms: THREE.Group | null = null;
  let importedArmsMixer: THREE.AnimationMixer | null = null;
  let importedKnife: THREE.Group | null = null;
  let importedKnifeMixer: THREE.AnimationMixer | null = null;
  let importedAnimations: SerializedViewmodelAnimations | null = null;
  let targetAnimationClips: Partial<
    Record<ViewmodelAnimationKind, TargetAnimationClips>
  > = {};
  let activeAnimationActions: TargetAnimationActions | null = null;
  let activeAnimationKind: ViewmodelAnimationKind | null = null;
  let activeAnimationElapsedSeconds = 0;
  let activeAnimationDurationSeconds = 0;
  let primaryAttackKinds: ViewmodelAnimationKind[] = [];
  let secondaryAttackKinds: ViewmodelAnimationKind[] = [];
  let inspectAnimationSets: InspectAnimationSet[] = [];
  let activeInspectAnimationSet: InspectAnimationSet | null = null;
  let primaryAttackHeld = false;
  let secondaryAttackHeld = false;
  let inspectHeld = false;
  let lastAnimationElapsedSeconds: number | null = null;
  let activeFinish = initialFinish;
  let armsRequestRevision = 0;
  let knifeRequestRevision = 0;
  let disposed = false;
  const viewmodelOffset = new THREE.Vector3();

  const alignKnifeToRightHand = (): void => {
    if (!importedArms || !importedKnife) return;
    const armsHand = importedArms.getObjectByName("hand_r");
    const knifeHand = importedKnife.getObjectByName("hand_r");
    if (!armsHand || !knifeHand || importedKnife.parent !== importedArms) return;

    importedArms.updateMatrixWorld(true);
    const knifeHandInRoot = importedKnife.matrixWorld
      .clone()
      .invert()
      .multiply(knifeHand.matrixWorld);
    const targetHandInArms = importedArms.matrixWorld
      .clone()
      .invert()
      .multiply(armsHand.matrixWorld);
    const alignedRoot = targetHandInArms.multiply(knifeHandInRoot.invert());

    importedKnife.matrixAutoUpdate = false;
    importedKnife.matrix.copy(alignedRoot);
    importedKnife.matrixWorldNeedsUpdate = true;
    importedKnife.updateMatrixWorld(true);
  };

  const playAnimation = (
    kind: ViewmodelAnimationKind,
    fadeSeconds = 0,
  ): void => {
    const clips = targetAnimationClips[kind];
    if (!clips || !importedArmsMixer || !importedKnifeMixer) return;

    const shouldLoop = kind === "idle" || isInspectLoopAnimation(kind);
    const loop = shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce;
    const repetitions = shouldLoop ? Infinity : 1;
    const nextActions = {} as TargetAnimationActions;
    for (const [target, mixer, clip] of [
      ["arms", importedArmsMixer, clips.arms],
      ["knife", importedKnifeMixer, clips.knife],
    ] as const) {
      const action = mixer.clipAction(clip);
      action.reset();
      action.enabled = true;
      action.paused = false;
      action.clampWhenFinished = !shouldLoop;
      action.setLoop(loop, repetitions);
      action.play();
      const previousAction = activeAnimationActions?.[target];
      if (previousAction && previousAction !== action && fadeSeconds > 0) {
        previousAction.crossFadeTo(action, fadeSeconds, false);
      } else if (previousAction && previousAction !== action) {
        previousAction.stop();
      }
      nextActions[target] = action;
    }

    activeAnimationActions = nextActions;
    activeAnimationKind = kind;
    activeAnimationElapsedSeconds = 0;
    activeAnimationDurationSeconds = Math.max(
      clips.arms.duration,
      clips.knife.duration,
    );
  };

  const startAttack = (attackType: KnifeAttackType): void => {
    const isPrimary = attackType === "primary";
    const attackKinds = isPrimary ? primaryAttackKinds : secondaryAttackKinds;
    if (attackKinds.length === 0) return;

    // Source 2's miss-center node is WeightedRandom (50/50 for
    // light1/light2), resets on every attack, and may repeat a variant.
    const kind = attackKinds[
      chooseCs2LightMissIndex(attackKinds.length, Math.random())
    ];
    if (!kind) return;
    activeInspectAnimationSet = null;
    playAnimation(kind, 0.035);
  };

  const requestAttack = (attackType: KnifeAttackType): void => {
    // A released click during the current swing is not buffered. Holding the
    // button is sampled again when the authored attack clip finishes.
    if (isAttackAnimation(activeAnimationKind)) return;
    startAttack(attackType);
  };

  const chooseInspectAnimationSet = (): InspectAnimationSet | null => {
    if (inspectAnimationSets.length === 0) return null;
    if (inspectAnimationSets.length === 1) return inspectAnimationSets[0] ?? null;

    // Source 2 uses 2/3 + 1/3 for two variants and
    // 1/2 + 1/4 + 1/4 for three variants.
    const index = chooseCs2InspectIndex(
      inspectAnimationSets.length,
      Math.random(),
    );
    return inspectAnimationSets[index] ?? inspectAnimationSets[0] ?? null;
  };

  const startInspect = (): void => {
    if (isAttackAnimation(activeAnimationKind)) return;
    const animationSet = chooseInspectAnimationSet();
    if (!animationSet) return;
    activeInspectAnimationSet = animationSet;
    playAnimation(animationSet.start, 0.08);
  };

  const configureAnimations = (playDraw = true): void => {
    if (!importedArms || !importedKnife || !importedAnimations) return;

    importedArmsMixer?.stopAllAction();
    importedKnifeMixer?.stopAllAction();
    importedArmsMixer = new THREE.AnimationMixer(importedArms);
    importedKnifeMixer = new THREE.AnimationMixer(importedKnife);
    activeAnimationActions = null;

    const armsBones = new Set<string>();
    importedArms.traverse((object) => {
      if (object instanceof THREE.Bone) armsBones.add(object.name);
    });
    const knifeBones = new Set<string>();
    importedKnife.traverse((object) => {
      if (object instanceof THREE.Bone) knifeBones.add(object.name);
    });

    targetAnimationClips = {};
    for (const [kind, source] of Object.entries(importedAnimations.clips)) {
      const animationKind = kind as ViewmodelAnimationKind;
      targetAnimationClips[animationKind] = {
        arms: createAnimationClip(
          source,
          (node) => armsBones.has(node),
          "arms",
        ),
        knife: createAnimationClip(
          source,
          (node) => knifeBones.has(node),
          "knife",
        ),
      };
    }
    const animationKinds = Object.keys(
      targetAnimationClips,
    ) as ViewmodelAnimationKind[];
    const sortByAttackIndex = (
      left: ViewmodelAnimationKind,
      right: ViewmodelAnimationKind,
    ): number => Number(left.match(/\d+$/)?.[0] ?? 0)
      - Number(right.match(/\d+$/)?.[0] ?? 0);
    primaryAttackKinds = animationKinds
      .filter((kind) => /^light[12]$/.test(kind))
      .sort(sortByAttackIndex);
    secondaryAttackKinds = animationKinds
      .filter((kind) => kind === "heavy1")
      .sort(sortByAttackIndex);
    const inspectIndexes = Array.from(new Set(
      animationKinds.flatMap((kind) => {
        const match = kind.match(/^inspect(\d+)Start$/);
        return match ? [Number(match[1])] : [];
      }),
    )).sort((left, right) => left - right);
    inspectAnimationSets = inspectIndexes.flatMap((index) => {
      const animationSet: InspectAnimationSet = {
        start: `inspect${index}Start`,
        loop: `inspect${index}Loop`,
        end: `inspect${index}End`,
      };
      return targetAnimationClips[animationSet.start]
        && targetAnimationClips[animationSet.loop]
        && targetAnimationClips[animationSet.end]
        ? [animationSet]
        : [];
    });
    activeInspectAnimationSet = null;
    inspectHeld = false;

    importedKnife.parent?.remove(importedKnife);
    group.add(importedKnife);
    importedKnife.matrixAutoUpdate = true;
    importedKnife.position.set(0, 0, 0);
    importedKnife.quaternion.identity();
    importedKnife.scale.setScalar(0.0254);
    playAnimation("idle");
    importedArmsMixer.update(0);
    importedKnifeMixer.update(0);
    if (framedArms !== importedArms) {
      frameImportedArms(importedArms);
      framedArms = importedArms;
    }

    importedArms.add(importedKnife);
    importedKnife.visible = true;
    alignKnifeToRightHand();
    proceduralKnife.visible = false;
    proceduralArms.visible = false;
    lastAnimationElapsedSeconds = null;
    playAnimation(playDraw ? "draw" : "idle");
  };

  const loadGloves = async (id: GloveId): Promise<void> => {
    const revision = ++armsRequestRevision;
    try {
      const sleeveUrl = getGloveSleeveUrl(id);
      const [gltf, sleeveGltf] = await Promise.all([
        loadGltfModel(getGloveModelUrl(id)).then((scene) => ({ scene })),
        sleeveUrl
          ? loadGltfModel(sleeveUrl).then((scene) => ({ scene }))
          : Promise.resolve(null),
      ]);
      const arms = gltf.scene;
      arms.name = `cs2-arms-${id}`;

      arms.traverse((object) => {
        if (object instanceof THREE.Mesh) prepareViewmodelMesh(object);
      });
      if (sleeveGltf) retargetSleeveToArms(sleeveGltf.scene, arms);

      if (disposed || revision !== armsRequestRevision) {
        disposeObjectResources(arms);
        return;
      }

      if (importedArms) {
        if (importedKnife?.parent === importedArms) {
          importedArms.remove(importedKnife);
          group.add(importedKnife);
          importedKnife.visible = false;
        }
        importedArmsMixer?.stopAllAction();
        importedArmsMixer?.uncacheRoot(importedArms);
        group.remove(importedArms);
        if (framedArms === importedArms) framedArms = null;
        disposeObjectResources(importedArms);
      }
      importedArms = arms;
      importedArmsMixer = null;
      lastAnimationElapsedSeconds = null;
      group.add(arms);
      configureAnimations();
    } catch (error) {
      if (!importedArms) proceduralArms.visible = true;
      console.warn(`Could not load first-person arms: ${id}`, error);
      throw new Error(`Не удалось загрузить модель перчаток «${id}»`, {
        cause: error,
      });
    }
  };

  const loadKnife = async (id: KnifeId): Promise<void> => {
    const revision = ++knifeRequestRevision;
    try {
      const [knifeModel, animationSet] = await Promise.all([
        loadFbxModel(getKnifeModelUrl(id)),
        loadViewmodelAnimations(id),
      ]);
      knifeModel.name = `cs2-${id}`;
      knifeModel.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) rememberFactoryKnifeMaterial(material);
        prepareViewmodelMesh(object);
      });
      applyImportedKnifeFinish(knifeModel, activeFinish);
      if (disposed || revision !== knifeRequestRevision) {
        disposeObjectResources(knifeModel);
        return;
      }

      if (importedKnife) {
        importedKnifeMixer?.stopAllAction();
        importedKnifeMixer?.uncacheRoot(importedKnife);
        importedKnife.parent?.remove(importedKnife);
        disposeObjectResources(importedKnife);
      }
      importedKnife = knifeModel;
      importedKnifeMixer = null;
      importedAnimations = animationSet;
      knifeModel.visible = false;
      group.add(knifeModel);
      configureAnimations();
    } catch (error) {
      if (!importedKnife) proceduralKnife.visible = true;
      console.warn(`Could not load first-person knife: ${id}`, error);
      throw new Error(`Не удалось загрузить модель ножа «${id}»`, {
        cause: error,
      });
    }
  };

  return {
    group,
    loadAssets: async () => {
      await Promise.all([loadGloves(initialGloves), loadKnife(initialKnife)]);
    },
    setKnife: loadKnife,
    setGloves: loadGloves,
    setFinish: (finish) => {
      activeFinish = finish;
      const colors = finish === "default"
        ? { blade: 0xb9c0c5, accent: 0x38434b }
        : FINISH_COLORS[finish];
      bladeMaterial.color.setHex(colors.blade);
      bladeMaterial.emissive.setHex(colors.accent);
      accentMaterial.color.setHex(colors.accent);
      accentMaterial.emissive.setHex(colors.accent);
      if (importedKnife) applyImportedKnifeFinish(importedKnife, finish);
    },
    setOffset: (x, y, z) => {
      viewmodelOffset.set(x, y, z);
      group.position.set(x, -0.045 + y, z);
    },
    setInspectHeld: (held) => {
      const wasHeld = inspectHeld;
      inspectHeld = held;
      if (held && !wasHeld && !isAttackAnimation(activeAnimationKind)) {
        if (!isInspectAnimation(activeAnimationKind)) startInspect();
      } else if (
        !held
        && isInspectLoopAnimation(activeAnimationKind)
        && activeInspectAnimationSet
      ) {
        playAnimation(activeInspectAnimationSet.end, 0.08);
      }
    },
    attackPrimary: () => requestAttack("primary"),
    attackSecondary: () => requestAttack("secondary"),
    setAttackHeld: (primary, secondary) => {
      primaryAttackHeld = primary;
      secondaryAttackHeld = secondary;
    },
    update: (elapsedSeconds, horizontalSpeedUps, grounded, running) => {
      if (importedArmsMixer && importedKnifeMixer) {
        const deltaSeconds = lastAnimationElapsedSeconds === null
          ? 0
          : THREE.MathUtils.clamp(
              elapsedSeconds - lastAnimationElapsedSeconds,
              0,
              0.1,
            );
        lastAnimationElapsedSeconds = elapsedSeconds;
        importedArmsMixer.update(deltaSeconds);
        importedKnifeMixer.update(deltaSeconds);
        alignKnifeToRightHand();
        activeAnimationElapsedSeconds += deltaSeconds;
        if (
          activeAnimationKind !== "idle"
          && !isInspectLoopAnimation(activeAnimationKind)
          && activeAnimationKind !== null
          && activeAnimationElapsedSeconds >= activeAnimationDurationSeconds
        ) {
          if (isInspectStartAnimation(activeAnimationKind)) {
            if (!activeInspectAnimationSet) playAnimation("idle", 0.08);
            else if (inspectHeld) {
              playAnimation(activeInspectAnimationSet.loop, 0);
            } else {
              playAnimation(activeInspectAnimationSet.end, 0);
            }
          } else if (isInspectEndAnimation(activeAnimationKind)) {
            activeInspectAnimationSet = null;
            playAnimation("idle", 0.08);
          } else {
            const nextAttack = isAttackAnimation(activeAnimationKind)
              ? chooseHeldKnifeAttack(primaryAttackHeld, secondaryAttackHeld)
              : null;
            if (nextAttack) startAttack(nextAttack);
            else if (inspectHeld) startInspect();
            else playAnimation("idle", 0.08);
          }
        }
      }

      const speedFactor = THREE.MathUtils.clamp(horizontalSpeedUps / 300, 0, 1.25);
      const cadence = 7.2 + speedFactor * 3.1;
      const bobX = Math.sin(elapsedSeconds * cadence) * 0.009 * speedFactor;
      const bobY =
        Math.abs(Math.cos(elapsedSeconds * cadence)) * 0.011 * speedFactor;
      const airOffset = grounded ? 0 : -0.012;

      group.position.x +=
        (viewmodelOffset.x + bobX - group.position.x) * 0.14;
      group.position.y +=
        (-0.045 + viewmodelOffset.y - bobY + airOffset - group.position.y)
        * 0.14;
      group.position.z +=
        (viewmodelOffset.z - group.position.z) * 0.14;
      group.rotation.z +=
        (Math.sin(elapsedSeconds * cadence * 0.5) * 0.009 * speedFactor -
          group.rotation.z) *
        0.11;
      group.visible = running;
    },
    dispose: () => {
      disposed = true;
      armsRequestRevision += 1;
      knifeRequestRevision += 1;
      importedArmsMixer?.stopAllAction();
      if (importedArms) importedArmsMixer?.uncacheRoot(importedArms);
      importedKnifeMixer?.stopAllAction();
      if (importedKnife) importedKnifeMixer?.uncacheRoot(importedKnife);
      importedArmsMixer = null;
      importedKnifeMixer = null;
      activeAnimationActions = null;
      importedAnimations = null;
      targetAnimationClips = {};
      disposeObjectResources(group);
      importedArms = null;
      importedKnife = null;
    },
  };
};
