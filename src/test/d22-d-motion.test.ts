// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, L2: one place says whether the interface's own motion runs
// (ui/motion.ts): Settings → General → Animations (system / on / off), told to
// the sheets by `html.motion-off` and to the scripts by `motionOff()`. No
// sheet and no other module reads the system's setting itself. And L6: the
// one-time move of the timeline's lane height to small.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { MOTION_PREFS, motionIsOff, motionPrefOf } from '../renderer/src/ui/motion'
import { movedToSmall, trackScaleOf } from '../renderer/src/timeline/view-math'
import { STRINGS } from '../renderer/src/ui/strings'

const SRC = resolve(process.cwd(), 'src', 'renderer', 'src')
const filesIn = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? filesIn(p, ext) : ext.test(f) ? [p] : []
  })
const codeOf = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

test('only ui/motion.ts reads the system\'s "less motion"; every sheet answers html.motion-off', () => {
  const readers = filesIn(SRC, /\.(tsx?|css)$/)
    .filter((f) => /prefers-reduced-motion/.test(codeOf(f)))
    .map((f) => relative(SRC, f).replace(/\\/g, '/'))
  assert.deepEqual(readers, ['ui/motion.ts'])
  for (const sheet of ['ui/tokens.css', 'ui/base.css', 'ui/kit.css', 'components/agent/agent.css']) assert.match(readFileSync(join(SRC, sheet), 'utf8'), /html\.motion-off\b/, sheet)
})

test('the pictures pointed at to see a transition or an animation play do not ask the motion setting', () => {
  for (const f of ['components/inspector/transition-preview.tsx', 'components/text/draw.ts', 'components/text/TextAnims.tsx', 'components/text/TextReady.tsx', 'components/inspector/anim-grid.tsx']) {
    assert.equal(/motionOff|matchMedia/.test(codeOf(join(SRC, f))), false, f)
  }
})

test('motionIsOff: off, or following a system that asks for less', () => {
  assert.deepEqual(MOTION_PREFS, ['system', 'on', 'off'])
  assert.equal(motionIsOff('system', false), false)
  assert.equal(motionIsOff('system', true), true)
  assert.equal(motionIsOff('on', true), false)
  assert.equal(motionIsOff('on', false), false)
  assert.equal(motionIsOff('off', false), true)
  assert.equal(motionIsOff('off', true), true)
})

test('motionPrefOf: anything unknown follows the system', () => {
  assert.equal(motionPrefOf(null), 'system')
  assert.equal(motionPrefOf(''), 'system')
  assert.equal(motionPrefOf('yes'), 'system')
  assert.equal(motionPrefOf('on'), 'on')
  assert.equal(motionPrefOf('off'), 'off')
})

test('the choice says when the system is why nothing moves, in both languages', () => {
  assert.match(STRINGS['d22d.motion.system.off'].en, /off now/)
  assert.match(STRINGS['d22d.motion.system.off'].tr, /şu anda kapalı/)
})

test('L6: the one-time move to small takes a profile with no height or the medium written for it; small and large stay', () => {
  assert.equal(movedToSmall(null), true)
  assert.equal(movedToSmall('medium'), true)
  assert.equal(movedToSmall('nonsense'), true)
  assert.equal(movedToSmall('small'), false)
  assert.equal(movedToSmall('large'), false)
  // (After the move a chosen medium is read as medium again.)
  assert.equal(trackScaleOf('medium'), 'medium')
})
