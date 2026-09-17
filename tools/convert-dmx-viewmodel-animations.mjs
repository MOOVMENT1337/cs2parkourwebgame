import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , sourceRootArgument, outputRootArgument] = process.argv;

if (!sourceRootArgument || !outputRootArgument) {
  throw new Error(
    "Usage: node tools/convert-dmx-viewmodel-animations.mjs <knife-root> <output-root>",
  );
}

const extractQuotedValues = (source) =>
  Array.from(source.matchAll(/"([^"]*)"/g), (match) => match[1]);

const parseNumberList = (value) =>
  value.trim().split(/\s+/).filter(Boolean).map(Number);

const parseDmxClip = async (filename, name) => {
  const source = await readFile(filename, "utf8");
  const durationMatch = source.match(/"duration"\s+"time"\s+"([^"]+)"/);
  const declaredDuration = durationMatch ? Number(durationMatch[1]) : 0;
  const channels = source.split(/^\s*"DmeChannel"\s*$/m).slice(1);
  const tracks = [];

  for (const channel of channels) {
    const channelName = channel.match(/"name"\s+"string"\s+"([^"]+)"/);
    const attribute = channel.match(
      /"toAttribute"\s+"string"\s+"(position|orientation)"/,
    );
    const timesMatch = channel.match(
      /"times"\s+"time_array"\s*\[([\s\S]*?)\]/,
    );
    const valuesMatch = channel.match(
      /"values"\s+"(?:vector3|quaternion)_array"\s*\[([\s\S]*?)\]/,
    );
    if (!channelName || !attribute || !timesMatch || !valuesMatch) continue;

    const property = attribute[1] === "orientation" ? "quaternion" : "position";
    const itemSize = property === "quaternion" ? 4 : 3;
    const times = extractQuotedValues(timesMatch[1]).map(Number);
    const samples = extractQuotedValues(valuesMatch[1]).map(parseNumberList);
    if (times.length !== samples.length) {
      throw new Error(
        `Mismatched DMX samples in ${filename}: ${channelName[1]}`,
      );
    }

    const keptTimes = [];
    const values = [];
    for (let index = 0; index < times.length; index += 1) {
      if (times[index] < 0 || times[index] > declaredDuration + 0.0001) continue;
      if (samples[index].length !== itemSize) {
        throw new Error(`Invalid ${property} sample in ${filename}`);
      }
      keptTimes.push(times[index]);
      values.push(...samples[index]);
    }

    const node = channelName[1].replace(/_(?:p|o)$/, "");
    tracks.push({ node, property, times: keptTimes, values });
  }

  if (tracks.length === 0) throw new Error(`No animation tracks in ${filename}`);
  const sampledDuration = Math.max(...tracks.flatMap((track) => track.times));
  return {
    name,
    duration: Math.max(declaredDuration, sampledDuration),
    tracks,
  };
};

const sourceRoot = path.resolve(sourceRootArgument);
const outputRoot = path.resolve(outputRootArgument);
const knifeDirectories = (await readdir(sourceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));

await mkdir(outputRoot, { recursive: true });

for (const knifeDirectory of knifeDirectories) {
  const knifeRoot = path.join(sourceRoot, knifeDirectory.name);
  const animationsRoot = path.join(knifeRoot, "anims");
  const knifeFiles = await readdir(knifeRoot);
  const animationFiles = await readdir(animationsRoot);
  const graphFilename = knifeFiles.find((filename) => filename.endsWith(".vanmgrph"));
  if (!graphFilename) {
    throw new Error(`AnimGraph not found for ${knifeDirectory.name}`);
  }
  const graphSource = await readFile(path.join(knifeRoot, graphFilename), "utf8");
  const graphSequences = new Set(
    Array.from(
      graphSource.matchAll(/m_sequenceName\s*=\s*"([^"]+)"/g),
      (match) => match[1],
    ),
  );
  const clipFiles = {
    idle: "firstperson_idle.dmx",
    draw: "firstperson_draw.dmx",
  };
  const inspectFiles = animationFiles
    .filter((filename) => /^firstperson_lookat\d+_(?:start|loop|end)\.dmx$/.test(filename))
    .filter((filename) => graphSequences.has(filename.replace(/\.dmx$/, "")))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const attackFiles = animationFiles
    .filter((filename) => /^firstperson_(?:light|heavy)_miss\d+(?:_noflip)?\.dmx$/.test(filename))
    // Some source folders contain unused alternates. CS2 only exposes the
    // sequences wired into the selected knife's AnimGraph.
    .filter((filename) => graphSequences.has(filename.replace(/\.dmx$/, "")))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  for (const filename of inspectFiles) {
    const match = filename.match(
      /^firstperson_lookat(\d+)_(start|loop|end)\.dmx$/,
    );
    if (!match) continue;
    const [, rawIndex, rawPhase] = match;
    const phase = `${rawPhase[0].toUpperCase()}${rawPhase.slice(1)}`;
    clipFiles[`inspect${Number(rawIndex)}${phase}`] = filename;
  }

  for (const filename of attackFiles) {
    const match = filename.match(
      /^firstperson_(light|heavy)_miss(\d+)(_noflip)?\.dmx$/,
    );
    if (!match) continue;
    const [, attackType, index, noFlip] = match;
    const clipName = noFlip
      ? `${attackType}NoFlip`
      : `${attackType}${index}`;
    clipFiles[clipName] = filename;
  }
  const clips = {};

  for (const [name, filename] of Object.entries(clipFiles)) {
    clips[name] = await parseDmxClip(path.join(animationsRoot, filename), name);
  }

  const document = {
    version: 1,
    source: knifeDirectory.name,
    clips,
  };
  await writeFile(
    path.join(outputRoot, `${knifeDirectory.name}.json`),
    `${JSON.stringify(document)}\n`,
    "utf8",
  );
  console.log(
    `${knifeDirectory.name}: ${Object.values(clips).map((clip) => `${clip.name}=${clip.duration}s/${clip.tracks.length}`).join(" ")}`,
  );
}
