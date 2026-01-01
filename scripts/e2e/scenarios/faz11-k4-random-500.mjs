// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11a, K4: 500 random edits in a real window, undo and redo mixed in.
//
// Each step is one of:
//   - a command of the command layer (every one in COMMANDS, its parameters
//     made at random from its own schema, ids picked from the project), run
//     the way the store's wrappers run it (runBatch: one undo step);
//   - a store action the interface calls that is not a command (keyframes,
//     grade, speed curve, reverse, freeze, compound, duplicate, ripple…);
//   - a real gesture over CDP on the timeline (drag a clip, drag its right
//     edge, S at the playhead, Delete);
//   - Ctrl+Z / Ctrl+Shift+Z (the store's undo / redo).
// After every step: the model check (window.__modelProblems, e2e builds run
// checkProject after every edit), and every undo / redo is compared with
// the project the test expects there (its own stack of digests).
// At the end: every step the history keeps undone one by one (MAX_UNDO 60:
// the history keeps the last 61 states), then redone. Then a second run
// of 55 steps from a fresh project, all undone: back to the start exactly.
import { installProbe, keepModelCount, record, tally } from '../kesif.mjs'
export const optIn = true
export const name = 'faz11-k4-random-500'
export const timeoutMs = 30 * 60_000

const STEPS = Number(process.env.SNIPP_K4_STEPS ?? 500)
const SEED = Number(process.env.SNIPP_K4_SEED ?? 1111)

// Runs in the page: the random edit machine.
export const MACHINE = String.raw`(async (seed) => {
  const S = window.__store
  const { COMMANDS } = await window.__commands()
  let x = seed >>> 0
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
  const pick = (a) => a.length ? a[Math.floor(rnd() * a.length)] : undefined
  const drop = new Set(['savedAt', 'modifiedAt', 'openedAt', 'thumb', 'waveform', 'filmstrip', 'peaks', 'probe', 'runtime'])
  const norm = (v) => Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter((k) => !drop.has(k) && v[k] !== undefined).sort().map((k) => [k, norm(v[k])])) : typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v
  const digest = () => JSON.stringify(norm(S.getState().project))
  const firstDiff = (a, b) => {
    const A = JSON.parse(a), B = JSON.parse(b), out = []
    const walk = (p, u, v) => {
      if (out.length > 4) return
      if (JSON.stringify(u) === JSON.stringify(v)) return
      if (u && v && typeof u === 'object' && typeof v === 'object') { for (const k of new Set([...Object.keys(u), ...Object.keys(v)])) walk(p + '.' + k, u[k], v[k]); return }
      out.push(p + ': ' + JSON.stringify(u)?.slice(0, 80) + ' → ' + JSON.stringify(v)?.slice(0, 80))
    }
    walk('project', A, B)
    return out
  }
  const len = () => Math.max(1, ...Object.values(S.getState().project.clips).map((k) => k.start + k.duration))
  const ids = () => {
    const p = S.getState().project
    return {
      clip: Object.keys(p.clips), track: p.tracks.map((t) => t.id), asset: p.assets.map((a) => a.id),
      caption: p.captions.map((c) => c.id), marker: (p.markers ?? []).map((m) => m.id), note: (p.notes ?? []).map((n) => n.id),
      template: (p.templates ?? []).map((t) => t.id), shape: (p.shapes ?? []).map((s) => s.id)
    }
  }
  const idFor = (key, I) => {
    const k = key.toLowerCase()
    if (/clip/.test(k)) return pick(I.clip)
    if (/track/.test(k)) return pick(I.track)
    if (/asset|media/.test(k)) return pick(I.asset)
    if (/caption|line|title|text/.test(k)) return pick(I.caption)
    if (/marker/.test(k)) return pick(I.marker)
    if (/note/.test(k)) return pick(I.note)
    if (/template|tmpl/.test(k)) return pick(I.template)
    if (/shape/.test(k)) return pick(I.shape)
    return pick([...I.clip, ...I.caption])
  }
  const gen = (s, key, I, depth = 0) => {
    if (!s || depth > 5) return undefined
    if (s.anyOf) return gen(pick(s.anyOf), key, I, depth + 1)
    if (s.enum) return pick([...s.enum])
    const k = (key || '').toLowerCase()
    switch (s.type) {
      case 'object': {
        const o = {}
        for (const [pk, ps] of Object.entries(s.properties ?? {})) if ((s.required ?? []).includes(pk) || rnd() < 0.45) { const v = gen(ps, pk, I, depth + 1); if (v !== undefined) o[pk] = v }
        return o
      }
      case 'array': {
        const n = Math.max(s.minItems ?? 0, Math.min(s.maxItems ?? 3, 1 + Math.floor(rnd() * 3)))
        return Array.from({ length: n }, () => gen(s.items, key.replace(/s$/, ''), I, depth + 1)).filter((v) => v !== undefined)
      }
      case 'string':
        if (/id$|ids$/.test(k) || /^(clip|track|asset|caption|marker|note|template|shape)/.test(k)) return idFor(k, I)
        if (/color|colour/.test(k)) return pick(['#ff0000', '#00ff88', '#3366ff'])
        return pick(['k4', 'Hello', 'A title', 'x'])
      case 'number': case 'integer': {
        let v
        if (/time|start|end|at$|from|to$/.test(k)) v = rnd() * len()
        else if (/dur|length|hold|fade/.test(k)) v = 0.05 + rnd() * 4
        else if (/speed/.test(k)) v = pick([0.25, 0.5, 2, 4, 1.5, 10])
        else if (/volume|opacity|amount|gain/.test(k)) v = rnd() * 1.5
        else if (s.minimum !== undefined || s.maximum !== undefined) { const lo = s.minimum ?? 0, hi = s.maximum ?? lo + 10; v = lo + rnd() * (hi - lo) }
        else v = rnd() * 3
        if (s.minimum !== undefined) v = Math.max(s.minimum, v)
        if (s.maximum !== undefined) v = Math.min(s.maximum, v)
        return s.type === 'integer' ? Math.round(v) : Math.round(v * 1000) / 1000
      }
      case 'boolean': return rnd() < 0.5
      case 'null': return null
      default: return undefined
    }
  }
  const NAMES = Object.keys(COMMANDS).filter((n) => !/^(automation\.placeImages|broll\.place|code\.)/.test(n))
  const CH = ['scale', 'x', 'y', 'opacity', 'rotation']
  const ACTIONS = {
    splitClipAt: (I) => { const id = pick(I.clip); const k = S.getState().project.clips[id]; return id && [id, k.start + rnd() * k.duration] },
    skipAhead: (I) => { const id = pick(I.clip); const k = S.getState().project.clips[id]; return id && [id, k.start + rnd() * k.duration, 0.2 + rnd()] },
    toggleReverse: (I) => [pick(I.clip)],
    addPropKeyframe: (I) => [pick(I.clip), pick(CH)],
    setPropValue: (I) => [pick(I.clip), pick(CH), rnd(), true],
    clearClipKeyframes: (I) => [pick(I.clip)],
    setClipGrade: (I) => [pick(I.clip), { brightness: rnd() - 0.5 }],
    setClipBlur: (I) => [pick(I.clip), rnd() * 10],
    setClipTone: (I) => [pick(I.clip), { exposure: rnd() - 0.5 }],
    setClipFlip: (I) => [pick(I.clip), { h: rnd() < 0.5 }],
    setClipCrop: (I) => [pick(I.clip), { left: rnd() * 0.3 }],
    setClipSpeed: (I) => [pick(I.clip), pick([0.5, 2, 3, 0.25, 1])],
    setClipSpeedCurve: (I) => [pick(I.clip), rnd() < 0.3 ? null : { points: [{ u: 0, v: 1 }, { u: 0.5, v: 0.4 + rnd() * 3 }, { u: 1, v: 1 }] }],
    // (duplicateClipsInPlace is the inside of an Alt+drag: the copies lie on
    // their originals until the drag moves them. Done as the real gesture.)
    deleteClips: (I) => [[pick(I.clip)], rnd() < 0.5],
    rippleDeleteMany: () => { const a = rnd() * len(); return [[[a, a + 0.1 + rnd() * 2]]] },
    unlinkClips: (I) => [[pick(I.clip)]],
    insertFreezeFrame: (I) => { const id = pick(I.clip); const k = S.getState().project.clips[id]; if (!k) return null; S.getState().selectClips([id]); S.getState().setTime(k.start + rnd() * k.duration); return [0.5 + rnd()] },
    compoundSelection: (I) => { S.getState().selectClips([pick(I.clip), pick(I.clip)].filter(Boolean)); return [] },
    uncompoundClip: (I) => [pick(I.clip)],
    closeGapAtPlayhead: () => { S.getState().setTime(rnd() * len()); return [rnd() < 0.5] },
    rippleTrimToPlayhead: () => { S.getState().setTime(rnd() * len()); return [pick(['left', 'right'])] },
    keyframeClips: (I) => [[pick(I.clip)]],
    slipClip: (I) => { const id = pick(I.clip); const k = S.getState().project.clips[id]; return id && [id, rnd() - 0.5, k.inPoint] },
    setClipAnim: (I) => [pick(I.clip), { in: pick(['fade', 'none', 'slide-up']) }],
    addAdjustmentLayer: () => { S.getState().setTime(rnd() * len()); return [] },
    copyThenPasteAttributes: (I) => { S.getState().selectClips([pick(I.clip)]); S.getState().copySelection(); S.getState().selectClips([pick(I.clip)]); return 'paste' }
  }
  const stats = { multiAt: [], late: [], command: {}, action: {}, refused: 0, threw: 0, undo: 0, redo: 0, undoBad: [], redoBad: [], multi: 0, problemsAt: [] }
  const past = [], future = []
  const CAP = 61
  const pushPast = (d) => { past.push(d); if (past.length > CAP) past.shift() }
  let last = digest()
  let seenPast = S.getState().past
  // A history step made outside a step (late, after the step settled):
  // counted and taken in, so the stack stays in line with the store's.
  const catchUp = (label) => {
    const st = S.getState()
    if (st.past === seenPast) return
    const grew = st.past.length - seenPast.length
    stats.late.push(label + ' +' + grew)
    for (let i = 0; i < Math.max(1, grew); i++) pushPast(null)
    future.length = 0
    last = digest()
    seenPast = st.past
  }
  const settle = (kind, label, before) => {
    const st = S.getState()
    const now = digest()
    if (st.past !== before.past && kind !== 'undo' && kind !== 'redo') {
      // (At the cap the length stays: count the new entries by identity.)
      const fresh = st.past.filter((x) => !before.past.includes(x)).length
      const grew = Math.max(1, fresh)
      if (grew > 1) { stats.multi++; stats.multiAt.push(label + ' ×' + grew); for (let i = 1; i < grew; i++) pushPast(null) }
      pushPast(last)
      future.length = 0
    }
    last = now
    seenPast = st.past
    const n = (window.__modelProblems || []).length
    if (n > stats.problems) { stats.problemsAt.push(label); stats.problems = n }
  }
  stats.problems = (window.__modelProblems || []).length
  window.__k4 = {
    stats,
    digest,
    before: () => ({ past: S.getState().past }),
    settle,
    step() {
      catchUp(stats.lastLabel ?? 'start')
      const before = { past: S.getState().past }
      const r = rnd()
      const I = ids()
      if (r < 0.1) {
        if (!past.length || !S.getState().past.length) return 'undo-none'
        const want = past.pop()
        S.getState().undo()
        stats.undo++
        const now = digest()
        if (want !== null && now !== want) stats.undoBad.push({ at: stats.undo, diff: firstDiff(want, now) })
        future.push(last)
        last = now
        settle('undo', 'undo', before)
        return 'undo'
      }
      if (r < 0.17) {
        if (!future.length || !S.getState().future.length) return 'redo-none'
        const want = future.pop()
        S.getState().redo()
        stats.redo++
        const now = digest()
        if (now !== want) stats.redoBad.push({ at: stats.redo, diff: firstDiff(want, now) })
        pushPast(last)
        last = now
        settle('redo', 'redo', before)
        return 'redo'
      }
      if (r < 0.4) {
        const name = pick(Object.keys(ACTIONS))
        const args = ACTIONS[name](I)
        if (!args || (Array.isArray(args) && args.some((a) => a === undefined))) return 'skip'
        stats.action[name] = (stats.action[name] || 0) + 1
        try {
          if (args === 'paste') S.getState().pasteAttributes()
          else S.getState()[name](...args)
        } catch (e) { stats.threw++; stats.lastThrow = name + ': ' + String(e?.message ?? e).slice(0, 200) }
        settle('action', name, before)
        stats.lastLabel = name
        return name
      }
      const name = pick(NAMES)
      const params = gen(COMMANDS[name].params.json, '', I)
      stats.command[name] = (stats.command[name] || 0) + 1
      try {
        S.getState().runBatch([{ name, params }], { seed: Math.floor(rnd() * 1e9) })
      } catch (e) { stats.refused++ }
      settle('command', name, before)
      stats.lastLabel = name
      return name
    },
    /** After a gesture made over CDP. */
    gesture(label, before) { settle('gesture', label, before); stats.lastLabel = label },
    /** Undo everything the history keeps, each compared; then redo all. */
    unwind() {
      catchUp(stats.lastLabel ?? 'end')
      const out = { undone: 0, bad: [], redone: 0, redoBad: [] }
      while (past.length && S.getState().past.length) {
        const want = past.pop(), b = { past: S.getState().past }
        S.getState().undo()
        const now = digest()
        if (want !== null && now !== want) out.bad.push({ at: out.undone, diff: firstDiff(want, now) })
        future.push(last); last = now; out.undone++
      }
      out.leftInStore = S.getState().past.length
      while (future.length && S.getState().future.length) {
        const want = future.pop()
        S.getState().redo()
        const now = digest()
        if (now !== want) out.redoBad.push({ at: out.redone, diff: firstDiff(want, now) })
        past.push(last); last = now; out.redone++
      }
      return out
    }
  }
  return NAMES.length
})`

export async function seedProject({ c, app, media, lib }) {
  const [talk, other, p1, p2] = await lib.seedAssets(app, c, [media.talk, media.other, media.numbered[0], media.broll[0]])
  await lib.seedTimeline(c, [talk.id, other.id])
  await c.run((pics) => {
    const s = window.__store.getState()
    s.setSubtitles([
      { id: 'w0', start: 0.2, end: 2.8, text: 'The cat sat by the window' },
      { id: 'w1', start: 4.6, end: 7.8, text: 'then it walked over the bridge' },
      { id: 'w2', start: 9.6, end: 11, text: 'and came back home' }
    ])
    const v2 = s.runBatch([{ name: 'track.add', params: { kind: 'video' } }])
    const tr = window.__store.getState().project.tracks.find((t) => t.kind === 'video' && t.clipIds.length === 0)
    s.runBatch([
      { name: 'clip.add', params: { assetId: pics[0], trackId: tr.id, start: 2 } },
      { name: 'clip.add', params: { assetId: pics[1], trackId: tr.id, start: 9 } },
      { name: 'marker.add', params: { time: 5 } },
      { name: 'template.place', params: { kind: 'stat', time: 1 } }
    ])
    s.setDirty(false)
    return !!v2
  }, [p1.id, p2.id])
}

/** A real gesture on the timeline: drag a clip's body or its right edge,
 *  S at the playhead with a clip selected, or Delete on a selected clip. */
async function gesture(c, rnd) {
  const ids = await c.ids('timeline.clip.')
  const clips = ids.filter((id) => /^timeline\.clip\.[^.]+$/.test(id))
  if (!clips.length) return 'no clip'
  const id = clips[Math.floor(rnd() * clips.length)]
  const b = await c.box(id)
  if (!b || b.w < 12) return 'too small'
  const kind = ['move', 'trim', 'split', 'delete', 'altcopy'][Math.floor(rnd() * 5)]
  await c.ev('window.__k4b = window.__k4.before(), true')
  if (kind === 'altcopy') await c.dragAt(b.x + b.w * 0.5, b.cy, b.x + b.w * 0.5 + 40 + rnd() * 120, b.cy, { steps: 6, mods: ['alt'] })
  else if (kind === 'move') await c.dragAt(b.x + b.w * 0.5, b.cy, b.x + b.w * 0.5 + (rnd() - 0.4) * 120, b.cy, { steps: 6 })
  else if (kind === 'trim') await c.dragAt(b.x + b.w - 3, b.cy, b.x + b.w - 3 - rnd() * 40, b.cy, { steps: 5 })
  else {
    await c.clickAt(b.x + b.w * (0.2 + rnd() * 0.6), b.cy)
    await c.run((x) => { const s = window.__store.getState(); const k = s.project.clips[x]; if (k) s.setTime(k.start + k.duration * 0.5); return true }, id.slice('timeline.clip.'.length))
    await c.key(kind === 'split' ? 's' : 'Delete')
  }
  await c.sleep(300)
  await c.ev(`window.__k4.gesture(${JSON.stringify('gesture:' + kind)}, window.__k4b), true`)
  return 'gesture:' + kind
}

export async function run(ctx) {
  const { c, lib } = ctx
  const { assert } = lib
  await installProbe(c)
  await seedProject(ctx)
  const n = await c.ev(`${MACHINE}(${SEED})`)
  let x = SEED * 7 + 3
  const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff }
  const kinds = {}
  const t0 = Date.now()
  for (let i = 0; i < STEPS; i++) {
    const k = rnd() < 0.08 ? await gesture(c, rnd) : await c.ev('window.__k4.step()')
    const fam = k.startsWith('gesture') ? k : k.split('.')[0]
    kinds[fam] = (kinds[fam] || 0) + 1
    if (i % 50 === 49) console.log(`     ${i + 1} steps, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  }
  const stats = await c.ev('window.__k4.stats')
  const unwind = await c.ev('window.__k4.unwind()')
  // Part two: 55 steps from a fresh project, all undone: the start exactly.
  await keepModelCount(c)
  await lib.reset(c)
  await seedProject(ctx)
  const start = await c.ev(`(() => { const S = window.__store.getState(); return { past: S.past.length } })()`)
  await c.ev(`${MACHINE}(${SEED + 99})`)
  const d0 = await c.ev('window.__k4.digest()')
  // (The seed's own steps: undo all the history holds after them.)
  let made = 0
  for (let i = 0; i < 55; i++) { await c.ev('window.__k4.step()'); made++ }
  const back = await c.run((p0) => {
    const S = window.__store
    let n = 0
    while (S.getState().past.length > p0 && n < 200) { S.getState().undo(); n++ }
    return n
  }, start.past)
  const d1 = await c.ev('window.__k4.digest()')
  const counts = await tally(c)
  const commandsReached = Object.keys(stats.command).length
  const actionsReached = Object.keys(stats.action).length
  const result = {
    steps: STEPS, seed: SEED, commandsKnown: n, commandsReached, actionsReached, kinds, refused: stats.refused, threw: stats.threw, lastThrow: stats.lastThrow ?? null,
    undo: stats.undo, redo: stats.redo, undoBad: stats.undoBad.length, redoBad: stats.redoBad.length, multi: stats.multi, multiAt: stats.multiAt, late: stats.late, problemsAt: stats.problemsAt.slice(0, 20),
    unwind: { undone: unwind.undone, bad: unwind.bad.length, redone: unwind.redone, redoBad: unwind.redoBad.length, leftInStore: unwind.leftInStore },
    badSamples: [...stats.undoBad.slice(0, 4), ...stats.redoBad.slice(0, 2), ...unwind.bad.slice(0, 3)],
    fresh55: { made, undone: back, sameAsStart: d0 === d1 },
    command: stats.command, action: stats.action
  }
  record(name, { counts, result })
  console.log(`     ${JSON.stringify({ ...result, command: undefined, action: undefined })}\n     counts: ${JSON.stringify({ ...counts, texts: undefined })}`)
  if (counts.model) console.log('     model: ' + counts.texts.model.join('\n     '))
  assert.equal(result.fresh55.sameAsStart, true, 'after 55 steps, all undone: the start')
}
