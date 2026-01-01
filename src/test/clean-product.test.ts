// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio 1b.8 (a): the product has no narrator hands, no cut-out
// characters, no Stage, none of the three hand templates, no hand transitions
// or portals, and no edition switch — not in a file, an import or a word of
// the source. The one place allowed to name them is the old-project reader
// (media/legacy.ts), which takes them out of a file made with the user's own
// Snipp. The built app is checked the same way by scripts/qa/clean-bundle.mjs.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import test from 'node:test'
import { TEMPLATE_KINDS } from '../renderer/src/templates/model'

const APP = join(__dirname, '..', '..')
const SRC = join(APP, 'src')
const posix = (p: string): string => p.split(sep).join('/')

function sources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx|css|html|mjs|cjs|js)$/.test(n)) out.push({ file: posix(relative(SRC, p)), text: readFileSync(p, 'utf8') })
    }
  }
  walk(SRC)
  return out
}

// Allowed to name what it takes out: the reader and its own tests (and this).
const READER = new Set(['renderer/src/media/legacy.ts', 'test/legacy.test.ts', 'test/clean-product.test.ts'])

test('the removed folders and files are gone', () => {
  const gone = [
    'renderer/src/stage', 'renderer/src/live', 'renderer/src/character', 'renderer/stage-live.html',
    'renderer/src/effects/portal.ts', 'renderer/src/playback/hand-transitions.ts', 'renderer/src/playback/film-hands.ts',
    'renderer/src/subtitles/choreo.ts', 'renderer/src/templates/blackhole.ts', 'renderer/src/templates/brand.ts',
    'renderer/src/export/pops.ts', 'renderer/src/audio/score.ts', 'renderer/src/edition.ts',
    'renderer/src/components/CharacterInspector.tsx', 'renderer/src/components/CharacterPanel.tsx', 'renderer/src/components/CharacterLanes.tsx',
    'renderer/src/components/HandActionPicker.tsx', 'renderer/src/components/HandLinkControls.tsx', 'renderer/src/components/ChoreoPanel.tsx',
    'renderer/src/components/StageStudio.tsx', 'renderer/src/components/SceneTimeline.tsx'
  ]
  for (const g of gone) assert.equal(existsSync(join(SRC, g)), false, g)
  for (const g of ['resources/characters', 'resources/world', 'scripts/stage-film', 'scripts/make-cutout-set.py', 'scripts/make-stage-pack.py']) {
    assert.equal(existsSync(join(APP, g)), false, g)
  }
})

test('nothing imports them', () => {
  const removed = /from ['"][^'"]*\/(?:stage|live|character|edition|choreo|hand-transitions|film-hands|portal|blackhole(?:-gl)?|brand|pops|score|quick-preview)(?:\/[^'"]*)?['"]|from ['"]three['"]/
  const hits = sources().filter((s) => removed.test(s.text)).map((s) => s.file)
  assert.deepEqual(hits, [])
})

test('no word or name of them in the source', () => {
  const words: [string, RegExp][] = [
    ['hands', /narrator hands?|\bhandDraw|\bhandMode\b|restMarks|recordHandMove|handThrowOut|layeredByHands|drawHandsLayer|filmUnderHandsAt|lightHands|HandAction|HandLink|RestPad|the hands'/],
    ['characters', /\bcharacters:|\.characters\b|characterSel|editCharacters|Character(?:Inspector|Panel|Lanes)|SampleCharacter|character:(?:import|sample)|role: 'character'|cut-?out characters?/],
    ['stage', /Stage Studio|StageStudio|the Stage\b|stageVersions|stage-live|stage-film|terrain:read|world:read|file:write-credits/],
    ['stage', /\bstage (?:films?|sounds?|script|hand)\b/i],
    ['choreography', /choreo/i],
    ['templates', /blackhole|black hole/i],
    ['portal', /'portal'|"portal"|\bportal\b(?! has no ancestors)/],
    ['film tool', /film\.mjs/],
    ['edition', /__SNIPP_EDITION__|build:studio|\bFEATURES\b/]
  ]
  const hits: string[] = []
  for (const s of sources()) {
    if (READER.has(s.file)) continue
    s.text.split(/\r?\n/).forEach((line, i) => {
      for (const [what, re] of words) if (re.test(line)) hits.push(`${s.file}:${i + 1} [${what}] ${line.trim().slice(0, 100)}`)
    })
  }
  assert.deepEqual(hits, [])
})

test('the template list has none of the three hand templates', () => {
  for (const k of ['intro', 'outro', 'blackhole']) assert.equal((TEMPLATE_KINDS as string[]).includes(k), false, k)
  assert.equal(TEMPLATE_KINDS.length, 31)
})

test('package.json: no three.js, one build', () => {
  const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts: Record<string, string> }
  assert.equal('three' in { ...pkg.dependencies, ...pkg.devDependencies }, false)
  assert.equal('@types/three' in { ...pkg.dependencies, ...pkg.devDependencies }, false)
  assert.equal('build:studio' in pkg.scripts, false)
})
