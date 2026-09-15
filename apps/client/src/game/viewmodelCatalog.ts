export const KNIFE_CATALOG = [
  { id: "knife_bayonet", name: "Bayonet", shortName: "Bayonet" },
  { id: "knife_bowie", name: "Bowie Knife", shortName: "Bowie" },
  { id: "knife_butterfly", name: "Butterfly Knife", shortName: "Butterfly" },
  { id: "knife_canis", name: "Survival Knife", shortName: "Survival" },
  { id: "knife_cord", name: "Paracord Knife", shortName: "Paracord" },
  { id: "knife_css", name: "Classic Knife", shortName: "Classic" },
  { id: "knife_default_ct", name: "CT Knife", shortName: "CT Default" },
  { id: "knife_default_t", name: "T Knife", shortName: "T Default" },
  { id: "knife_falchion", name: "Falchion Knife", shortName: "Falchion" },
  { id: "knife_flip", name: "Flip Knife", shortName: "Flip" },
  { id: "knife_gut", name: "Gut Knife", shortName: "Gut" },
  { id: "knife_karambit", name: "Karambit", shortName: "Karambit" },
  { id: "knife_kukri", name: "Kukri Knife", shortName: "Kukri" },
  { id: "knife_m9", name: "M9 Bayonet", shortName: "M9 Bayonet" },
  { id: "knife_navaja", name: "Navaja Knife", shortName: "Navaja" },
  { id: "knife_outdoor", name: "Nomad Knife", shortName: "Nomad" },
  { id: "knife_push", name: "Shadow Daggers", shortName: "Daggers" },
  { id: "knife_skeleton", name: "Skeleton Knife", shortName: "Skeleton" },
  { id: "knife_stiletto", name: "Stiletto Knife", shortName: "Stiletto" },
  { id: "knife_tactical", name: "Huntsman Knife", shortName: "Huntsman" },
  { id: "knife_talon", name: "Talon Knife", shortName: "Talon" },
  { id: "knife_ursus", name: "Ursus Knife", shortName: "Ursus" },
] as const;

export type KnifeId = (typeof KNIFE_CATALOG)[number]["id"];

export const DEFAULT_KNIFE_ID: KnifeId = "knife_karambit";

export const getKnifeModelUrl = (id: KnifeId): string =>
  `/assets/viewmodels/cs2/knives/${id}.fbx`;

export const GLOVE_CATALOG = [
  {
    id: "ct_hardknuckle_black",
    name: "CT Hard Knuckle Black",
    subtitle: "SAS · Counter-Terrorist",
    model: "v_glove_hardknuckle_black.glb",
    sleeve: "ct_sas/sleeve_ctm_sas.gltf",
  },
  {
    id: "ct_hardknuckle",
    name: "CT Hard Knuckle",
    subtitle: "SAS · Counter-Terrorist",
    model: "v_glove_hardknuckle.glb",
    sleeve: "ct_sas/sleeve_ctm_sas.gltf",
  },
  {
    id: "fullfinger",
    name: "Full Finger",
    subtitle: "Стандартные перчатки",
    model: "v_glove_fullfinger.gltf",
  },
  {
    id: "fingerless",
    name: "Fingerless",
    subtitle: "Перчатки без пальцев",
    model: "v_glove_fingerless.gltf",
  },
  {
    id: "bloodhound",
    name: "Bloodhound",
    subtitle: "Тяжёлые перчатки",
    model: "v_glove_bloodhound.gltf",
  },
  {
    id: "handwrap",
    name: "Hand Wraps",
    subtitle: "Бинты для рук",
    model: "v_glove_handwrap.gltf",
  },
  {
    id: "motorcycle",
    name: "Moto Gloves",
    subtitle: "Мотоциклетные перчатки",
    model: "v_glove_motorcycle.gltf",
  },
  {
    id: "bare",
    name: "Bare Arms",
    subtitle: "Руки без перчаток",
    model: "v_bare_arms.gltf",
  },
] as const;

export type GloveId = (typeof GLOVE_CATALOG)[number]["id"];

export const DEFAULT_GLOVE_ID: GloveId = "ct_hardknuckle_black";

export const getGloveModelUrl = (id: GloveId): string => {
  const entry = GLOVE_CATALOG.find((item) => item.id === id);
  if (!entry) throw new Error(`Unknown glove id: ${id}`);
  return `/assets/viewmodels/cs2/arms/${id}/${entry.model}`;
};

export const getGloveSleeveUrl = (id: GloveId): string | null => {
  const entry = GLOVE_CATALOG.find((item) => item.id === id);
  if (!entry) throw new Error(`Unknown glove id: ${id}`);
  return "sleeve" in entry
    ? `/assets/viewmodels/cs2/arms/${entry.sleeve}`
    : null;
};

export const getKnifeName = (id: KnifeId): string =>
  KNIFE_CATALOG.find((knife) => knife.id === id)?.name ?? id;
