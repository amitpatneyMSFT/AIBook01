/**
 * Presenter configuration shared by the API and the UI.
 *
 * Kept apart from avatarbatch.ts for the same reason voices.ts is kept apart
 * from speech.ts: that module pulls in the Azure identity SDK, which has no
 * business in a client bundle.
 */
import { PINNED_VOICES } from "./voices";
import { isVoiceId } from "./voicecatalog";

export type AvatarPreset = {
  label: string;
  /** Standard avatar character, as the batch API spells it. */
  character: string;
  /** Omitted for characters Microsoft lists without a style. */
  style?: string;
  /** The presenter's apparent gender; the voice must match it (tests enforce this). */
  gender: "Female" | "Male";
  /** A PINNED_VOICES speaker that suits the presenter. */
  voice: string;
  /** Head-only photo avatar, driven by a VASA model instead of the full-body video model. */
  photo?: boolean;
  /** Photo avatars only: the VASA base model that drives it. Defaults to VASA-1. */
  photoModel?: PhotoModel;
};

export type PhotoModel = "vasa-1" | "vasa-2";

export const DEFAULT_PHOTO_MODEL: PhotoModel = "vasa-1";

/** The presenter's own name, e.g. "Lisa" from "Lisa · casual, seated". */
export const presenterName = (label: string): string => label.split(" · ")[0];

/**
 * Every standard full-body video avatar Microsoft lists for batch synthesis
 * (https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/standard-avatars),
 * one entry per character and style.
 *
 * Keys of the first seven are saved in transcripts, so they never change.
 * The "head-" entries are the standard talking-head (photo) avatars. They
 * render head-only through a VASA model, so they are submitted with
 * photoAvatarBaseModel: 30 use VASA-1 and the four newer, more expressive
 * ones use VASA-2. VASA-2 is in preview, limited to a few regions, and
 * Microsoft's docs say batch synthesis does not support it yet, so those jobs
 * may be rejected until the service enables it.
 *
 * Jeff is absent because Microsoft retires him in December 2026 and no longer
 * lists his styles.
 */
export const AVATAR_PRESETS: Record<string, AvatarPreset> = {
  "lisa-casual": {
    label: "Lisa · casual, seated",
    character: "lisa",
    gender: "Female",
    style: "casual-sitting",
    voice: "Ava",
  },
  "lisa-technical": {
    label: "Lisa · technical, seated",
    character: "lisa",
    gender: "Female",
    style: "technical-sitting",
    voice: "Ava",
  },
  "lisa-graceful": {
    label: "Lisa · graceful, seated",
    character: "lisa",
    gender: "Female",
    style: "graceful-sitting",
    voice: "Ava",
  },
  "lisa-graceful-standing": {
    label: "Lisa · graceful, standing",
    character: "lisa",
    gender: "Female",
    style: "graceful-standing",
    voice: "Ava",
  },
  "lisa-technical-standing": {
    label: "Lisa · technical, standing",
    character: "lisa",
    gender: "Female",
    style: "technical-standing",
    voice: "Ava",
  },
  "lori-formal": {
    label: "Lori · formal",
    character: "lori",
    gender: "Female",
    style: "formal",
    voice: "Emma",
  },
  "lori-casual": {
    label: "Lori · casual",
    character: "lori",
    gender: "Female",
    style: "casual",
    voice: "Emma",
  },
  "lori-graceful": {
    label: "Lori · graceful",
    character: "lori",
    gender: "Female",
    style: "graceful",
    voice: "Emma",
  },
  "meg-business": {
    label: "Meg · business",
    character: "meg",
    gender: "Female",
    style: "business",
    voice: "Jenny",
  },
  "meg-formal": {
    label: "Meg · formal",
    character: "meg",
    gender: "Female",
    style: "formal",
    voice: "Jenny",
  },
  "meg-casual": {
    label: "Meg · casual",
    character: "meg",
    gender: "Female",
    style: "casual",
    voice: "Jenny",
  },
  "harry-casual": {
    label: "Harry · casual",
    character: "harry",
    gender: "Male",
    style: "casual",
    voice: "Andrew",
  },
  "harry-business": {
    label: "Harry · business",
    character: "harry",
    gender: "Male",
    style: "business",
    voice: "Andrew",
  },
  "harry-youthful": {
    label: "Harry · youthful",
    character: "harry",
    gender: "Male",
    style: "youthful",
    voice: "Andrew",
  },
  "max-business": {
    label: "Max · business",
    character: "max",
    gender: "Male",
    style: "business",
    voice: "Brian",
  },
  "max-casual": {
    label: "Max · casual",
    character: "max",
    gender: "Male",
    style: "casual",
    voice: "Davis",
  },
  "max-formal": {
    label: "Max · formal",
    character: "max",
    gender: "Male",
    style: "formal",
    voice: "Brian",
  },
  // Styleless characters: Microsoft lists no style for these, so none is sent.
  rowan: { label: "Rowan", character: "rowan", gender: "Male", voice: "Adam" },
  celine: {
    label: "Celine",
    character: "celine",
    gender: "Female",
    voice: "Serena",
  },
  nia: { label: "Nia", character: "nia", gender: "Female", voice: "Evelyn" },
  malik: {
    label: "Malik",
    character: "malik",
    gender: "Male",
    voice: "Steffan",
  },
  // Talking heads: photo avatars (head and shoulders), each listed once without a style.
  "head-adrian": {
    label: "Adrian · talking head",
    character: "adrian",
    gender: "Male",
    voice: "Andrew",
    photo: true,
  },
  "head-amara": {
    label: "Amara · talking head",
    character: "amara",
    gender: "Female",
    voice: "Ava",
    photo: true,
  },
  "head-amira": {
    label: "Amira · talking head",
    character: "amira",
    gender: "Female",
    voice: "Emma",
    photo: true,
  },
  "head-anika": {
    label: "Anika · talking head",
    character: "anika",
    gender: "Female",
    voice: "Jenny",
    photo: true,
  },
  "head-bianca": {
    label: "Bianca · talking head",
    character: "bianca",
    gender: "Female",
    voice: "Aria",
    photo: true,
  },
  "head-camila": {
    label: "Camila · talking head",
    character: "camila",
    gender: "Female",
    voice: "Serena",
    photo: true,
  },
  "head-carlos": {
    label: "Carlos · talking head",
    character: "carlos",
    gender: "Male",
    voice: "Brian",
    photo: true,
  },
  "head-clara": {
    label: "Clara · talking head",
    character: "clara",
    gender: "Female",
    voice: "Phoebe",
    photo: true,
  },
  "head-darius": {
    label: "Darius · talking head",
    character: "darius",
    gender: "Male",
    voice: "Davis",
    photo: true,
  },
  "head-diego": {
    label: "Diego · talking head",
    character: "diego",
    gender: "Male",
    voice: "Adam",
    photo: true,
  },
  "head-elise": {
    label: "Elise · talking head",
    character: "elise",
    gender: "Female",
    voice: "Evelyn",
    photo: true,
  },
  "head-farhan": {
    label: "Farhan · talking head",
    character: "farhan",
    gender: "Male",
    voice: "Steffan",
    photo: true,
  },
  "head-faris": {
    label: "Faris · talking head",
    character: "faris",
    gender: "Male",
    voice: "Alloy",
    photo: true,
  },
  "head-gabrielle": {
    label: "Gabrielle · talking head",
    character: "gabrielle",
    gender: "Female",
    voice: "Nova",
    photo: true,
  },
  "head-hyejin": {
    label: "Hyejin · talking head",
    character: "hyejin",
    gender: "Female",
    voice: "Jane",
    photo: true,
  },
  "head-imran": {
    label: "Imran · talking head",
    character: "imran",
    gender: "Male",
    voice: "Andrew",
    photo: true,
  },
  "head-isabella": {
    label: "Isabella · talking head",
    character: "isabella",
    gender: "Female",
    voice: "Ava",
    photo: true,
  },
  "head-layla": {
    label: "Layla · talking head",
    character: "layla",
    gender: "Female",
    voice: "Emma",
    photo: true,
  },
  "head-liwei": {
    label: "Liwei · talking head",
    character: "liwei",
    gender: "Male",
    voice: "Brian",
    photo: true,
  },
  "head-ling": {
    label: "Ling · talking head",
    character: "ling",
    gender: "Female",
    voice: "Jenny",
    photo: true,
  },
  "head-marcus": {
    label: "Marcus · talking head",
    character: "marcus",
    gender: "Male",
    voice: "Davis",
    photo: true,
  },
  "head-matteo": {
    label: "Matteo · talking head",
    character: "matteo",
    gender: "Male",
    voice: "Adam",
    photo: true,
  },
  "head-rahul": {
    label: "Rahul · talking head",
    character: "rahul",
    gender: "Male",
    voice: "Steffan",
    photo: true,
  },
  "head-rana": {
    label: "Rana · talking head",
    character: "rana",
    gender: "Female",
    voice: "Aria",
    photo: true,
  },
  "head-ren": {
    label: "Ren · talking head",
    character: "ren",
    gender: "Male",
    voice: "Alloy",
    photo: true,
  },
  "head-riya": {
    label: "Riya · talking head",
    character: "riya",
    gender: "Female",
    voice: "Serena",
    photo: true,
  },
  "head-sakura": {
    label: "Sakura · talking head",
    character: "sakura",
    gender: "Female",
    voice: "Phoebe",
    photo: true,
  },
  "head-simone": {
    label: "Simone · talking head",
    character: "simone",
    gender: "Female",
    voice: "Evelyn",
    photo: true,
  },
  "head-zayd": {
    label: "Zayd · talking head",
    character: "zayd",
    gender: "Male",
    voice: "Andrew",
    photo: true,
  },
  "head-zoe": {
    label: "Zoe · talking head",
    character: "zoe",
    gender: "Female",
    voice: "Nova",
    photo: true,
  },
  // VASA-2 talking heads (preview).
  "head-leonie": {
    label: "Leonie · talking head, VASA-2 preview",
    character: "leonie",
    gender: "Female",
    voice: "Emma",
    photo: true,
    photoModel: "vasa-2",
  },
  "head-leonie-professional": {
    label: "Leonie Professional · talking head, VASA-2 preview",
    character: "leonie-professional",
    gender: "Female",
    voice: "Serena",
    photo: true,
    photoModel: "vasa-2",
  },
  "head-george": {
    label: "George · talking head, VASA-2 preview",
    character: "george",
    gender: "Male",
    voice: "Davis",
    photo: true,
    photoModel: "vasa-2",
  },
  "head-marcel": {
    label: "Marcel · talking head, VASA-2 preview",
    character: "marcel",
    gender: "Male",
    voice: "Brian",
    photo: true,
    photoModel: "vasa-2",
  },
};
/** The picture shown for a presenter in the gallery. */
export const avatarPicture = (key: string): string =>
  AVATAR_PRESETS[key]?.photo ? `/avatars/${key}.jpg` : `/avatars/${key}.png`;

export const DEFAULT_PRESENTER = "lisa-casual";

export function presenter(key?: string): { key: string; preset: AvatarPreset } {
  const k = key && AVATAR_PRESETS[key] ? key : DEFAULT_PRESENTER;
  return { key: k, preset: AVATAR_PRESETS[k] };
}

/** Voices a presenter can speak with: the standalone neural voices. */
export const PRESENTER_VOICES = Object.keys(PINNED_VOICES);

/**
 * A stored voice is either a pinned speaker name (Ava) or a full service name
 * (en-US-JennyNeural) chosen from the live list.
 */
export function presenterVoice(name?: string, fallback = "Ava"): string {
  const match = PRESENTER_VOICES.find(
    (v) => v.toLowerCase() === (name ?? "").toLowerCase(),
  );
  return match ?? (isVoiceId(name) ? name : fallback);
}

export const BACKGROUNDS: { label: string; value: string }[] = [
  { label: "Studio slate", value: "#1F2A37" },
  { label: "Deep navy", value: "#0F2744" },
  { label: "Soft gray", value: "#E5E7EB" },
  { label: "Warm white", value: "#F7F4EE" },
  { label: "Forest", value: "#17352B" },
];

export const DEFAULT_BACKGROUND = BACKGROUNDS[0].value;

export function backgroundColor(v?: string): string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)
    ? v.toUpperCase()
    : DEFAULT_BACKGROUND;
}

/**
 * The batch service cuts a single video off at 20 minutes, so a script that
 * would run past it is refused before anything is billed.
 */
export const MAX_AVATAR_MINUTES = 20;
