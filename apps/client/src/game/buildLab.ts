import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

interface BoxOptions {
  position: THREE.Vector3;
  size: THREE.Vector3;
  color: number;
  emissive?: number;
  opacity?: number;
  rotationZ?: number;
  collider?: boolean;
}

const createMaterial = (
  color: number,
  emissive = 0x000000,
  opacity = 1,
) =>
  new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive === 0 ? 0 : 1.4,
    opacity,
    transparent: opacity < 1,
    roughness: 0.72,
    metalness: 0.08,
  });

const addBox = (
  scene: THREE.Scene,
  world: RAPIER.World,
  options: BoxOptions,
): THREE.Mesh => {
  const geometry = new THREE.BoxGeometry(
    options.size.x,
    options.size.y,
    options.size.z,
  );
  const mesh = new THREE.Mesh(
    geometry,
    createMaterial(options.color, options.emissive, options.opacity),
  );
  mesh.position.copy(options.position);
  mesh.rotation.z = options.rotationZ ?? 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  if (options.collider !== false) {
    const quaternion = mesh.quaternion;
    const descriptor = RAPIER.ColliderDesc.cuboid(
      options.size.x / 2,
      options.size.y / 2,
      options.size.z / 2,
    )
      .setTranslation(options.position.x, options.position.y, options.position.z)
      .setRotation({
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w,
      })
      .setFriction(0);

    world.createCollider(descriptor);
  }

  return mesh;
};

const addStrip = (
  scene: THREE.Scene,
  position: THREE.Vector3,
  size: THREE.Vector3,
  color: number,
): void => {
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }),
  );
  strip.position.copy(position);
  scene.add(strip);
};

const addGate = (
  scene: THREE.Scene,
  world: RAPIER.World,
  z: number,
  color: number,
  labelColor: number,
): void => {
  for (const x of [-5.8, 5.8]) {
    addBox(scene, world, {
      position: new THREE.Vector3(x, 2.5, z),
      size: new THREE.Vector3(0.22, 5, 0.22),
      color,
      emissive: color,
      collider: false,
    });
  }
  addBox(scene, world, {
    position: new THREE.Vector3(0, 4.9, z),
    size: new THREE.Vector3(11.8, 0.22, 0.22),
    color,
    emissive: color,
    collider: false,
  });
  addStrip(
    scene,
    new THREE.Vector3(0, 0.025, z + 0.12),
    new THREE.Vector3(8.5, 0.03, 0.11),
    labelColor,
  );
};

export interface LabCheckpoint {
  z: number;
  spawn: THREE.Vector3;
}

export interface LabDefinition {
  spawn: THREE.Vector3;
  finishZ: number;
  checkpoints: readonly LabCheckpoint[];
}

export const buildLab = (
  scene: THREE.Scene,
  world: RAPIER.World,
): LabDefinition => {
  const platformColor = 0x263447;
  const platformTop = 0x35465d;
  const accent = 0x34d399;
  const reward = 0xf59e0b;

  addBox(scene, world, {
    position: new THREE.Vector3(0, -0.6, 3),
    size: new THREE.Vector3(15, 1.2, 28),
    color: platformColor,
  });
  addStrip(
    scene,
    new THREE.Vector3(0, 0.015, -4),
    new THREE.Vector3(0.09, 0.025, 13),
    accent,
  );
  addGate(scene, world, -10.5, accent, accent);

  const pads = [
    { x: -1.1, z: -17.5, width: 7.6, depth: 7.4 },
    { x: 1.2, z: -26.5, width: 7.2, depth: 7.2 },
    { x: -1.3, z: -35.5, width: 7, depth: 7.3 },
    { x: 1.35, z: -44.7, width: 6.8, depth: 7.4 },
    { x: -0.9, z: -54.2, width: 7.2, depth: 7.5 },
    { x: 0, z: -64.2, width: 7.6, depth: 8 },
  ];

  for (const [index, pad] of pads.entries()) {
    addBox(scene, world, {
      position: new THREE.Vector3(pad.x, -0.35, pad.z),
      size: new THREE.Vector3(pad.width, 0.7, pad.depth),
      color: index % 2 === 0 ? platformTop : platformColor,
    });
    addStrip(
      scene,
      new THREE.Vector3(pad.x, 0.015, pad.z),
      new THREE.Vector3(pad.width * 0.72, 0.025, 0.08),
      accent,
    );
  }

  addBox(scene, world, {
    position: new THREE.Vector3(0, -0.5, -76),
    size: new THREE.Vector3(15, 1, 15),
    color: platformColor,
  });
  addGate(scene, world, -82.5, reward, reward);

  // Steeper than the controller's walkable limit: these surfaces must remain
  // air-controlled surf planes instead of becoming ordinary sloped ground.
  const surfRampAngle = (50 * Math.PI) / 180;
  addBox(scene, world, {
    position: new THREE.Vector3(-2.8, -3.35, -101),
    size: new THREE.Vector3(10, 0.42, 33),
    color: 0x1f4b54,
    rotationZ: surfRampAngle,
  });
  addBox(scene, world, {
    position: new THREE.Vector3(2.8, -3.35, -135),
    size: new THREE.Vector3(10, 0.42, 33),
    color: 0x473e60,
    rotationZ: -surfRampAngle,
  });

  // Bright inner ridges make the correct surf line readable at speed.
  addBox(scene, world, {
    position: new THREE.Vector3(-0.04, 0.02, -101),
    size: new THREE.Vector3(0.08, 0.06, 31),
    color: accent,
    emissive: accent,
    collider: false,
  });
  addBox(scene, world, {
    position: new THREE.Vector3(0.04, 0.02, -135),
    size: new THREE.Vector3(0.08, 0.06, 31),
    color: reward,
    emissive: reward,
    collider: false,
  });

  addBox(scene, world, {
    position: new THREE.Vector3(0, -8.35, -119),
    size: new THREE.Vector3(17, 0.6, 72),
    color: 0x0b1c27,
  });
  for (let z = -87; z >= -151; z -= 8) {
    addStrip(
      scene,
      new THREE.Vector3(0, -8.02, z),
      new THREE.Vector3(13, 0.025, 0.055),
      z % 16 === 0 ? reward : 0x1e6e5b,
    );
  }

  addBox(scene, world, {
    position: new THREE.Vector3(0, -0.5, -162),
    size: new THREE.Vector3(16, 1, 20),
    color: platformColor,
  });
  addGate(scene, world, -170.5, reward, reward);

  const columnMaterial = createMaterial(0x172033);
  for (let z = 8; z >= -178; z -= 14) {
    for (const x of [-11, 11]) {
      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.23, 9, 8),
        columnMaterial,
      );
      column.position.set(x, 2.7, z);
      scene.add(column);
    }
  }

  const grid = new THREE.GridHelper(230, 46, 0x1d6956, 0x1d2c3c);
  grid.position.y = -7.5;
  scene.add(grid);

  return {
    spawn: new THREE.Vector3(0, 1.05, 8),
    finishZ: -170.5,
    checkpoints: [
      { z: -10.5, spawn: new THREE.Vector3(0, 1.05, -8.5) },
      { z: -82.5, spawn: new THREE.Vector3(0, 1.05, -79) },
      { z: -151, spawn: new THREE.Vector3(0, 1.05, -153.5) },
    ],
  };
};
