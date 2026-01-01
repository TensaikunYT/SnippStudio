// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.2, decision 7: every old project sample opens — the real old
// project in testdata\eski, the e2e's old project with hands, the faceless
// channel's project, the format-1 sample and a plain default project — with
// an empty or the expected repair report, no broken rule, and a second
// reading of what this build writes mends nothing. The samples legacy.test.ts
// makes in code are checked there the same way (only it may name what they
// hold: clean-product.test.ts). The damaged samples of
// src\test\fixtures\broken are project-file.test.ts's.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { readProjectToOpen, serializeProject } from '../renderer/src/media/projectio'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import { defaultProject } from '../renderer/src/types'
import { materialDir } from './talk-fixture'

const APP = path.join(__dirname, '..', '..')
const TESTDATA = path.join(APP, '..', 'testdata')

interface Sample {
  name: string
  /** Where the file is (null: made in code). */
  file: string | null
  text: () => string
  /** The repair report the reading gives (codes and counts). */
  repaired: { code: string; count: number }[]
  /** Opened as a copy (held what this app does not have). */
  copy: boolean
}

const fileSample = (file: string, repaired: Sample['repaired'], copy: boolean): Sample => ({ name: path.relative(path.join(APP, '..'), file), file, text: () => readFileSync(file, 'utf8'), repaired, copy })

export const SAMPLES: Sample[] = [
  // The real old project(s) of testdata/eski (made in the user's own Snipp, with hands and Stage).
  ...(existsSync(path.join(TESTDATA, 'eski')) ? readdirSync(path.join(TESTDATA, 'eski')).filter((f) => f.endsWith('.snipp')).map((f) => fileSample(path.join(TESTDATA, 'eski', f), [], true)) : [fileSample(path.join(TESTDATA, 'eski', 'old-project.snipp'), [], true)]),
  fileSample(path.join(TESTDATA, 'e2e', 'legacy-hands.snipp'), [], true),
  fileSample(path.join(materialDir('voiceover', TESTDATA), 'proje.snipp'), [], false),
  fileSample(path.join(APP, 'src', 'test', 'fixtures', 'format-v1.snipp'), [], false),
  { name: 'a plain default project (in code)', file: null, text: () => JSON.stringify(defaultProject()), repaired: [], copy: false }
]

for (const s of SAMPLES) {
  test(`old project opens: ${s.name}`, (t) => {
    if (s.file && !existsSync(s.file)) {
      t.skip('test material not on this machine')
      return
    }
    const read = readProjectToOpen(s.text())
    assert.deepEqual(read.repaired.map((r) => ({ code: r.code, count: r.count })), s.repaired, 'the repair report')
    assert.equal(read.removed.length > 0, s.copy, 'opened as a copy or not')
    assert.equal(describeProblems(checkProject(read.project)), '', 'no broken rule')
    // What this build writes reads back the same, mending nothing.
    const again = readProjectToOpen(serializeProject(read.project))
    assert.deepEqual(again.repaired, [])
    assert.deepEqual(again.removed, [])
    assert.equal(serializeProject(again.project), serializeProject(read.project))
  })
}
