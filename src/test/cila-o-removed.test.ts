// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila O (CILA-O-PLAN.md K6): the B-roll window, the Automation window and its
// template suggestions panel were removed, not hidden. Nothing of them is
// left in the source: no component, no data-testid, no word, no style, no
// scenario step, no folder-picker bridge. What stays on purpose is told apart:
// the commands the agent uses (automation.placeImages, broll.place), the
// timeline's "picture #n missing" slot (Clip.automationMissing) and the
// clip/volume automation (keyframes), which only share a word.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import { STRINGS } from '../renderer/src/ui/strings'

const ROOT = join(__dirname, '..', '..')
function walk(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, ext, out)
    else if (ext.test(name)) out.push(p)
  }
  return out
}
const files = [
  ...walk(join(ROOT, 'src', 'renderer', 'src'), /\.(tsx?|css)$/),
  ...walk(join(ROOT, 'src', 'preload'), /\.ts$/),
  ...walk(join(ROOT, 'src', 'main'), /\.ts$/),
  ...walk(join(ROOT, 'scripts', 'e2e'), /\.mjs$/)
]
const hits = (re: RegExp): string[] =>
  files.flatMap((f) =>
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .map((line, i) => (re.test(line) ? `${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 120)}` : null))
      .filter((x): x is string => x !== null)
  )

test('the removed windows are gone: components, test ids, words, styles, the folder picker', () => {
  assert.ok(files.length > 300, `${files.length} files looked at`)
  // The components and their props.
  assert.deepEqual(hits(/\b(AutomationDialog|BrollDialog|SuggestPanel|useSuggestions|SUGGEST_INFO|SUGGEST_DEFAULT|onAutomation|onBroll|showAutomation|showBroll)\b/), [])
  // Their data-testids (as written in the source and driven by scenarios).
  assert.deepEqual(hits(/['"`](topbar\.(automation|broll)|dialog\.(automation|broll)|automation\.(close|cancel|apply|import|import-srt|grouping|timing|target|motion|transition|images\.\w+|add-folders|mode)|broll\.(close|cancel|apply|look(\.\w+)?|skip-used)|suggest\.(on|gap))['"`]/), [])
  // Their words.
  assert.deepEqual(hits(/['"`](win\.auto\.|win\.broll\.|suggest\.|top\.automation|top\.broll|top\.make|app\.automation\.|app\.broll\.)/), [])
  // Their styles.
  assert.deepEqual(hits(/\.(automation-[a-z-]+|broll-[a-z-]+|suggest-[a-z-]+|tool-window|tool-empty|tool-hint|tool-intro|tb-make)\b|className="[^"]*\b(automation-|broll-|suggest-|tool-window|tb-make)/), [])
  // The numbered-folder import only the Automation window used.
  assert.deepEqual(hits(/openImageFoldersDialog|open-image-folders|importImageFolders|pickFolderBrowser/), [])
})

test('no word of the removed windows is left in STRINGS', () => {
  const left = Object.keys(STRINGS).filter((k) => /^(win\.auto\.|win\.broll\.|suggest\.|top\.automation|top\.broll|top\.make$|app\.automation\.|app\.broll\.)/.test(k))
  assert.deepEqual(left, [])
})

test('what stays on purpose is still there: the agent\'s commands and plans, the missing-picture slot, Fit to voice', () => {
  const src = (p: string): string => readFileSync(join(ROOT, 'src', 'renderer', 'src', p), 'utf8')
  assert.match(src('commands/automation.ts'), /name: 'automation\.placeImages'/)
  assert.match(src('commands/automation.ts'), /name: 'broll\.place'/)
  assert.match(src('agent/analyze.ts'), /case 'image_plan'/)
  assert.match(src('agent/analyze.ts'), /case 'broll_plan'/)
  assert.match(src('types.ts'), /automationMissing\?:/)
  assert.match(src('components/MediaBin.tsx'), /testid="media\.fit-voice"/)
})
