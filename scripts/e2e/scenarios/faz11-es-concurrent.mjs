// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11a, step 3: editing at the same time as the agent, in the real
// window. The agent is the scripted one over real HTTP (agent-client.mjs);
// the user is driven through the window (keys, clicks, slider drags, the
// cutter's marks, Ctrl+Z, the draft card's Accept). Every result is measured
// against a truth computed another way (no silent wrong):
//   (i)   a 25-op assembly waits as a draft; the user makes 10 unrelated
//         edits (markers, a title, volume, colour…); Accept → 25 / 25. Truth:
//         the same 25 ops applied directly (no draft) on the project as the
//         user left it — the two projects must be the same, ids aside.
//   (ii)  the agent's 10 ops wait; the user cuts 5–7 s with the cutter: the
//         ops anchored in 5–7 s drop and the card says why, the others live,
//         at the places the truth says (shifted by the cut, or with their words).
//   (iii) Ctrl+Z on that cut: the dropped ops come back by themselves; Accept
//         = the 10 ops applied directly on the untouched project.
//   (iv)  direct mode: user and agent alternate 20 edits → 20 / 20; Ctrl+Z ×20
//         is the start exactly, Ctrl+Shift+Z ×20 the end exactly.
//   (v)   two agents at once: the second one's edit while the first one's
//         draft waits; the accepted project is one agent's work, never a mix.
import { captionsOf, WORDED } from './04-text-edit.mjs'
import { connectAgent, versionOf } from '../agent-client.mjs'
import { DIGEST, installProbe, keepModelCount, record, tally } from '../kesif.mjs'
export const name = 'faz11-es-concurrent'
export const timeoutMs = 20 * 60_000

/** The project's meaning without its ids (what "the same project" is here). */
const SEM = `(() => {
  const p = window.__store.getState().project
  const r = (v) => Math.round(v * 1000) / 1000
  const asset = (id) => p.assets.find((a) => a.id === id)?.name ?? id
  const tIndex = Object.fromEntries(p.tracks.map((t, i) => [t.id, t.kind + i]))
  const clips = Object.values(p.clips).map((k) => [asset(k.assetId), tIndex[k.trackId], r(k.start), r(k.duration), r(k.inPoint), k.transitionOut ? k.transitionOut.type + r(k.transitionOut.duration) : '', r(k.volume ?? 1), r(k.opacity ?? 1), JSON.stringify(k.grade ?? null), r(k.sharpen ?? 0), r(k.blur ?? 0)].join('|')).sort()
  const caps = p.captions.map((k) => [k.kind ?? '', k.text, r(k.start), r(k.end), JSON.stringify(k.style ?? null)].join('|')).sort()
  const marks = (p.markers ?? []).map((m) => r(m.time) + (m.note ? ':' + m.note : '')).sort()
  return JSON.stringify({ tracks: p.tracks.map((t) => t.kind), clips, caps, marks, style: p.captionStyle ?? null, tmpl: (p.templates ?? []).length })
})()`

const semDiff = (a, b) => {
  const A = JSON.parse(a), B = JSON.parse(b), out = []
  for (const k of Object.keys(A)) {
    const x = JSON.stringify(A[k]), y = JSON.stringify(B[k])
    if (x === y) continue
    if (Array.isArray(A[k]) && Array.isArray(B[k])) {
      const only = (u, v) => u.filter((e) => !v.includes(e))
      out.push(`${k}: only in first ${JSON.stringify(only(A[k], B[k])).slice(0, 300)}; only in second ${JSON.stringify(only(B[k], A[k])).slice(0, 300)}`)
    } else out.push(`${k}: ${x.slice(0, 120)} ≠ ${y.slice(0, 120)}`)
  }
  return out
}

async function base(ctx, { pictures = false } = {}) {
  const { c, app, media, lib } = ctx
  const files = [media.talk, media.other, ...(pictures ? [...media.numbered, ...media.broll] : [])]
  const assets = await lib.seedAssets(app, c, files)
  await lib.seedTimeline(c, [assets[0].id, assets[1].id])
  await c.run((caps) => { const s = window.__store.getState(); s.setSubtitles(caps); s.setDirty(false); return true }, captionsOf(WORDED))
  // Every Inspector section open (as 95-inspector-sliders has it).
  await c.run(() => { const st = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}'); for (const id of ['Clip', 'Audio', 'Effects', 'Color', 'Crop', 'Keyframes', 'Style', 'Project']) st[id] = true; localStorage.setItem('snipp-sections', JSON.stringify(st)); return true })
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  return assets
}

const cardDrops = (c) => c.run(() => [...document.querySelectorAll('.agent-op.is-dropped')].map((e) => e.textContent.trim().slice(0, 200)))

async function acceptWithCard(c) {
  await c.click('inspector.tab.agent')
  await c.waitId('agent.draft', 15000)
  await c.waitFor('accept enabled', () => c.run(() => !document.querySelector('[data-testid="agent.draft.acceptAll"]')?.disabled), 30000)
  await c.click('agent.draft.acceptAll')
  await c.waitGone('agent.draft', 60000)
}

/** A slider in the Inspector dragged once with the pointer (one undo step). */
async function dragSlider(c, lib, clipId, id, from = 0.3, to = 0.7) {
  // The cards beyond a clip's main one are folded by default: opened as a user would.
  await lib.openCards(c, ['Audio', 'Color', 'Opacity', 'Effects'])
  await c.run((x) => { window.__store.setState({ selectedClipIds: [x] }); return true }, clipId)
  await c.click('inspector.tab.subs')
  await c.click('inspector.tab.clip')
  await c.waitId(id)
  await c.run((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), `[data-testid="${id}"]`)
  const b = await c.box(id)
  await c.dragAt(b.x + from * b.w, b.cy, b.x + to * b.w, b.cy, { steps: 8 })
  await c.sleep(150)
}

/** A marker at a time, with the M key. */
async function markerKey(c, lib, t) {
  await c.run((x) => { window.__store.getState().setTime(x); return true }, t)
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.run((x) => { window.__store.getState().setTime(x); return true }, t)
  await c.key('m')
  await c.sleep(100)
}

// ---------------------------------------------------------------------------
async function partI(ctx, which = 'all') {
  const { c, app, lib } = ctx
  const assets = await base(ctx, { pictures: true })
  const pics = assets.slice(2).map((a) => a.id)
  const talkClip = (await lib.clipList(c)).find((k) => k.assetId === assets[0].id).id
  await c.run(() => { window.__agent.setMode('draft'); return true })
  const ag = await connectAgent({ c, app, assert: lib.assert, client: 'es-i' })
  const read = await ag.call('project')
  const v0 = versionOf(read.text)
  const v1 = await c.st((s) => s.project.tracks.find((t) => t.kind === 'video').id)
  const ops = () => [
    ...Array.from({ length: 12 }, (_, i) => ({ op: 'clip.append', assetId: pics[i % pics.length], trackId: v1, id: `cl${i}` })),
    { op: 'track.add', kind: 'video', id: 'brolltrack' },
    ...Array.from({ length: 5 }, (_, i) => ({ op: 'clip.add', assetId: pics[(i + 3) % pics.length], trackId: 'brolltrack', start: 20 + i * 6 })),
    ...[0, 1, 2, 3].map((i) => ({ op: 'clip.setTransition', clipId: `cl${i}`, transition: { type: 'mix', duration: 0.5 } })),
    ...[19, 30, 45].map((t, i) => ({ op: 'text.add', time: t, text: `Title ${i + 1}` }))
  ]
  const r = await ag.call('edit', { ops: ops(), base: v0 })
  const appliedInDraft = (/applied (\d+)/i.exec(r.text)?.[1]) ?? null
  // The user, meanwhile: 10 unrelated edits through the window.
  const user = []
  if (which !== 'sliders' && which !== 'none') {
    for (const t of [1, 3.5, 9]) { await markerKey(c, lib, t); user.push('marker ' + t) }
    await c.run(() => { window.__store.getState().setTime(8.5); return true })
    await lib.addText(c); user.push('title at 8.5')
  }
  if (which !== 'marks' && which !== 'none') {
    await dragSlider(c, lib, talkClip, 'inspector.audio.volume', 0.5, 0.8); user.push('volume')
    await dragSlider(c, lib, talkClip, 'inspector.color.brightness', 0.3, 0.6); user.push('brightness')
    await dragSlider(c, lib, talkClip, 'inspector.clip.opacity', 0.9, 0.6); user.push('opacity')
    await dragSlider(c, lib, talkClip, 'inspector.effects.sharpen', 0.05, 0.5); user.push('sharpen')
    await dragSlider(c, lib, talkClip, 'inspector.color.blur', 0.05, 0.4); user.push('blur')
  }
  if (which !== 'sliders' && which !== 'none') { await markerKey(c, lib, 11); user.push('marker 11') }
  const userDepth = await lib.undoDepth(c)
  const userSem = await c.ev(SEM)
  await ag.call('project')
  const draftOut = await c.run(() => { const d = window.__agent.store.getState().draft; return { dropped: d?.dropped?.length ?? null, applied: 25 - (d?.dropped?.length ?? 0), reasons: (d?.dropped ?? []).map((x) => JSON.stringify(x).slice(0, 240)) } })
  await c.click('inspector.tab.agent')
  await c.waitId('agent.draft', 15000)
  const drops = await cardDrops(c)
  await acceptWithCard(c)
  const accepted = await c.ev(SEM)
  const stepsAdded = (await lib.undoDepth(c)) - userDepth
  // Truth: the 25 ops applied directly on the project the user left.
  await c.key('z', ['ctrl'])
  await c.waitFor('the accept undone', async () => (await c.ev(SEM)) === userSem, 10000)
  await c.run(() => { window.__agent.setMode('direct'); return true })
  const v2 = versionOf((await ag.call('project')).text)
  const direct = await ag.call('edit', { ops: ops(), base: v2 })
  const truth = await c.ev(SEM)
  const same = accepted === truth
  // The user's 10 edits are in the accepted project as the user left them.
  const U = JSON.parse(userSem), A = JSON.parse(accepted)
  const noTrack = (k) => k.replace(/\|video\d\|/, '|v|')
  U.clips = U.clips.map(noTrack); A.clips = A.clips.map(noTrack)
  const lost = [...U.marks.filter((m) => !A.marks.includes(m)), ...U.caps.filter((k) => !A.caps.includes(k)), ...U.clips.filter((k) => k.startsWith('talk.mp4') && !A.clips.includes(k))]
  const userKept = lost.length === 0
  return { which, lost, acceptedTalk: A.clips.filter((k) => k.startsWith('talk')), truthTalk: JSON.parse(truth).clips.filter((k) => k.startsWith('talk')), appliedInDraft, draftOut, drops, user: user.length, stepsAdded, same, userKept, diff: same ? [] : semDiff(accepted, truth), directText: direct.text.split('\n')[0] }
}

// ---------------------------------------------------------------------------
const OPS10 = (otherClip) => [
  { op: 'text.add', time: 'w1#1', text: 'Cat' },        // 0.5  survives
  { op: 'marker.add', time: 1, note: 'a' },             // 1    survives
  { op: 'text.add', time: 'w2#2', text: 'Walk' },       // 5.2  inside the user's cut → drops
  { op: 'caption.editLine', id: 'w2', text: 'then it went over the bridge' }, // w2 cut into → drops
  { op: 'marker.add', time: 6, note: 'b' },             // 6    inside the cut → drops (or lands at 5)
  { op: 'text.add', time: 'w3#2', text: 'Back' },       // 10.4 survives, 2 s earlier
  { op: 'marker.add', time: 10, note: 'c' },            // 10   survives at 8
  { op: 'clip.setVolume', clipId: otherClip, volume: 0.5 }, // survives
  { op: 'timeline.cutRanges', ranges: [[3.1, 4.4]] },    // before the user's cut → survives
  { op: 'text.add', time: 'w3#3', text: 'Home' }        // 10.9 survives
]

async function partII_III(ctx) {
  const { c, app, lib } = ctx
  const assets = await base(ctx)
  const otherClip = (await lib.clipList(c)).find((k) => k.assetId === assets[1].id).id
  const start = await c.ev(SEM)
  await c.run(() => { window.__agent.setMode('draft'); return true })
  const ag = await connectAgent({ c, app, assert: lib.assert, client: 'es-ii' })
  const v0 = versionOf((await ag.call('project')).text)
  await ag.call('edit', { ops: OPS10(otherClip), base: v0 })
  await ag.call('project')
  // The user cuts 5–7 s with the cutter's two marks.
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('c')
  await c.waitFor('the cutter on', () => c.st((s) => s.cutterMode))
  const talkClip = (await lib.clipList(c)).find((k) => k.assetId === assets[0].id)
  const box = await c.box(`timeline.clip.${talkClip.id}`)
  await c.clickAt(await lib.timeX(c, 5), box.cy, { mods: ['shift'] })
  await c.clickAt(await lib.timeX(c, 7), box.cy, { mods: ['shift'] })
  const marks = await c.waitFor('two marks', async () => { const m = await c.st((s) => s.cutMarks); return m.length === 2 ? m : null })
  await c.click('timeline.tool.cut-delete')
  await c.waitFor('the cut', async () => (await c.st((s) => s.cutMarks)).length === 0)
  await c.key('Escape')
  const cut = [Math.min(...marks), Math.max(...marks)]
  const told = (await ag.call('project')).text
  await c.click('inspector.tab.agent')
  await c.waitId('agent.draft', 15000)
  const d = await c.run(() => { const d = window.__agent.store.getState().draft; return { outcomes: (d.outcomes ?? []).map((o) => ({ name: o.name, applied: o.applied, reason: o.reason ?? null })), dropped: d.dropped } })
  const drops = await cardDrops(c)
  // The truth for (ii): what lives must be where the cut puts it.
  const draftSem = JSON.parse(await c.ev(`(() => { const p = window.__agent.draft().project; const r = (v) => Math.round(v * 1000) / 1000; return JSON.stringify({ caps: p.captions.map((k) => k.text + '@' + r(k.start)).sort(), marks: (p.markers ?? []).map((m) => (m.note ?? '') + '@' + r(m.time)).sort(), other: r(Object.values(p.clips).find((k) => p.assets.find((a) => a.id === k.assetId)?.name === 'other.mp4')?.volume ?? 1) }) })()`))
  const len = cut[1] - cut[0]
  const sil = 4.4 - 3.1
  const at = (t) => Math.round((t - (t > cut[1] ? len : 0) - (t > 4.4 ? sil : 0)) * 1000) / 1000
  const want = { caps: ['Cat@' + at(0.5), 'Back@' + at(10.4), 'Home@' + at(10.9)], marks: ['a@' + at(1), 'c@' + at(10)], other: 0.5 }
  const missing = [...want.caps.filter((x) => !draftSem.caps.includes(x)), ...want.marks.filter((x) => !draftSem.marks.includes(x))]
  const wrongPlace = draftSem.caps.filter((x) => /^(Walk)@/.test(x)).concat(draftSem.marks.filter((x) => /^b@/.test(x) && !draftSem.marks.includes('b@' + at(cut[0]))))
  const ii = { cut, told: /Draft: dropped/.test(told), outcomes: d.outcomes, drops, liveOk: missing.length === 0 && draftSem.other === 0.5, missing, wrongPlace, draft: draftSem }

  // (iii) Ctrl+Z on the cut: the dropped ops come back by themselves.
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('z', ['ctrl'])
  await c.waitFor('the cut undone', async () => (await c.ev(SEM)) === start, 10000)
  const back = (await ag.call('project')).text
  const d2 = await c.run(() => { const d = window.__agent.store.getState().draft; return { applied: 10 - d.dropped.length, dropped: d.dropped.length } })
  await acceptWithCard(c)
  const accepted = await c.ev(SEM)
  await c.key('z', ['ctrl'])
  await c.waitFor('the accept undone', async () => (await c.ev(SEM)) === start, 10000)
  await c.run(() => { window.__agent.setMode('direct'); return true })
  const v3 = versionOf((await ag.call('project')).text)
  await ag.call('edit', { ops: OPS10(otherClip), base: v3 })
  const truth = await c.ev(SEM)
  const iii = { backTold: /back in the draft/i.test(back), applied: d2.applied, dropped: d2.dropped, same: accepted === truth, diff: accepted === truth ? [] : semDiff(accepted, truth) }
  return { ii, iii }
}

// ---------------------------------------------------------------------------
async function partIV(ctx) {
  const { c, app, lib } = ctx
  const assets = await base(ctx)
  const talkClip = (await lib.clipList(c)).find((k) => k.assetId === assets[0].id).id
  await c.run(() => { window.__agent.setMode('direct'); return true })
  const ag = await connectAgent({ c, app, assert: lib.assert, client: 'es-iv' })
  const d0 = await c.ev(DIGEST)
  const depth0 = await lib.undoDepth(c)
  const userSteps = [
    () => markerKey(c, lib, 0.7), () => dragSlider(c, lib, talkClip, 'inspector.audio.volume', 0.5, 0.75),
    async () => { await c.run(() => { window.__store.getState().setTime(2.2); return true }); await lib.addText(c) },
    () => markerKey(c, lib, 4.1), () => dragSlider(c, lib, talkClip, 'inspector.color.brightness', 0.3, 0.55),
    () => markerKey(c, lib, 7.3), () => dragSlider(c, lib, talkClip, 'inspector.clip.opacity', 0.9, 0.7),
    async () => { await c.run(() => { window.__store.getState().setTime(9.1); return true }); await lib.addText(c) },
    () => dragSlider(c, lib, talkClip, 'inspector.effects.sharpen', 0.05, 0.45), () => markerKey(c, lib, 11.4)
  ]
  const agentOps = (i) => [
    { op: 'marker.add', time: 0.3 + i, note: `ag${i}` }, { op: 'text.add', time: 1.1 + i, text: `Agent ${i}` }
  ][i % 2]
  let userLanded = 0, agentLanded = 0
  const digests = [d0]
  for (let i = 0; i < 10; i++) {
    const before = await lib.undoDepth(c)
    await userSteps[i]()
    if ((await lib.undoDepth(c)) === before + 1) userLanded++
    digests.push(await c.ev(DIGEST))
    const v = versionOf((await ag.call('project')).text)
    const r = await ag.call('edit', { ops: [agentOps(i)], base: v }, { allowError: true })
    if (!r.isError) agentLanded++
    digests.push(await c.ev(DIGEST))
  }
  const depth = (await lib.undoDepth(c)) - depth0
  const dEnd = await c.ev(DIGEST)
  // Undo all 20, each compared; then redo all 20.
  let undoBad = 0
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  for (let i = digests.length - 2; i >= 0; i--) {
    await c.key('z', ['ctrl'])
    await c.sleep(60)
    if ((await c.ev(DIGEST)).hash !== digests[i].hash) undoBad++
  }
  const atStart = (await c.ev(DIGEST)).hash === d0.hash
  let redoBad = 0
  for (let i = 1; i < digests.length; i++) {
    await c.key('z', ['ctrl', 'shift'])
    await c.sleep(60)
    if ((await c.ev(DIGEST)).hash !== digests[i].hash) redoBad++
  }
  const atEnd = (await c.ev(DIGEST)).hash === dEnd.hash
  const markers = await c.st((s) => (s.project.markers ?? []).length)
  return { userLanded, agentLanded, total: userLanded + agentLanded, undoSteps: depth, undoBad, redoBad, atStart, atEnd, markers }
}

// ---------------------------------------------------------------------------
async function partV(ctx) {
  const { c, app, lib } = ctx
  await base(ctx)
  const start = await c.ev(SEM)
  await c.run(() => { window.__agent.setMode('draft'); return true })
  const A = await connectAgent({ c, app, assert: lib.assert, client: 'es-v-A' })
  const B = await connectAgent({ c, app, assert: lib.assert, client: 'es-v-B' })
  const opsA = [{ op: 'marker.add', time: 2, note: 'A1' }, { op: 'text.add', time: 3, text: 'From A' }, { op: 'timeline.cutRanges', ranges: [[8.1, 9.4]] }]
  const opsB = [{ op: 'marker.add', time: 5, note: 'B1' }, { op: 'text.add', time: 6, text: 'From B' }, { op: 'timeline.cutRanges', ranges: [[3.1, 4.4]] }]
  const vA = versionOf((await A.call('project')).text)
  const vB = versionOf((await B.call('project')).text)
  const rA = await A.call('edit', { ops: opsA, base: vA }, { allowError: true })
  const rB = await B.call('edit', { ops: opsB, base: vB }, { allowError: true })
  await A.call('project')
  const owner = await c.run(() => { const d = window.__agent.store.getState().draft; return d ? { calls: d.calls?.length ?? null, session: d.session ?? d.owner ?? null } : null })
  await acceptWithCard(c)
  const accepted = await c.ev(SEM)
  // Truths: A alone, B alone (direct, on the start).
  let acceptUndos = 0
  while (accepted !== start && (await c.ev(SEM)) !== start && acceptUndos < 6) { await c.run(() => { window.__store.getState().undo(); return true }); acceptUndos++; await c.sleep(100) }
  await c.run(() => { window.__agent.setMode('direct'); return true })
  const undoSteps = []
  const truthOf = async (ag, ops) => {
    const v = versionOf((await ag.call('project')).text)
    await ag.call('edit', { ops, base: v }, { allowError: true })
    const t = await c.ev(SEM)
    let undos = 0
    while ((await c.ev(SEM)) !== start && undos < 6) { await c.run(() => { window.__store.getState().undo(); return true }); undos++; await c.sleep(100) }
    undoSteps.push(undos)
    return t
  }
  const onlyA = await truthOf(A, opsA)
  const onlyB = await truthOf(B, opsB)
  const verdict = accepted === onlyA ? 'A only' : accepted === onlyB ? 'B only' : accepted === start ? 'nothing' : 'MIXED'
  return { rA: rA.text.split('\n')[0].slice(0, 160), rAerror: rA.isError, rB: rB.text.split('\n')[0].slice(0, 200), rBerror: rB.isError, owner, verdict, acceptUndos, directUndoSteps: undoSteps, diffA: verdict === 'MIXED' ? semDiff(accepted, onlyA) : [] }
}

export async function run(ctx) {
  const { c, lib } = ctx
  await installProbe(c)
  const res = {}
  for (const [k, f] of [['i_none', (x) => partI(x, 'none')], ['i', partI], ['i_marks', (x) => partI(x, 'marks')], ['i_sliders', (x) => partI(x, 'sliders')], ['ii_iii', partII_III], ['iv', partIV], ['v', partV]]) {
    try {
      res[k] = await f(ctx)
    } catch (e) {
      res[k] = { failed: String(e?.stack ?? e).slice(0, 600) }
    }
    console.log(`     (${k}) ${JSON.stringify(res[k]).slice(0, 900)}`)
    await keepModelCount(c)
    await lib.reset(c)
  }
  const counts = await tally(c)
  record(name, { counts, res })
  console.log(`     counts: ${JSON.stringify({ ...counts, texts: undefined })}`)
  const bad = Object.entries(res).filter(([, v]) => v.failed)
  lib.assert.equal(bad.length, 0, bad.map(([k, v]) => `${k}: ${v.failed}`).join('\n'))
}
