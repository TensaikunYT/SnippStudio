// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * The speech model the app runs: one, the multilingual Whisper Medium
 * (SnippStudio phase 9a, decision 7). It ships with the app (about 0.94 GB,
 * its q8 CPU pair) and transcribes Turkish, English and 97 other languages;
 * the user picks the spoken language, never a model. The English-only model
 * the app once had is gone from the product: a development copy may still
 * hold its files in models\, and the app does not know them.
 *
 * `key` is the substring that identifies the model's files in the on-disk
 * store (their names come from the download URL).
 */
export interface WhisperModel {
  /** transformers.js model id. */
  id: string
  /** Pin the multilingual weights to an audited Hub commit. */
  revision?: string
  /** Substring identifying this model's files in the store. */
  key: string
  label: string
  /** Roughly how much disk a complete set takes, for the message. */
  size: string
}

/** What a project file stores under `transcription.model`. It names no
 *  model any more: older files say 'english' when they were made for the
 *  English-only model, which means "the spoken language is English" when
 *  they set no language (spokenLanguage). New files keep writing it as they
 *  did, so the file format is unchanged. */
export type WhisperModelChoice = 'english' | 'multilingual'

// Names accepted by the bundled Transformers.js Whisper language mapper.
// Keep this list local: the editor never queries a server for language data.
export const WHISPER_SPOKEN_LANGUAGES = [
  'afrikaans', 'albanian', 'amharic', 'arabic', 'armenian', 'assamese',
  'azerbaijani', 'bashkir', 'basque', 'belarusian', 'bengali', 'bosnian',
  'breton', 'bulgarian', 'catalan', 'chinese', 'croatian', 'czech',
  'danish', 'dutch', 'english', 'estonian', 'faroese', 'finnish',
  'french', 'galician', 'georgian', 'german', 'greek', 'gujarati',
  'haitian creole', 'hausa', 'hawaiian', 'hebrew', 'hindi', 'hungarian',
  'icelandic', 'indonesian', 'italian', 'japanese', 'javanese', 'kannada',
  'kazakh', 'khmer', 'korean', 'lao', 'latin', 'latvian', 'lingala',
  'lithuanian', 'luxembourgish', 'macedonian', 'malagasy', 'malay',
  'malayalam', 'maltese', 'maori', 'marathi', 'mongolian', 'myanmar',
  'nepali', 'norwegian', 'nynorsk', 'occitan', 'pashto', 'persian',
  'polish', 'portuguese', 'punjabi', 'romanian', 'russian', 'sanskrit',
  'serbian', 'shona', 'sindhi', 'sinhala', 'slovak', 'slovenian',
  'somali', 'spanish', 'sundanese', 'swahili', 'swedish', 'tagalog',
  'tajik', 'tamil', 'tatar', 'telugu', 'thai', 'tibetan', 'turkish',
  'turkmen', 'ukrainian', 'urdu', 'uzbek', 'vietnamese', 'welsh',
  'yiddish', 'yoruba'
] as const
export type WhisperLanguage = 'auto' | (typeof WHISPER_SPOKEN_LANGUAGES)[number]

export const MULTILINGUAL_REVISION = '9fe933aaa6b0244316eb961f36d33dfedf0c0b0c'

/** The model the app knows: one (decision 7). A list so the message for a
 *  missing model can name what to put where. */
export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: 'onnx-community/whisper-medium_timestamped',
    revision: MULTILINGUAL_REVISION,
    key: `whisper-medium_timestamped_resolve_${MULTILINGUAL_REVISION}`,
    label: 'Whisper Medium (multilingual)',
    size: '~0.94 GB'
  }
]

/** The language Whisper is told is spoken. transformers.js cannot detect it
 *  (its Whisper generate() falls back to English when none is given), so a
 *  run always names one: the project's choice; with none ("auto", the old
 *  default), English when the project was made for the English-only model
 *  (that is what it meant) and Turkish otherwise (what the multilingual
 *  model was told before; phase 9a, FAZ9-PLAN.md). */
export type SpokenLanguage = Exclude<WhisperLanguage, 'auto'>
export function spokenLanguage(t?: { model?: string; language?: string } | null): SpokenLanguage {
  const l = t?.language
  if (l && l !== 'auto' && (WHISPER_SPOKEN_LANGUAGES as readonly string[]).includes(l)) return l as SpokenLanguage
  return t?.model === 'multilingual' ? 'turkish' : 'english'
}

/** A complete set is the config files plus the q8 encoder/decoder pair. */
export const MODEL_MIN_FILES = 3
export const MODEL_CORE_FILES = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer_config.json', 'tokenizer.json'] as const
export const MODEL_CPU_FILES = ['encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx'] as const

/** Exact model-specific needle; another model's ONNX pair must never count. */
export function modelFileNeedle(model: WhisperModel, file: string): string {
  return `${model.key}${model.revision ? '' : '_resolve_main'}_onnx_${file}`
}

export function modelRootNeedle(model: WhisperModel, file: string): string {
  return `${model.key}${model.revision ? '' : '_resolve_main'}_${file}`
}

/** The store key of one of a model's ONNX files: the URL transformers.js
 *  asks the cache for (main turns it into the file name). */
export function modelFileUrl(model: WhisperModel, file: string): string {
  return `https://huggingface.co/${model.id}/resolve/${model.revision ?? 'main'}/onnx/${file}`
}

// ---------------------------------------------------------------------------
// Memory before a load. The editor's renderer holds the whole load: each ONNX
// file once in JS, and in ORT's WASM heap the file again while it is parsed,
// with its parsed weights beside it. Measured (2026-10-16, 16 GB PC): the q8
// pair (0.99 GB of files) took 2.2 GB at its peak, flat through the run. On a
// 16 GB PC with a browser and the usual programs open there are often only
// 6-7 GB free; loading with less free than the set needs pages the whole PC
// to a standstill. (The English-only GPU set this rule was first made for
// took more than 5.5 GB; it is gone, decision 7.)
// ---------------------------------------------------------------------------

const MiB = 1024 * 1024
/** System memory a load takes: twice its files and a little. */
export const WHISPER_CPU_FACTOR = 2
export const WHISPER_CPU_OVERHEAD = 300 * MiB
/** Beside the load: room for Windows and the editor. */
export const WHISPER_CPU_HEADROOM = 1024 * MiB
/** The last resort's room (one thread, the least the model can take). */
export const WHISPER_TIGHT_HEADROOM = 600 * MiB

export function whisperCpuPeak(fileBytes: readonly number[]): number {
  if (fileBytes.length === 0) return 0
  return WHISPER_CPU_FACTOR * fileBytes.reduce((a, b) => a + b, 0) + WHISPER_CPU_OVERHEAD
}

export type WhisperMemoryPlan =
  /** Load as usual; `safe` 2 when only just (one thread), said in the label. */
  | { use: 'load'; note?: string; safe?: number }
  /** It does not fit: stop with this message instead of loading. */
  | { use: 'none'; error: string }

export const TIGHT_MEMORY_NOTE = 'Very low memory — the model on one thread'

const gb = (bytes: number): string => (bytes / 1e9).toFixed(1)

/**
 * Whether the model may load now. `free` is the OS's free memory (null when
 * unknown: then nothing is checked); `set` the sizes of the installed q8
 * pair (null when unknown). The thresholds are the ones English already had
 * for this same pair (its fallback): with room as usual; with less, on one
 * thread; with less still, not at all. Pure.
 */
export function planWhisperMemory(input: { free: number | null; set: readonly number[] | null }): WhisperMemoryPlan {
  const { free, set } = input
  if (free === null || !Number.isFinite(free) || !set || set.length === 0) return { use: 'load' }
  const peak = whisperCpuPeak(set)
  if (free >= peak + WHISPER_CPU_HEADROOM) return { use: 'load' }
  if (free >= peak + WHISPER_TIGHT_HEADROOM) return { use: 'load', note: TIGHT_MEMORY_NOTE, safe: 2 }
  return {
    use: 'none',
    error: `Not enough free memory to load the speech model: ${gb(free)} GB free, about ${gb(peak + WHISPER_TIGHT_HEADROOM)} GB needed. Close other programs and try again.`
  }
}

/**
 * The installed model, given something that can count files matching a
 * key: its config files and its q8 pair. Returns null when it is not all
 * there — the caller then says so instead of trying to download on a
 * machine that may have no network.
 */
export async function pickInstalledModel(count: (needle: string) => Promise<number>): Promise<WhisperModel | null> {
  for (const model of WHISPER_MODELS) {
    if ((await count(model.key)) < MODEL_MIN_FILES) continue
    const core = await Promise.all(MODEL_CORE_FILES.map((file) => count(modelRootNeedle(model, file))))
    if (!core.every((n) => n > 0)) continue
    // Only the q8 pair: the multilingual fp16 decoder writes invalid word
    // offsets on WebGPU, and the app does not ship it.
    const cpu = await Promise.all(MODEL_CPU_FILES.map((file) => count(modelFileNeedle(model, file))))
    if (cpu.every((n) => n > 0)) return model
  }
  return null
}
