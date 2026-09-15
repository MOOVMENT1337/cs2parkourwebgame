import { readFile } from "node:fs/promises";

const [, , gltfFilename, dmxFilename] = process.argv;
if (!gltfFilename || !dmxFilename) {
  throw new Error("Pass a glTF file and a DMX file");
}

const gltf = JSON.parse(await readFile(gltfFilename, "utf8"));
const binaryFilename = new URL(gltf.buffers[0].uri, `file:///${gltfFilename.replaceAll("\\", "/")}`).pathname.slice(1);
const binary = await readFile(binaryFilename);
const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

const readAccessor = (index) => {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  if (accessor.componentType !== 5126) throw new Error("Expected float accessor");
  const itemSize = componentCounts[accessor.type];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? itemSize * 4;
  const values = [];
  for (let item = 0; item < accessor.count; item += 1) {
    for (let component = 0; component < itemSize; component += 1) {
      values.push(binary.readFloatLE(start + item * stride + component * 4));
    }
  }
  return { itemSize, values };
};

const gltfAnimation = gltf.animations.find((animation) => animation.name === "inspect_loop");
const gltfTracks = new Map();
for (const channel of gltfAnimation.channels) {
  const node = gltf.nodes[channel.target.node].name;
  if (!["arm_lower_r", "hand_r", "finger_index_0_r", "arm_lower_l"].includes(node)) continue;
  const sampler = gltfAnimation.samplers[channel.sampler];
  const output = readAccessor(sampler.output);
  gltfTracks.set(`${node}.${channel.target.path}`, output.values.slice(0, output.itemSize));
}

const dmxSource = await readFile(dmxFilename, "utf8");
const dmxTracks = new Map();
for (const channel of dmxSource.split(/^\s*"DmeChannel"\s*$/m).slice(1)) {
  const name = channel.match(/"name"\s+"string"\s+"([^"]+)"/)?.[1];
  const attribute = channel.match(/"toAttribute"\s+"string"\s+"(position|orientation)"/)?.[1];
  const values = channel.match(/"values"\s+"(?:vector3|quaternion)_array"\s*\[([\s\S]*?)\]/)?.[1];
  if (!name || !attribute || !values) continue;
  const node = name.replace(/_(?:p|o)$/, "");
  if (!["arm_lower_r", "hand_r", "finger_index_0_r", "arm_lower_l"].includes(node)) continue;
  const first = values.match(/"([^"]+)"/)?.[1].trim().split(/\s+/).map(Number);
  dmxTracks.set(`${node}.${attribute === "orientation" ? "rotation" : "translation"}`, first);
}

console.log("glTF", Object.fromEntries(gltfTracks));
console.log("DMX", Object.fromEntries(dmxTracks));
