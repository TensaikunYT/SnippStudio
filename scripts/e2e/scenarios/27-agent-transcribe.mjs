// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent's "make the subtitles" (phase 4A.5): job {"start":"transcribe"}
// runs the app's own Whisper path (the Subtitles button's code) with the
// multilingual model in app\models, on the short Turkish and English samples
// (testdata\ornek, ≈ 60 s each). The job id comes back at once; job {id,
// wait} waits; the lines land in the project. Time and word error rate
// against the samples' true text are written down (e2e-sonuc\transcribe.json).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connectAgent } from '../agent-client.mjs'
import { TESTDATA } from '../media.mjs'
export const name = 'agent-job-transcribe-tr-en'
/** 144 s measured on 16 Nov 2026 (the real speech model), × 3 (e2e limit.mjs). */
export const timeoutMs = 450_000
export const freshWindow = true

const fold = (s) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean)

/** Word error rate: edits (substitutions, insertions, deletions) / words of the truth. */
export function wer(truth, said) {
  const a = fold(truth)
  const b = fold(said)
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length] / Math.max(1, a.length)
}

export async function run({ c, app, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const results = {}
  // Audit patch D1: the Turkish talk in a project made in the Turkish
  // interface, with no language in the call ("auto" = the project's spoken
  // language, which the project answer says); the English one names its own.
  for (const [sample, language, ui] of [['tr-kisa', undefined, 'tr'], ['en-kisa', 'en', 'en']]) {
    await c.run((l) => window.__store.getState().setUiLang(l), ui)
    await lib.reset(c)
    const [wav] = await lib.seedAssets(app, c, [join(TESTDATA, 'ornek', `${sample}.wav`)])
    await lib.seedTimeline(c, [wav.id])
    const ag = await connectAgent({ c, app, assert, client: 'transcribe-check' })
    const spoken = ui === 'tr' ? 'tr' : 'en'
    assert.match((await ag.call('project', {})).text, new RegExp(`^Spoken language: ${spoken}$`, 'm'))
    const t0 = Date.now()
    const start = await ag.call('job', language ? { start: 'transcribe', language } : { start: 'transcribe' })
    const id = /^(j\d+) /.exec(start.text)?.[1]
    assert.ok(id, start.text)
    assert.ok(Date.now() - t0 < 5000, 'the job id comes back at once')
    // Asked again on the same version, in any language: the same job (one
    // Whisper at a time, phase 4A.8 G4).
    const again = await ag.call('job', { start: 'transcribe', language: language === 'tr' ? 'en' : 'tr' })
    assert.ok(again.text.startsWith(id + ' '), again.text)
    let r = start
    while (!/: (done|failed)/.test(r.text) && Date.now() - t0 < 900_000) r = await ag.call('job', { id, wait: 60 })
    const seconds = (Date.now() - t0) / 1000
    assert.match(r.text, /: done\./, r.text)
    assert.match(r.text, new RegExp(`subtitle lines \\(${spoken}\\)`), r.text)
    const said = await c.st((s) => s.project.captions.filter((k) => !k.manual && !k.shape).map((k) => k.text).join(' '))
    const timed = await c.st((s) => s.project.captions.filter((k) => k.words?.length).length)
    const truth = JSON.parse(readFileSync(join(TESTDATA, 'ornek', `${sample}.truth.json`), 'utf8'))
    const w = wer(truth.text, said)
    results[sample] = { seconds: +seconds.toFixed(1), audioSeconds: truth.sure, lines: (await c.st((s) => s.project.captions.length)), timedLines: timed, wer: +w.toFixed(3), answer: r.text.split('\n')[1] }
    console.log(`     transcribe ${sample}: ${seconds.toFixed(1)} s for ${truth.sure} s of sound, ${results[sample].lines} lines, WER ${(w * 100).toFixed(1)} %`)
    assert.ok(results[sample].lines > 3)
    assert.ok(timed > 0, 'word times')
    // Now there are subtitles: transcribing again would replace them all,
    // so it is refused unless the agent says replace:true (G3, T8).
    const lines = await c.st((s) => s.project.captions.filter((k) => !k.manual && !k.shape).length)
    const refused = await ag.call('job', { start: 'transcribe', language: language ?? 'auto' }, { allowError: true })
    assert.equal(refused.isError, true)
    assert.match(refused.text, new RegExp(`has ${lines} subtitle lines; transcribe replaces ALL of them\\. Send replace:true`))
    // The point before the agent was written before the lines landed.
    const pts = await c.run(() => window.__agent.restorePoints())
    assert.equal(pts[0]?.kind, 'pre', 'a restore point first')
  }
  const out = join(TESTDATA, 'e2e-sonuc')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'transcribe.json'), JSON.stringify(results, null, 1))
}
