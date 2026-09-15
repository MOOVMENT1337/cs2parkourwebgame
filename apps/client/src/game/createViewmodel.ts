import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  DEFAULT_GLOVE_ID,
  DEFAULT_KNIFE_ID,
  getGloveModelUrl,
  getGloveSleeveUrl,
  getKnifeModelUrl,
  type GloveId,
  type KnifeId,
} from "./viewmodelCatalog";

export type KnifeFinish = "emerald" | "amber" | "violet";

const FINISH_COLORS: Record<KnifeFinish, { blade: number; accent: number }> = {
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
    new THREE.Vector3(0.12, -0.26, -0.94).sub(fittedCenter),
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

  sleeve.name = "ct-sleeve";
  arms.add(sleeve);
};

type ViewmodelAnimationKind = "idle" | "draw" | "inspect";

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
  clips: Record<ViewmodelAnimationKind, SerializedAnimationClip>;
}

interface TargetAnimationClips {
  arms: THREE.AnimationClip;
  knife: THREE.AnimationClip;
}

const loadViewmodelAnimations = async (
  id: KnifeId,
): Promise<SerializedViewmodelAnimations> => {
  const response = await fetch(`/assets/viewmodels/cs2/animations/${id}.json`);
  if (!response.ok) {
    throw new Error(`Could not load animations for ${id}: ${response.status}`);
  }
  const document = await response.json() as SerializedViewmodelAnimations;
  if (document.version !== 1 || document.source !== id) {
    throw new Error(`Invalid animation document for ${id}`);
  }
  return document;
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

const createImportedKnifeMaterial = (
  finish: KnifeFinish,
): THREE.MeshPhysicalMaterial => {
  const colors = FINISH_COLORS[finish];
  const material = new THREE.MeshPhysicalMaterial({
    color: colors.blade,
    emissive: colors.accent,
    emissiveIntensity: 0.08,
    metalness: 0.88,
    roughness: 0.24,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
  });
  material.userData.knifeFinishMaterial = true;
  return material;
};

const applyImportedKnifeFinish = (
  root: THREE.Object3D,
  finish: KnifeFinish,
): void => {
  const colors = FINISH_COLORS[finish];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!material.userData.knifeFinishMaterial) continue;
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
  inspect: () => void;
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
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: FINISH_COLORS[initialFinish].accent,
    emissive: FINISH_COLORS[initialFinish].accent,
    emissiveIntensity: 0.48,
    roughness: 0.36,
    metalness: 0.5,
  });
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: FINISH_COLORS[initialFinish].blade,
    emissive: FINISH_COLORS[initialFinish].accent,
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
  let importedArmsMixer: THREE.AnimationMixer | null = null;
  let importedKnife: THREE.Group | null = null;
  let importedKnifeMixer: THREE.AnimationMixer | null = null;
  let importedAnimations: SerializedViewmodelAnimations | null = null;
  let targetAnimationClips: Partial<
    Record<ViewmodelAnimationKind, TargetAnimationClips>
  > = {};
  let activeAnimationKind: ViewmodelAnimationKind | null = null;
  let activeAnimationElapsedSeconds = 0;
  let activeAnimationDurationSeconds = 0;
  let lastAnimationElapsedSeconds: number | null = null;
  let activeFinish = initialFinish;
  let armsRequestRevision = 0;
  let knifeRequestRevision = 0;
  let disposed = false;

  const playAnimation = (kind: ViewmodelAnimationKind): void => {
    const clips = targetAnimationClips[kind];
    if (!clips || !importedArmsMixer || !importedKnifeMixer) return;

    importedArmsMixer.stopAllAction();
    importedKnifeMixer.stopAllAction();
    const loop = kind === "idle" ? THREE.LoopRepeat : THREE.LoopOnce;
    const repetitions = kind === "idle" ? Infinity : 1;
    for (const [mixer, clip] of [
      [importedArmsMixer, clips.arms],
      [importedKnifeMixer, clips.knife],
    ] as const) {
      const action = mixer.clipAction(clip);
      action.reset();
      action.enabled = true;
      action.paused = false;
      action.clampWhenFinished = kind !== "idle";
      action.setLoop(loop, repetitions);
      action.play();
    }

    activeAnimationKind = kind;
    activeAnimationElapsedSeconds = 0;
    activeAnimationDurationSeconds = Math.max(
      clips.arms.duration,
      clips.knife.duration,
    );
  };

  const configureAnimations = (playDraw = true): void => {
    if (!importedArms || !importedKnife || !importedAnimations) return;

    importedArmsMixer?.stopAllAction();
    importedKnifeMixer?.stopAllAction();
    importedArmsMixer = new THREE.AnimationMixer(importedArms);
    importedKnifeMixer = new THREE.AnimationMixer(importedKnife);

    const armsBones = new Set<string>();
    importedArms.traverse((object) => {
      if (object instanceof THREE.Bone) armsBones.add(object.name);
    });
    const acceptsKnifeNode = (node: string): boolean =>
      node === "weapon_hand_r" || node.startsWith("v_weapon_");

    targetAnimationClips = {};
    for (const kind of ["idle", "draw", "inspect"] as const) {
      const source = importedAnimations.clips[kind];
      targetAnimationClips[kind] = {
        arms: createAnimationClip(
          source,
          (node) => armsBones.has(node) && !acceptsKnifeNode(node),
          "arms",
        ),
        knife: createAnimationClip(source, acceptsKnifeNode, "knife"),
      };
    }

    importedKnife.parent?.remove(importedKnife);
    group.add(importedKnife);
    playAnimation("idle");
    importedArmsMixer.update(0);
    importedKnifeMixer.update(0);
    frameImportedArms(importedArms);

    importedKnife.position.set(0, 0, 0);
    importedKnife.rotation.set(0, 0, 0);
    importedKnife.scale.setScalar(1);
    importedArms.add(importedKnife);
    importedKnife.visible = true;
    importedArms.updateMatrixWorld(true);
    const knifeBounds = new THREE.Box3().setFromObject(importedKnife, true);
    const knifeCenter = knifeBounds.getCenter(new THREE.Vector3());
    const knifeSize = knifeBounds.getSize(new THREE.Vector3());
    console.info("viewmodel knife bounds", {
      center: knifeCenter.toArray(),
      size: knifeSize.toArray(),
    });
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
        new GLTFLoader().loadAsync(getGloveModelUrl(id)),
        sleeveUrl
          ? new GLTFLoader().loadAsync(sleeveUrl)
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
    }
  };

  const loadKnife = async (id: KnifeId): Promise<void> => {
    const revision = ++knifeRequestRevision;
    try {
      const [knifeModel, animationSet] = await Promise.all([
        new FBXLoader().loadAsync(getKnifeModelUrl(id)),
        loadViewmodelAnimations(id),
      ]);
      knifeModel.name = `cs2-${id}`;
      knifeModel.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const oldMaterials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of oldMaterials) material.dispose();
        const nextMaterials = oldMaterials.map(() =>
          createImportedKnifeMaterial(activeFinish),
        );
        object.material =
          nextMaterials.length === 1 ? nextMaterials[0] : nextMaterials;
        prepareViewmodelMesh(object);
      });
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
      const colors = FINISH_COLORS[finish];
      bladeMaterial.color.setHex(colors.blade);
      bladeMaterial.emissive.setHex(colors.accent);
      accentMaterial.color.setHex(colors.accent);
      accentMaterial.emissive.setHex(colors.accent);
      if (importedKnife) applyImportedKnifeFinish(importedKnife, finish);
    },
    inspect: () => {
      playAnimation("inspect");
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
        activeAnimationElapsedSeconds += deltaSeconds;
        if (
          activeAnimationKind !== "idle"
          && activeAnimationKind !== null
          && activeAnimationElapsedSeconds >= activeAnimationDurationSeconds
        ) {
          playAnimation("idle");
        }
      }

      const speedFactor = THREE.MathUtils.clamp(horizontalSpeedUps / 300, 0, 1.25);
      const cadence = 7.2 + speedFactor * 3.1;
      const bobX = Math.sin(elapsedSeconds * cadence) * 0.009 * speedFactor;
      const bobY =
        Math.abs(Math.cos(elapsedSeconds * cadence)) * 0.011 * speedFactor;
      const airOffset = grounded ? 0 : -0.012;

      group.position.x += (bobX - group.position.x) * 0.14;
      group.position.y += (-0.045 - bobY + airOffset - group.position.y) * 0.14;
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
      importedAnimations = null;
      targetAnimationClips = {};
      disposeObjectResources(group);
      importedArms = null;
      importedKnife = null;
    },
  };
};
