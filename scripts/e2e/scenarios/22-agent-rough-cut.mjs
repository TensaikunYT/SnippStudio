// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Scripted agent (a), phase 4A.7: a rough cut of the 10-minute talk
// (testdata\ham\ham-10dk-tr) through real HTTP, in the order an agent would
// call: project → analyze silences, repeats, fillers → edit (apply the three
// results) → transcript (the draft) → edit (chapter titles on words) → the
// user accepts → one Ctrl+Z undoes all of it. The answers' estimated tokens
// are printed; target ≤ 20 000. The silence finder's hits are measured
// against the truth here too (2B's inserted silences).
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connectAgent, itemsOf, resultOf, versionOf } from '../agent-client.mjs'
import { assertSilence, judgeRoughCut, keptSource, loadTalk, silenceHits } from '../talk.mjs'
import { TESTDATA } from '../media.mjs'
export const name = 'agent-script-a-rough-cut-10min'

/** The numbers an analyze answer lists under "Uncertain" (not the ones under
 *  "Speech with no words written": what is said there is not known). */
export const uncertainOf = (text) => {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => l.startsWith('Uncertain'))
  const end = lines.findIndex((l, i) => i > at && l.startsWith('Speech with no words'))
  return at < 0 ? [] : lines.slice(at + 1, end < 0 ? undefined : end).filter((l) => /^\d+ /.test(l)).map((l) => Number(l.split(' ')[0]))
}
/** The numbers listed under "Speech with no words written". */
export const unwrittenOf = (text) => {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => l.startsWith('Speech with no words'))
  return at < 0 ? [] : lines.slice(at + 1).filter((l) => /^\d+ .* speech, no words/.test(l)).map((l) => Number(l.split(' ')[0]))
}

/** The ranges of an analyze answer. */
export const rangesOf = (items) => items.map((l) => /^\d+ ([\d.]+)-([\d.]+)/.exec(l)).filter(Boolean).map((m) => [+m[1], +m[2]])

export async function run({ c, app, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const { truth } = await loadTalk({ c, app, lib, name: 'ham-10dk-tr' })
  await c.run(() => window.__agent.setMode('draft'))
  const ag = await connectAgent({ c, app, assert, client: 'script-a' })

  const p = await ag.call('project')
  const v0 = versionOf(p.text)
  const sil = await ag.call('analyze', { kind: 'silences' })
  const rep = await ag.call('analyze', { kind: 'repeats' })
  const fil = await ag.call('analyze', { kind: 'fillers' })
  const hits = silenceHits('ham-10dk-tr', truth, rangesOf(itemsOf(sil.text)))
  assert.equal(itemsOf(rep.text).length, 11, rep.text)
  // The repeats' first takes, against the truth (11 retakes).
  const depth0 = await lib.undoDepth(c)
  // Phase 4A.9: measured two ways. First a plain apply (the SURE retakes
  // only: two whole sentences of three words or more), judged on the draft
  // and rejected; then the agent that read the uncertain ones ("Tebrikler!"
  // said twice…) and includes them by number.
  const uncertain = uncertainOf(rep.text)
  const plain = await ag.call('edit', { ops: [{ op: 'apply', result: resultOf(sil.text) }, { op: 'apply', result: resultOf(rep.text) }, ...(itemsOf(fil.text).length ? [{ op: 'apply', result: resultOf(fil.text) }] : [])], base: v0 })
  assert.match(plain.text, /^Draft started: cut \d+ ranges/)
  const sureOnly = judgeRoughCut(truth, keptSource(await c.ev('window.__agent.draft().project')))
  console.log(`     plain apply (sure retakes only): ${sureOnly.missedRepeats}/${sureOnly.retakes} retakes left in, ${sureOnly.wronglyCut} words wrongly cut; ${uncertain.length} listed as uncertain`)
  assert.equal(sureOnly.missedRepeats, uncertain.length, 'a plain apply leaves exactly the uncertain ones in')
  assert.ok(sureOnly.wronglyCut <= 3, `${sureOnly.wronglyCut} words wrongly cut by a plain apply: ${sureOnly.wrong.join(' ')}`)
  await c.run(() => window.__agent.reject())
  const v1 = versionOf((await ag.call('project')).text)
  const e1 = await ag.call('edit', { ops: [{ op: 'apply', result: resultOf(sil.text) }, { op: 'apply', result: resultOf(rep.text), ...(uncertain.length ? { include: uncertain } : {}) }, ...(itemsOf(fil.text).length ? [{ op: 'apply', result: resultOf(fil.text) }] : [])], base: v1 })
  assert.match(e1.text, /^Draft started: cut \d+ ranges/)
  // The draft as the agent reads it: shorter, the lines where they now are.
  const tr = await ag.call('transcript')
  const lines = tr.text.split('\n').filter((l) => /^\S+ \[/.test(l))
  assert.ok(lines.length > 100, `${lines.length} lines`)
  // Five chapter titles, each on the first word of a line spread over the talk.
  const pick = [0, 25, 50, 75, 100].map((i) => lines[i].split(' ')[0])
  const e2 = await ag.call('edit', { ops: pick.map((id, i) => ({ op: 'text.add', time: `${id}#0`, text: `Part ${i + 1}` })), base: versionOf(tr.text) })
  assert.match(e2.text, /2 calls wait for the user/)
  // Nothing on the live project yet; the user accepts: ONE undo step.
  assert.equal(await lib.undoDepth(c), depth0)
  const liveLen0 = await c.st((s) => Object.values(s.project.clips).reduce((m, k) => Math.max(m, k.start + k.duration), 0))
  await c.run(() => window.__agent.accept())
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'accepted as one undo step')
  const liveLen1 = await c.st((s) => Object.values(s.project.clips).reduce((m, k) => Math.max(m, k.start + k.duration), 0))
  assert.ok(liveLen0 - liveLen1 > 100, `cut ${liveLen0 - liveLen1} s`)
  // Phase 4A.8 (T1): WHICH words are left, against the truth — not seconds.
  const judged = judgeRoughCut(truth, keptSource(await c.st((s) => s.project)))
  console.log(`     words left vs truth: ${judged.keptWords}/${judged.words - judged.leftOfDropped} kept, ${judged.wronglyCut} wrongly cut, ${judged.leftOfDropped} words of dropped takes left, ${judged.missedRepeats}/${judged.retakes} retakes missed${judged.wrong.length ? ` (${judged.wrong.join(' ')})` : ''}`)
  assert.equal(judged.missedRepeats, 0, 'every retake gone')
  assert.ok(judged.wronglyCut <= 3, `${judged.wronglyCut} words wrongly cut: ${judged.wrong.join(' ')}`)
  // The silence finder, strict (T7): cuts into word times are counted.
  assertSilence(assert, 'ham-10dk-tr', hits)
  const titles = await c.st((s) => s.project.captions.filter((k) => /^Part \d$/.test(k.text)).map((k) => +k.start.toFixed(2)))
  assert.equal(titles.length, 5)
  // One Ctrl+Z: all of it back.
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('z', ['ctrl'])
  await c.waitFor('Ctrl+Z took the whole rough cut back', async () => (await lib.clipList(c)).length <= 2)
  assert.equal(await c.st((s) => s.project.captions.filter((k) => /^Part \d$/.test(k.text)).length), 0)
  const liveLen2 = await c.st((s) => Object.values(s.project.clips).reduce((m, k) => Math.max(m, k.start + k.duration), 0))
  assert.ok(Math.abs(liveLen2 - liveLen0) < 0.01)

  const total = ag.total()
  console.log('     ' + ag.summary('script (a)').replace(/\n/g, '\n     '))
  console.log(`     silences vs truth (10 min): ${JSON.stringify(hits)}`)
  const out = join(TESTDATA, 'e2e-sonuc')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'ajan-a.json'), JSON.stringify({ total, defsChars: ag.defsChars, calls: ag.log, silences10: hits, cutSeconds: liveLen0 - liveLen1, wordsLeft: judged, wordsLeftSureOnly: sureOnly, uncertainRetakes: uncertain.length }, null, 1))
  assert.ok(total <= 20000, `answers ≈ ${total} tokens (target ≤ 20 000)`)
}
