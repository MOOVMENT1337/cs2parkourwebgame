import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();
const modelCache = new Map<string, Promise<THREE.Group>>();
const jsonCache = new Map<string, Promise<unknown>>();

const cloneMaterial = (
  source: THREE.Material,
  textureClones: Map<THREE.Texture, THREE.Texture>,
): THREE.Material => {
  const material = source.clone();
  for (const [key, value] of Object.entries(material)) {
    if (!(value instanceof THREE.Texture)) continue;
    let texture = textureClones.get(value);
    if (!texture) {
      texture = value.clone();
      texture.needsUpdate = true;
      textureClones.set(value, texture);
    }
    (material as unknown as Record<string, unknown>)[key] = texture;
  }
  return material;
};

/** Clone cached templates including disposable render resources. */
const cloneModel = (template: THREE.Group): THREE.Group => {
  const root = cloneSkeleton(template) as THREE.Group;
  const textureClones = new Map<THREE.Texture, THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry = object.geometry.clone();
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => cloneMaterial(material, textureClones))
      : cloneMaterial(object.material, textureClones);
  });
  return root;
};

export const loadFbxModel = async (url: string): Promise<THREE.Group> => {
  let pending = modelCache.get(url);
  if (!pending) {
    pending = fbxLoader.loadAsync(url);
    modelCache.set(url, pending);
    pending.catch(() => modelCache.delete(url));
  }
  return cloneModel(await pending);
};

export const loadGltfModel = async (url: string): Promise<THREE.Group> => {
  let pending = modelCache.get(url);
  if (!pending) {
    pending = gltfLoader.loadAsync(url).then((gltf) => gltf.scene);
    modelCache.set(url, pending);
    pending.catch(() => modelCache.delete(url));
  }
  return cloneModel(await pending);
};

export const loadCachedJson = async <Value>(
  url: string,
  maximumBytes: number,
  validate: (value: unknown) => value is Value,
): Promise<Value> => {
  let pending = jsonCache.get(url);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Could not load ${url}: ${response.status}`);
      }
      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) {
        throw new Error(`Asset ${url} exceeds the ${maximumBytes} byte limit`);
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > maximumBytes) {
        throw new Error(`Asset ${url} exceeds the ${maximumBytes} byte limit`);
      }
      return JSON.parse(text) as unknown;
    });
    jsonCache.set(url, pending);
    pending.catch(() => jsonCache.delete(url));
  }

  const value = await pending;
  if (!validate(value)) throw new Error(`Invalid JSON asset: ${url}`);
  return value;
};

export const clearViewmodelAssetCache = (): void => {
  modelCache.clear();
  jsonCache.clear();
};
