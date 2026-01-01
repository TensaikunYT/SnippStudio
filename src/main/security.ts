// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { isLocalFilePath, pathApi } from './platform-path'

// The platform's rule (platform-path.ts, phase 10a); recents-store.ts keeps its
// own copy (it imports nothing relative) and a test checks the two agree.
export { isLocalFilePath }

const OUTPUT_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.srt', '.vtt', '.txt', '.json', '.snipp', '.autocut'
])
export function isSafeOutput(value: string): boolean {
  return isLocalFilePath(value) && OUTPUT_EXTENSIONS.has(pathApi().extname(value).toLowerCase())
}

export function isModelStoreFile(name: string): boolean {
  return /^huggingface\.co_onnx-community_whisper-(?:medium|small|base)(?:\.en)?_timestamped_resolve_(?:main|[a-f0-9]{40})_(?:(?:config|generation_config|preprocessor_config|tokenizer_config|tokenizer)\.json|onnx_(?:encoder_model|decoder_model_merged)(?:_fp16|_quantized|_int8|_uint8)?\.onnx)$/.test(name)
}

export function filterRecentEntries(entries: unknown, allowed: (p: string) => boolean): unknown[] | null {
  if (!Array.isArray(entries) || entries.length > 10000) return null
  return entries.filter((entry) => {
    const p = entry?.path
    return isLocalFilePath(p) && /\.(snipp|autocut|json)$/i.test(p) && allowed(pathApi().normalize(p))
  })
}
