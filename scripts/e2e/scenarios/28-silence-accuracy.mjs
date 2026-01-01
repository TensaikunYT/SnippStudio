// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The silence finder against the truth of the 2- and 30-minute talks (the
// 10-minute one is measured in scenario 22), phase 4A.4: inserted silences
// found / missed, cuts into audible speech. Through the agent tool (the same
// path an agent takes); a run that takes long comes back as a job.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { connectAgent, itemsOf } from '../agent-client.mjs'
import { assertSilence, loadTalk, silenceHits } from '../talk.mjs'
import { TESTDATA } from '../media.mjs'
import { rangesOf } from './22-agent-rough-cut.mjs'
export const name = 'silence-finder-vs-truth-2-30min'
export const freshWindow = true

export async function run({ c, app, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const out = join(TESTDATA, 'e2e-sonuc')
  mkdirSync(out, { recursive: true })
  const file = join(out, 'sessizlik.json')
  const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  for (const talk of ['ham-02dk-en', 'ham-30dk-en']) {
    await lib.reset(c)
    const { truth } = await loadTalk({ c, app, lib, name: talk })
    const ag = await connectAgent({ c, app, assert, client: 'silence-check' })
    const t0 = Date.now()
    let r = await ag.call('analyze', { kind: 'silences' })
    const job = /as job (j\d+)/.exec(r.text)?.[1]
    while (job && !/^j\d+ .*: done\./m.test(r.text)) r = await ag.call('job', { id: job, wait: 60 })
    const seconds = (Date.now() - t0) / 1000
    const hits = silenceHits(talk, truth, rangesOf(itemsOf(r.text)))
    all[talk] = { ...hits, seconds }
    console.log(`     silences vs truth (${talk}): found ${hits.found}/${hits.inserted}, wrong (into word times) ${hits.wrong}, of them loud ${hits.wrongLoud} (near ${hits.near.length}), natural pauses ${hits.naturalPauses}; cut ${hits.cutSeconds} s vs ideal ${hits.idealSeconds} s: ${hits.overCutSeconds} s more (${hits.overCutInWords} s in word times, ${hits.overCutInPauses} s natural pauses), ${seconds.toFixed(1)} s`)
    // Phase 4A.9 (T7): missed, speech cut, cuts and seconds into word times,
    // and the total against the ideal rough cut: talk.mjs assertSilence.
    assertSilence(assert, talk, hits)
  }
  writeFileSync(file, JSON.stringify(all, null, 1))
}
