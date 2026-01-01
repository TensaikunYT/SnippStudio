// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/e2e/eval.mjs <file.mjs>: against the window hold.mjs keeps
// open. A scenario file (exports `run`) runs from a reset editor, as in
// run.mjs; any other file's `export default async (ctx) => …` runs as is and
// its return value is printed. For writing scenarios.
import { readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { connect } from './cdp.mjs'
import { answersFor, eventsOf } from './app.mjs'
import { makeE2eMedia } from './media.mjs'
import * as lib from './lib.mjs'

const hold = JSON.parse(readFileSync(fileURLToPath(new URL('./.hold.json', import.meta.url)), 'utf8'))
const c = await connect(hold.port)
const app = { ...hold, cdp: c, answers: answersFor(hold.profile), events: () => eventsOf(hold.profile) }
const ctx = { c, app, media: makeE2eMedia(), lib, work: hold.profile, out: hold.profile }
try {
  const mod = await import(pathToFileURL(resolve(process.argv[2])).href + '?' + Date.now())
  if (mod.run) {
    await lib.reset(c)
    app.answers.set([])
    const t0 = Date.now()
    await mod.run(ctx)
    await lib.rootStill(c)
    console.log(`ok ${mod.name} ${Date.now() - t0} ms`)
  } else {
    const out = await mod.default(ctx)
    if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1))
  }
} catch (e) {
  console.log('FAIL', e.stack)
  console.log('events:', JSON.stringify(app.events().slice(-2)))
  process.exitCode = 1
} finally {
  c.close()
}
