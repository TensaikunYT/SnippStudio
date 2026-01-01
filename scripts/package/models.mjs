// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The package's one speech model (SnippStudio phase 9a, decision 7): the
// multilingual medium set (CPU pair, ≈ 0.94 GB), copied from models/ (the
// development set, which also holds the English GPU pair) into models-dist/,
// the folder electron-builder.config.cjs packages as resources/models.
// Nothing is downloaded. A file already there with the same size is kept.
//
//   [SNIPP_MODELS_DIR=<folder>] node scripts/package/models.mjs [--check]   --check: only say what is missing
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('../..', import.meta.url))
// SNIPP_MODELS_DIR: the folder holding the model when this tree has none (the
// clean clone of the public branch: the weights are not in git; YAYIN.md).
const SRC = process.env.SNIPP_MODELS_DIR ? resolve(process.env.SNIPP_MODELS_DIR) : join(APP, 'models')
const DST = join(APP, 'models-dist')

/** The multilingual set's files: their names hold its pinned revision. */
export function multilingualRevision() {
  const ts = readFileSync(join(APP, 'src', 'renderer', 'src', 'subtitles', 'models.ts'), 'utf8')
  const m = /MULTILINGUAL_REVISION = '([0-9a-f]{40})'/.exec(ts)
  if (!m) throw new Error('MULTILINGUAL_REVISION not found in subtitles/models.ts')
  return m[1]
}

/** True for a model file the package carries. */
export const isPackagedModel = (name, rev = multilingualRevision()) => name.includes(`onnx-community_whisper-medium_timestamped_resolve_${rev}_`)

/** The files of the set; the CPU pair must be among them (models.ts: the
 *  multilingual model runs only on the CPU pair). */
export const REQUIRED = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx_encoder_model_quantized.onnx', 'onnx_decoder_model_merged_quantized.onnx']

function main() {
  const check = process.argv.includes('--check')
  const rev = multilingualRevision()
  if (!existsSync(SRC)) throw new Error(`No models/ folder (${SRC}): the speech model is not in git; see models-dist/README.md.`)
  const want = readdirSync(SRC).filter((n) => isPackagedModel(n, rev))
  const missing = REQUIRED.filter((r) => !want.some((n) => n.endsWith('_' + r)))
  if (missing.length) throw new Error(`models/ lacks the multilingual set's ${missing.join(', ')}`)
  mkdirSync(DST, { recursive: true })
  let copied = 0, kept = 0, bytes = 0
  for (const n of want) {
    const from = join(SRC, n), to = join(DST, n)
    const size = statSync(from).size
    bytes += size
    if (existsSync(to) && statSync(to).size === size) { kept++; continue }
    if (check) { console.log(`would copy ${n}`); continue }
    copyFileSync(from, to)
    copied++
  }
  // Anything else in models-dist (an English set from before) is not packaged.
  for (const n of readdirSync(DST)) {
    if (n === 'README.md' || want.includes(n)) continue
    if (check) console.log(`would remove ${n}`)
    else rmSync(join(DST, n), { force: true })
  }
  console.log(`speech model: ${want.length} files, ${(bytes / 2 ** 30).toFixed(2)} GiB (${copied} copied, ${kept} already there)`)
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main()
