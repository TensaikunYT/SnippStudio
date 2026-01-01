// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 4A.8 (T6): the retake finder measured on what Whisper really writes.
// The 2- and 10-minute talks are transcribed ONCE with the app's own
// multilingual model, through the agent's job (the e2e path of scenario 27),
// and the lines are kept as fixed files: testdata\ham\<talk>.whisper.json.
// src/test/analysis.test.ts measures found / missed / wrong on them. When the
// files are there this scenario only checks them (a normal run stays fast);
// SNIPP_WHISPER_FIXTURES=force makes them again (≈ 13 min). The 30-minute
// talk is not transcribed (time).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectAgent } from '../agent-client.mjs'
import { HAM } from '../talk.mjs'
import { TESTDATA } from '../media.mjs'
export const name = 'whisper-fixtures-ham-02-10'
/** Checks only: 10 s; with SNIPP_WHISPER_FIXTURES=force it transcribes again (about 13 min), × 3 (e2e limit.mjs). */
export const timeoutMs = process.env.SNIPP_WHISPER_FIXTURES === 'force' ? 40 * 60_000 : 120_000
export const freshWindow = true

const TALKS = [['ham-02dk-en', 'en'], ['ham-10dk-tr', 'tr']]

export async function run({ c, app, lib }) {
  const { assert } = lib
  const force = process.env.SNIPP_WHISPER_FIXTURES === 'force'
  for (const [talk, language] of TALKS) {
    const file = join(HAM, `${talk}.whisper.json`)
    if (existsSync(file) && !force) {
      const kept = JSON.parse(readFileSync(file, 'utf8'))
      assert.ok(kept.captions.length > 10 && kept.captions.every((k) => typeof k.start === 'number'), `${talk}: a usable fixture`)
      console.log(`     ${talk}: fixture kept (${kept.captions.length} lines, made ${kept.made}, ${kept.seconds} s)`)
      continue
    }
    await lib.reset(c)
    await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
    const [asset] = await lib.seedAssets(app, c, [join(HAM, `${talk}.mp4`)])
    await lib.seedTimeline(c, [asset.id])
    const ag = await connectAgent({ c, app, assert, client: 'whisper-fixture' })
    const t0 = Date.now()
    let r = await ag.call('job', { start: 'transcribe', language })
    const id = /^(j\d+) /.exec(r.text)?.[1]
    assert.ok(id, r.text)
    while (!/: (done|failed)/.test(r.text) && Date.now() - t0 < 2_400_000) r = await ag.call('job', { id, wait: 60 })
    assert.match(r.text, /: done\./, r.text)
    const seconds = Math.round((Date.now() - t0) / 100) / 10
    const captions = await c.st((s) => s.project.captions.filter((k) => !k.manual && !k.shape).map((k) => ({ id: k.id, start: k.start, end: k.end, text: k.text, ...(k.words ? { words: k.words.map((w) => ({ text: w.text, start: w.start, end: w.end, ...(w.estimated ? { estimated: true } : {}) })) } : {}) })))
    writeFileSync(file, JSON.stringify({ talk, model: 'multilingual', language, made: new Date().toISOString(), seconds, captions }, null, 1))
    console.log(`     ${talk}: transcribed in ${seconds} s, ${captions.length} lines → ${file}`)
  }
  // The retake finder in the app on Whisper's lines: the words AND the sound
  // (a take Whisper did not write is speech with no words). Found / missed /
  // wrong against the truth; written to e2e-sonuc\tekrar-whisper.json.
  const results = {}
  for (const [talk] of TALKS) {
    await lib.reset(c)
    await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
    const [asset] = await lib.seedAssets(app, c, [join(HAM, `${talk}.mp4`)])
    await lib.seedTimeline(c, [asset.id])
    const kept = JSON.parse(readFileSync(join(HAM, `${talk}.whisper.json`), 'utf8'))
    await c.run((caps) => { const s = window.__store.getState(); s.setSubtitles(caps); s.setDirty(false) }, kept.captions)
    const ag = await connectAgent({ c, app, assert, client: 'repeat-check' })
    let r = await ag.call('analyze', { kind: 'repeats' })
    const job = /as job (j\d+)/.exec(r.text)?.[1]
    while (job && !/^j\d+ .*: done\./m.test(r.text)) r = await ag.call('job', { id: job, wait: 60 })
    const lines = r.text.split('\n')
    // Three kinds of line (phase 4A.9): sure retakes; under "Uncertain", the
    // ones that may be meant; under "Speech with no words written", stretches
    // of which only the length is known.
    const at = lines.findIndex((l) => l.startsWith('Uncertain') || l.startsWith('Speech with no words'))
    const items = lines.map((l, i) => ({ l, i })).filter(({ l }) => /^\d+ /.test(l)).map(({ l, i }) => ({ n: +l.split(' ')[0], uncertain: at >= 0 && i > at, unwritten: / speech, no words/.test(l) }))
    const truth = JSON.parse(readFileSync(join(HAM, `${talk}.truth.json`), 'utf8'))
    const pairs = truth.segments.filter((s) => s.type === 'repeat').map((s) => ({ first: truth.segments[s.retakeOf], second: s }))
    // The take each item drops: "a-b = c…" the first take a-b; "s… = a-b no
    // words" the unwritten second take a-b.
    const ranges = lines.filter((l) => /^\d+ /.test(l)).map((l) => {
      const m = /^\d+ ([\d.]+)-([\d.]+) = /.exec(l) ?? /^\d+ ([\d.]+)-([\d.]+) speech, no words/.exec(l)
      return m ? { a: +m[1], b: +m[2] } : null
    })
    const over = (x, s) => Math.max(0, Math.min(x.b, s.end) - Math.max(x.a, s.start))
    const hitOf = (x, p) => x && (over(x, p.first) >= 0.5 * (p.first.end - p.first.start) || over(x, p.second) >= 0.5 * (p.second.end - p.second.start))
    const found = pairs.filter((p) => ranges.some((x) => hitOf(x, p))).length
    const sure = pairs.filter((p) => ranges.some((x, k) => !items[k].uncertain && hitOf(x, p))).length
    const written = pairs.filter((p) => ranges.some((x, k) => !items[k].unwritten && hitOf(x, p))).length
    const wrong = ranges.filter((x) => x && !pairs.some((p) => hitOf(x, p))).length
    const wrongSure = ranges.filter((x, k) => x && !items[k].uncertain && !pairs.some((p) => hitOf(x, p))).length
    results[talk] = { truth: pairs.length, found, sure, withUncertain: written, missed: pairs.length - found, wrong, wrongSure, items: items.length, uncertain: items.filter((x) => x.uncertain && !x.unwritten).length, unwritten: items.filter((x) => x.unwritten).length }
    console.log(`     repeats in the app on Whisper's lines (${talk}): a plain apply (sure) ${sure}/${pairs.length}; with the uncertain ones the agent may include ${written}/${pairs.length}; with the stretches of speech with no words ${found}/${pairs.length}; wrong ${wrong} (of the sure ones ${wrongSure}) — ${lines[0]}`)
  }
  mkdirSync(join(TESTDATA, 'e2e-sonuc'), { recursive: true })
  writeFileSync(join(TESTDATA, 'e2e-sonuc', 'tekrar-whisper.json'), JSON.stringify(results, null, 1))
  for (const [talk, r] of Object.entries(results)) {
    assert.ok(r.missed <= Math.floor(r.truth * 0.2), `${talk}: missed ${r.missed} of ${r.truth}`)
    assert.ok(r.wrong <= Math.floor(Math.max(1, r.found) * 0.2), `${talk}: wrong ${r.wrong}`)
    // What a plain apply cuts is never a wrong one.
    assert.equal(r.wrongSure, 0, `${talk}: ${r.wrongSure} sure findings are no retake`)
  }
}
