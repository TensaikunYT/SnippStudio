// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The mutation run (SnippStudio phase 4A.10, F10): the agent core is broken
// in a temporary copy, one rule at a time, and every mutation must be
// noticed — by `npm test` or by a short oracle run. A mutation nobody notices
// (a survivor) is a failure: exit code 1.
//
//   npm run mutate                       every mutation
//   npm run mutate -- --only=M07,N03     some of them
//   npm run mutate -- --check            only: is every pattern still in the code (once)?
//   npm run mutate -- --list             the table, nothing run
//   npm run mutate -- --keep             leave the copy there (to look at a survivor)
//   npm run mutate -- --resume           go on where a run of this very tree stopped
//
// Not part of `npm test` (it takes about half an hour). The working tree is
// never touched: the copy is ..\.mutate-tmp (beside app\, so the tests find
// ..\testdata), its node_modules is a junction to this one, and at the end
// the junction itself is removed first (cmd /c rmdir), then the folder —
// never a recursive delete through the junction. Results:
// ..\testdata\fuzz-sonuc\mutate-last.json.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TMP = resolve(APP, '..', '.mutate-tmp')
const MARK = '.mutate-copy'

const R = 'src/renderer/src/agent/replay.ts'
const C = 'src/renderer/src/agent/content.ts'
const D = 'src/renderer/src/agent/drafts.ts'
const E = 'src/renderer/src/agent/edit.ts'
const A = 'src/renderer/src/agent/answers.ts'
const F = 'src/renderer/src/agent/format.ts'
const AD = 'src/renderer/src/agent/address.ts'
const RS = 'src/renderer/src/agent/restore.ts'
const K = 'src/renderer/src/state/slices/cutting.ts'
// (Part II: the analyses, restore points, jobs.)
const RP = 'src/renderer/src/analysis/repeats.ts'
const FI = 'src/renderer/src/analysis/fillers.ts'
const AZ = 'src/renderer/src/agent/analyze.ts'
const SI = 'src/renderer/src/audio/silence.ts'
const MR = 'src/main/agent-restore.ts'
const PI = 'src/renderer/src/media/projectio.ts'

/** id, the rule it breaks (and the finding it belongs to), the edits:
 *  [file, text that is there exactly once, what replaces it]. */
export const MUTATIONS = [
  // ---- the reviewer's table (haritalar\_faz4a9-dogrulama.md) ----
  ['M01', 'a record op lands on a piece spilling out of its window', [[R, 'if (lo < r.lo - SLIVER || hi > r.hi + SLIVER) drop(', 'if (false) drop(']]],
  ['M02', 'line keys without the word text, no expected-value check (oracle)', [
    [R, 'keysOf(p, anchor, c).every((k, i) => k === l.keys![i])', "keysOf(p, anchor, c).every((k, i) => (k ?? '').split('|')[0] === l.keys![i].split('|')[0])"],
    [R, 'if (!expected(op, `line ${op.lines![0].id}`, f, cur, ctx)) drop(', 'if (false) drop(']
  ]],
  ['M03', 'a structural re-run compared on clips and tracks only (oracle#2)', [
    [R, 'if (!sameFilm(p, ref.before)) drop(', 'if (!sameLayout({ ...p, markers: [], captions: [], templates: [] }, { ...ref.before, markers: [], captions: [], templates: [] })) drop('],
    [R, 'if (!sameFilm(out.project, ref.after)) drop(', 'if (!sameLayout({ ...out.project, markers: [], captions: [], templates: [] }, { ...ref.after, markers: [], captions: [], templates: [] })) drop(']
  ]],
  ['M04', 'a dropped op is not rolled back (its last run is kept)', [
    [R, 'function run(p: Project, calls: readonly CommandCall[], env: CommandEnv): { project: Project; results: unknown[] } {\n  return applySequence(p, checkBatch(calls), env)\n}', 'let lastRun: Project | undefined\nfunction run(p: Project, calls: readonly CommandCall[], env: CommandEnv): { project: Project; results: unknown[] } {\n  const out = applySequence(p, checkBatch(calls), env)\n  lastRun = out.project\n  return out\n}'],
    [R, '    const r = applyOp(cur, op, envFor(entry.seed, index, cur, ctx.extra), ctx, entry.baseLive)', '    lastRun = undefined\n    const r = applyOp(cur, op, envFor(entry.seed, index, cur, ctx.extra), ctx, entry.baseLive)'],
    [R, '    return { project: cur, outcome: { ...head, applied: false, reason: errorText(e).replace(', '    return { project: e instanceof Drop && lastRun ? lastRun : cur, outcome: { ...head, applied: false, reason: errorText(e).replace(']
  ]],
  ['M05', 'one id stream for all ops and drafts, the used-id guard off', [
    [R, 'const s = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) | 0', 'const s = 12345 + 0 * seed * index'],
    [R, 'if (used.has(id) || given.has(id)) continue', 'if (given.has(id)) continue']
  ]],
  ['M06', 'the subtitle-on-its-sound invariant off (oracle#5)', [[R, '  if (before.captions === after.captions) return null', '  if (before.captions === after.captions || Date.now() > 0) return null']]],
  ['M07', 'a cut ignores a clip of another track put inside its range (oracle#1)', [[R, '  for (const tr of p.tracks) {\n    if (tr.id === anchor || tr.locked) continue\n    for (const c of clipsOn(p, tr.id)) if (c.start < b - EXACT', '  for (const tr of [] as typeof p.tracks) {\n    if (tr.id === anchor || tr.locked) continue\n    for (const c of clipsOn(p, tr.id)) if (c.start < b - EXACT']]],
  ['M08', 'a retired (told) op is treated as live', [[R, '  if (op.retired) return {', "  if (op.retired && !op.retired.includes('dropped before your later edit')) return {"]]],
  ['M09', "a partial accept takes the whole draft's project", [[D, 'const reuse = whole && d.on === st.project && !d.broken', 'const reuse = d.on === st.project && !d.broken']]],
  ['M10', 'a split at the second that was read', [[R, 'calls = at.map((x) => ({ name: op.name, params: { ...op.params, clipIds: [x.clip.id], time: x.time } }))', 'calls = at.map((x) => ({ name: op.name, params: { ...op.params, clipIds: [x.clip.id], time: op.params.time } }))']]],
  ['M11', 'a record op written to the first piece only', [[R, '    for (const c of list) {\n      if (r.solid) {', '    for (const c of list.slice(0, 1)) {\n      if (r.solid) {']]],
  ['M12', "marks not carried to the word's new place in its line", [[R, 'if (marks) params.patch = {', 'if (false) params.patch = {']]],
  ['M13', 'footage that is there twice: the first hit is taken (oracle#9)', [[C, "    if (hit) return 'ambiguous'", '    if (hit) continue']]],
  ['M14', 'a cut over clips lying over each other (oracle#8)', [[R, 'const over = overlapOn(p, anchor)', 'const over = null as [string, string] | null']]],
  ['M15', 'a trim takes more than was meant', [[R, 'if (lenOf(without(went, meant)) > EXACT) drop(', 'if (false) drop(']]],
  ['M16', 'the cut does not ask what else went (oracle#4)', [[R, "if (without(went, want).some(([a, b]) => b - a > SLIVER * sp + EXACT)) return 'it would cut footage the edit did not mean'", "if (false) return 'x'"]]],
  ['M17', "an analysis result read on the edit's base, not on the version it was measured on", [[E, 'out.push({ call, base: r.project ?? base,', 'out.push({ call, base: base,']]],
  ['M18', 'a lock change does not make the draft stale', [
    [D, 'if (draft && (draft.stale || locksOf(useStore.getState().project) !== locksOf(draft.on))) refresh(draft)', 'if (draft && draft.stale) refresh(draft)'],
    [D, 'const locks = s.project !== prev.project && locksOf(s.project) !== locksOf(draft.on)', 'const locks = false']
  ]],
  ['M19', 'a placement does not ask what else changed (oracle#10)', [[R, "if (made.added.length !== 1 || made.removed.length || made.changed.length || !none(rest) || !none(d.clips) || !none(d.templates) || !none(d.tracks) || d.other.length) drop('it would now also change other things')", 'void made; void rest']]],
  ['M20', 'a setting may change a field it did not change when it was sent (oracle#10)', [[R, '      if (extra) drop(`it would now also change ${extra}', '      if (false) drop(`it would now also change ${extra}']]],
  ['M21', 'a cut takes the other place of a range it holds back', [[R, '    } else located.push(...mine)', '    }\n    located.push(...mine)']]],
  ['M22', "a duplicate keeps the original's instance (command layer)", [[K, 'const c: Clip = { ...clone(src), id: uid() }\n          relink(c, links, all, p)\n          delete c.instance', 'const c: Clip = { ...clone(src), id: uid() }\n          relink(c, links, all, p)\n          c.instance = instanceOf(src)']]],
  ['M23', 'a cut leaves its ranges after the first out, and says so', [[R, '      if (fresh.length) put ??= fresh[0]\n', "      if (fresh.length || i > 0) put ??= fresh[0] ?? { id: 'nothing', at: [] }\n"]]],
  ['M23b', 'a cut leaves its last range out, and says so', [[R, '      if (fresh.length) put ??= fresh[0]\n', "      if (fresh.length || (i > 0 && i === op.ranges!.length - 1)) put ??= fresh[0] ?? { id: 'nothing', at: [] }\n"]]],
  ['M24', "one placement in five dropped as 'nothing to do' (oracle#6)", [[R, "  let at = locate(p, op.point!, op.edge === 'end')\n", "  if (Math.floor(op.point!.m * 100) % 5 === 0) drop('nothing to do: x')\n  let at = locate(p, op.point!, op.edge === 'end')\n"]]],
  ['M25', 'direct mode says applied and lands nothing (oracle#6)', [[D, "  land(r.project, r.outcomes, session)\n  // (What landed is the session's own from here on.)\n  me.own = scratch.own", "  void land\n  // (What landed is the session's own from here on.)\n  me.own = scratch.own"]]],

  // ---- one for each rule of this round (FAZ4A-PLAN.md 8.2) ----
  ['N01', 'A1 / core#1: whatever lies in a range is taken with the cut (nothing is "new there")', [[R, 'const fresh = lenient ? [] : inside.filter((x) => !known(x, [r.had, r.met, ctx.made], ctx.moved))', 'const fresh: Inside[] = []']]],
  ['N02', 'A2 / core#2: two tracks of talking pictures: the first is the anchor', [[C, 'if (talk.size) return talk.size === 1 ? [...talk][0] : null', 'if (talk.size) return [...talk][0]']]],
  ['N02b', 'A2 / core#2: a placement does not ask what other sound lies under its moment', [[R, '  if (moved) drop(`${sayInside(moved)} lies under it now', '  if (moved && Date.now() < 0) drop(`${sayInside(moved)} lies under it now']]],
  ['N03', "A3 / core#3, drafts#2, #3: another session's version counts as the session's own", [[D, 'return after.some((e) => agentVersions.get(e.version) !== session)', 'return after.some((e) => !agentVersions.has(e.version))']]],
  ['N04', 'A4 / core#4: a still is the clip that was read whatever became of it', [[R, 'if (!ok) drop(`${op.clips![0].id} was cut in two, moved or changed in length', 'if (false) drop(`${op.clips![0].id} was cut in two, moved or changed in length']]],
  ['N05', 'A5 / core#5: a trim deletes a piece that was carried off or restyled', [[R, '      if (c !== keep && (apart || other)) drop(', '      if (false) drop(']]],
  ['N06', 'A6 / core#6: marks set after the read are replaced', [[R, "        if (!ok) drop('the marks of this line were changed after you read it (not by you)')", '        void ok']]],
  ['N07', 'A7 / core#9: a transition goes into whatever clip follows now', [[R, "        if (!same) drop('the clip that follows it is not the one that followed when you read it", "        if (false) drop('the clip that follows it is not the one that followed when you read it"]]],
  ['N08', 'A7 / core#8: a delete takes away a transition set after the read', [[R, '      if (was === undefined || !sameValue(was, c.transitionOut)) drop(', '      if (false) drop(']]],
  ['N09', "A8 / core#7: a title may lie over footage that came back under its length", [[R, '        if (before && y - x > (SLIVER + EXACT) * Math.max(0.01, c.speed ?? 1)) drop(', '        if (false) drop(']]],
  ['N10', 'A9 / contract#5: "at the start" / "at the end" do not outlive the footage at that time', [[R, '    if (!op.edge || !list.length || theirs) return drop(', '    if (list.length >= 0) return drop(']]],
  ['N11', 'A12 / core#10: a lock set or lifted since the read is no change to a cut', [[R, '  const foreign = ctx.userChangedSince(op.baseLive ?? baseLive) || (op.locks !== undefined && op.locks !== locksOf(p))\n  const lenient = first && !foreign', '  const foreign = ctx.userChangedSince(op.baseLive ?? baseLive)\n  const lenient = first && !foreign']]],
  ['N11b', 'A12 / core#10: a locked track left behind by a cut is not said', [[R, '    return stay.length ? { notes: stay.map(', '    return stay.length < 0 ? { notes: stay.map(']]],
  ['N12', 'A10 / drafts#5: "did anyone change it" is asked from the edit\'s base, not from the version the result was measured on', [[E, '...(r.live !== undefined ? { baseLive: r.live } : {})', '...({})']]],
  ['N13', 'A10 / analyses#5: a retake is cut although the take it was cut for is gone', [[R, '      if (all > 0 && there < all / 2) {', '      if (all < 0) {']]],
  ['N14', 'K-1 run literally: a structural run may lose subtitle words whose sound stays', [[R, '  return !!anchor && wordsHold(before, after, anchor, [], true) === LOST_WORD', '  return false && wordsHold(before, after, anchor!, [], true) === LOST_WORD']]],
  ['N15', 'A11 / safety#1: the id an agent gives becomes the id of the record', [[E, '        alias = fields[k] as string\n        delete fields[k]\n', '        alias = fields[k] as string\n']]],
  ['N15b', "A11 / safety#1: a name of the map's prototype is taken as a name", [[E, ' || (fields[k] as string) in Object.prototype) throw', ') throw']]],
  ['N16', 'S14 / contract#1: a name given earlier in the call is not known to the ops after it', [[R, '      if (used.length) {\n        const gone', '      if (used.length < 0) {\n        const gone']]],
  ['N17', 'A11 / safety#4: no bound on the ranges of one call', [[E, 'export const MAX_RANGES_PER_EDIT = 600', 'export const MAX_RANGES_PER_EDIT = 600000']]],
  ['N17b', 'A11 / safety#4: a call the server gave up on while it was worked out still lands', [
    [D, '  guard?.()\n  const entry = r.entry', '  void guard\n  const entry = r.entry'],
    [D, "  guard?.()\n  if (!r.outcomes.some((o) => o.applied)) return { outcomes: r.outcomes, applied: false }", "  void guard\n  if (!r.outcomes.some((o) => o.applied)) return { outcomes: r.outcomes, applied: false }"]
  ]],
  ['N17c', 'A11 / safety#4: no bound on the ops of one call', [[E, 'export const MAX_OPS_PER_EDIT = 200', 'export const MAX_OPS_PER_EDIT = 200000']]],
  ['N18', 'A11 / drafts#10: an op that could not be read can be brought back', [[D, "if (!d || !op?.retired || op.uncaptured || op.settled === 'accepted') return false", "if (!d || !op?.retired || op.settled === 'accepted') return false"]]],
  ['N19', 'A11 / drafts#11: an error no one foresaw inside a replay is thrown on', [[R, "      console.error('agent replay: an op failed unexpectedly', op.name, e)\n", '      throw e\n']]],
  ['N20', 'B1 / drafts#4: accept does not carry the locks the card showed', [[D, 'shown.signature !== plan.shown.signature || shown.locks !== plan.shown.locks', 'shown.signature !== plan.shown.signature']]],
  ['N20b', 'B1 / S12: accept does not carry the live version the card showed', [[D, 'shown.live !== plan.shown.live || shown.signature', 'shown.signature']]],
  ['N21', 'B2 / liveness#5, contract#2: a range a cut leaves out is no drop (not told, no row, accept is "all")', [[D, '      for (const i of o.left ?? []) {', '      for (const i of [] as number[]) {']]],
  ['N22', 'B2 / drafts#6: what drops at the accept is not told', [[D, "  const said = lost.map((x) => `accept: ${x.label} (#${x.seq}) was dropped at the accept: ${x.reason}`)", '  const said: string[] = lost.length < 0 ? [] : []']]],
  ['N23', 'B2 / drafts#7: a partial accept forgets what the agent was told', [[D, "    for (const k of [...d.told.keys()]) if (chosen.has(Number(k.split(':')[0]))) d.told.delete(k)", '    d.told.clear()']]],
  ['N24', "A3 / drafts#9: what a draft wrote is the session's own at once (a rejected one's too)", [[D, '  d.mine = scratch\n  // A drop the agent was told of', '  d.mine = scratch\n  Object.assign(sessOf(session, client), copyOf(scratch))\n  // A drop the agent was told of']]],
  ['N25', 'B4 / drafts#12: a draft not replayed on the changed project is not shown as "updating"', [
    [D, '    ...(d.stale ? { updating: true } : {}),', '    ...({}),'],
    [D, 'if (shown && !shown.updating) useAgentStore.getState().setDraft({ ...shown, updating: true })', 'void shown']
  ]],
  ['N26', 'B4 / drafts#13: versions of a closed project are kept', [[D, '  for (const [t, x] of c.kept) if (x.projectSession !== k.projectSession) c.kept.delete(t)\n', '']]],
  ['N26b', 'B4 / drafts#13: the state of a session that is gone is kept', [[D, '  if (draft?.session !== session) sessions.delete(session)\n  if (client && lastOfClient', '  if (client && lastOfClient']]],
  ['N27', "B4 / drafts#8: a draft's point is not let go when another file is opened", [[RS, '    for (const [k, period] of periods) if (k !== key && !period.landed) letGo(period)\n', '']]],
  ['N28', 'C6 / liveness#2: a draft of which only empty tracks are left is adopted', [[D, "  const hollow = kept.length > 0 && kept.every((o) => o.command === 'track.add') && lost.length > 0", '  const hollow = false']]],
  ['N29', 'B3 / contract#3, #10: a cut that followed no footage does not say what it cut', [[R, '    return { project: out.project, result: out.results[0], ...(cuts?.length ? { cuts } : {}), ...(notes.length ?', '    return { project: out.project, result: out.results[0], ...(cuts?.length ? {} : {}), ...(notes.length ?']]],
  ['N30', 'B3 / contract#4: "already cut" does not say whose doing it was', [[R, ": 'already cut by your own earlier edit: its footage is gone, nothing to resend')", ": 'already cut: its footage is no longer on the timeline (it was removed after you read it)')"]]],
  ['N30b', 'B3 / contract#9: the answer does not say that the cut was made where the footage is now', [[E, '      if (!o.applied || !o.cuts || !sent) return false', '      if (o.applied || !o.cuts || !sent) return false']]],
  ['N31', 'C6 / contract#8: a setting does not say how much it reached', [[R, '...(r.scope ? { scope: r.scope } : {})', '...({})']]],
  ['N32', 'C1 / liveness#1: media not on the timeline is a count, not rows with ids', [[F, '    lines.push(...unused.slice(0, MEDIA_ROWS).map((a) => `  ${mediaRow(a)}`))\n', '']]],
  ['N32b', 'C1 / contract#7: markers are listed without their ids', [[F, '): string => `${m.id} ${sec(m.time)}', '): string => `${sec(m.time)}']]],
  ['N33', 'C6 / contract#12: changes is silent when it has no cut list although times moved', [[F, "  else if (ch.clips.added.count + ch.clips.removed.count + ch.clips.moved.count + ch.captions.moved.count > 0) lines.push('Cuts: not known", "  else if (ch.clips.added.count < 0) lines.push('Cuts: not known"]]],
  ['N34', 'C6 / liveness#4: ops applied after dropped ones are not said', [[A, "  if (o.outcomes.some((x) => x.applied && (x.sent ?? x.index) > firstDrop)) lines.push('Ops after the dropped ones were applied", "  if (firstDrop < -1) lines.push('Ops after the dropped ones were applied"]]],
  ['N35', 'C2: an asset or track id ties an op to the version it was read in', [[AD, 'export const lastingId = (path: string): boolean => /', "export const lastingId = (path: string): boolean => path === '' && /"]]],
  ['N36', 'C5: an op that only adds does not outlive a change of someone else', [[R, '    if (op.read) {\n      const out = held(go(), op.read)', '    if (op.read && Date.now() < 0) {\n      const out = held(go(), op.read)']]],
  ['N37', 'C4: a time given by a word stays the second that was read', [[R, '      else params = setAt(params, a.path, at.time) as Record<string, unknown>', '      else void at']]],
  ['N38', 'C3: ops of the same call that only added still count as "moved what was there"', [[R, 'const moved = !!op.frame && !sameLayout(p, op.frame) && !(op.fresh && onlyAddedSince(op.frame, p))', 'const moved = !!op.frame && !sameLayout(p, op.frame)']]],
  ['N38b', "C3 the other way: a structural op runs as written although the session's own edits moved what was there", [[R, 'const moved = !!op.frame && !sameLayout(p, op.frame) && !(op.fresh && onlyAddedSince(op.frame, p))', 'const moved = false']]],
  ['N38c', 'A (structural): an op that depends on how everything lies runs as written after a change of someone else', [[R, '    if (!foreign && !locked && (!moved || zone)) {', '    if (!locked && (!moved || zone)) {']]],
  ['N39', "A3: records the session's own cuts moved are someone else's change", [[R, 'if (!sameInside(from, to)) ctx.moved!.push([from, to])', 'void from, void to']]],
  ['N40', "A1: a marker the session made itself is someone else's inside a later cut", [[R, "for (const m of q.markers ?? []) if (d.markers.added.includes(m.id)) ctx.made.push(recordAs(q, anchor, 'marker', m.id, m.time))", 'void recordAs']]],
  ['N41', 'A (K-1): a record or trim op may lose a subtitle word whose sound stays', [[R, '      if (!have.some((x) => Math.abs(x - m) <= 1e-4)) return LOST_WORD', '      if (!have.some((x) => Math.abs(x - m) <= 1e-4)) continue']]],
  ['N42', "A3: two sessions' direct edits share one id stream", [[D, '(seams.entrySeed(++me.direct) ^ salt) | 0', '(seams.entrySeed(++me.direct) ^ (salt & 0)) | 0']]],
  ['N43', "A2 (found by the runs): which track the talk is on depends on a lock", [[C, '    if (!a || !oneToOne(p, c) || c.muted || (c.volume ?? 1) <= 0) continue\n    const own = ', '    if (!a || !oneToOne(p, c) || c.muted || (c.volume ?? 1) <= 0 || p.tracks.find((t) => t.id === c.trackId)?.locked) continue\n    const own = ']]],
  ['N44', 'a cut may leave footage it meant to cut', [[R, "if (!dropped && overlap(merge(list), coverOf(got.project, inst)).some(([a, b]) => b - a > SLIVER * sp + EXACT)) return drop('it would leave footage it meant to cut')", 'void dropped']]],
  ['N45', 'C6 / liveness#6: the card lists every copy of an op that was sent again', [[D, "  const replaced = r.outcomes.filter((o) => !o.applied && !!opOf(o)?.retired?.includes('dropped before your later edit')).length", '  const replaced = 0 * r.outcomes.length'], [D, "filter((x) => x.o.applied || !opOf(x.o)?.retired?.includes('dropped before your later edit'))", 'filter((x) => x.o.applied || !!opOf(x.o) || true)']]],
  ['N46', 'C6 / contract#6: calls of which nothing is applied are counted as waiting', [[E, 'pending: d ? d.entries.filter((e) => d.outcomes.some((o) => o.seq === e.seq && o.applied)).length : 0', 'pending: d ? d.entries.length : 0']]],
  ['N48', 'B3 / contract#10: the cut list is the ranges as they were asked, not merged to what went', [[R, '  return done({ project: got.project, result: got.result, cuts: cutOf(got.result) ?? mergeCutRanges(all), ...lockedNote(all)', '  return done({ project: got.project, result: got.result, cuts: all, ...lockedNote(all)']]],
  ['N49', "A1 / drafts#1: a piece the session's cut split off someone else's clip is \"made by the session\"", [[R, 'if (q.clips[id].trackId !== anchor && !piecesOf(cur, instanceOf(q.clips[id])).length) ctx.made.push(', 'if (q.clips[id].trackId !== anchor) ctx.made.push(']]],
  ['N50', 'C6: an apply that chose nothing is run as a cut of no ranges instead of being dropped with its reason', [[R, '      if (c.refused) throw new CommandError(c.call.name, c.refused)\n', '']]],
  ['O11',"F9 / oracle#11: the oracle's judgement takes a decision from the core (an import in run.ts)", [['src/test/oracle/run.ts', "import type { Asset, Clip, Project } from '../../renderer/src/types'\n", "import type { Asset, Clip, Project } from '../../renderer/src/types'\nimport { anchorTrack } from '../../renderer/src/agent/content'\nexport const borrowed = anchorTrack\n"]]],
  ['N47','C6 / liveness#6: every drop is answered with "read again"', [[A, 'const reread = o.outcomes.some((x) => !x.applied && /read again|reading again|after you read|when you read|no longer on the timeline|is not as you read/.test(x.reason ?? \'\'))', 'const reread = o.outcomes.some((x) => !x.applied)']]],
  // ---- Part II (FAZ4A-PLAN.md 9) ----
  ['P01', 'D2 / analyses#2: a pair of sentences one word apart is a sure retake', [[RP, '...(same && !why.length ? {} :', '...(!why.length ? {} :']]],
  ['P02', 'D3 / analyses#4: a retake at guessed seconds (no word times) is sure', [[RP, "    if (guessed) why.push('guessed times')", "    if (false) why.push('guessed times')"]]],
  ['P03', 'D1 / analyses#1: silences are read on every clip with sound (a music bed, an effect, a silent B-roll)', [[AZ, 'const speech = await speechClips(project, words, loudness, signal, failed)', 'const speech = (await Promise.all(Object.values(project.clips).filter((c) => carriesAudio(project, c)).map(async (clip) => ({ clip, dbs: (await loudness(project, clip, ANALYSIS_WINDOW))! })))).filter((x) => x.dbs)']]],
  ['P04', 'D1: a silence range that enters a subtitle word is sure', [[AZ, 'const touches = ([a, b]: [number, number]): boolean => words.some(', 'const touches = ([a, b]: [number, number]): boolean => false && words.some(']]],
  ['P05', 'D4 / analyses#6: English "er" / "err" is a sure filler', [[FI, "if (lang === 'en' && !SOUND_TR.test(form) && SOUND_EN.test(form)) return", "if (false && lang === 'en' && !SOUND_TR.test(form) && SOUND_EN.test(form)) return"]]],
  ['P06', 'D4 / analyses#8: a sound said with ! or ? is a sure filler', [[FI, "if (/[!?]/.test(w)) return 'said with ! or ?'", "if (false) return 'said with ! or ?'"]]],
  ['P07', 'D4 / analyses#6: a capital inside a sentence is a sure filler', [[FI, 'if (i > 0 && words[i - 1].captionId === words[i].captionId', 'if (false && i > 0 && words[i - 1].captionId === words[i].captionId']]],
  ['P08', "D4 / analyses#6: the 'auto' language flips on one Turkish letter", [[FI, "return tr > en ? 'tr' : 'en'", "return /[çğıöşüİ]/i.test(text.replace(/I/g, '')) ? 'tr' : 'en'"]]],
  ['P09', "D5 / analyses#9: one clip's mix does not stop at the cancel", [[AZ, 'const r = await cut(measureClip(project, clip.id, stop.signal))', 'const r = await cut(measureClip(project, clip.id))']]],
  ['P10', 'D5 / analyses#9: the whole mix does not stop at the cancel', [[AZ, 'const all = await cut(measureProject(project, stop.signal))', 'const all = await cut(measureProject(project))']]],
  ['P11', 'D5 / analyses#9: the beats do not stop at the cancel', [[AZ, 'await cut(beats(project, music.id, signal))', 'await cut(beats(project, music.id))']]],
  ['P12', 'D5 / analyses#9: the beats of the first clip with sound (the talk)', [[AZ, 'const music = [...sounding].sort((a, b) => rank(b) - rank(a) || b.duration - a.duration)[0]', 'const music = sounding[0]']]],
  ['P13', 'D5 / analyses#9: the 20-clip cap is not said', [[AZ, 'const more = sounding.length > AUDIO_CLIPS_MAX ?', 'const more = false ?']]],
  ['P14', 'D5 / safety#9: one session may fill every waiting analysis', [['src/renderer/src/agent/queue.ts', 'if (owner !== undefined && owned >= perOwner) throw', 'if (false && owner !== undefined && owned >= perOwner) throw']]],
  ['P15', 'D5 / safety#9: frames sheets are all drawn at once', [['src/renderer/src/agent/frames.ts', 'if (drawing >= SHEETS_AT_ONCE) await', 'if (false && drawing >= SHEETS_AT_ONCE) await']]],
  ['P16', 'D5 / safety#9: the server holds any number of calls of one session', [['src/main/agent-host.ts', 'if (mine >= SESSION_CALLS_MAX) return', 'if (false && mine >= SESSION_CALLS_MAX) return']]],
  ['P17', 'D7 / safety#7: the preflight answer judges how it looks ("would look wrong", "stands still")', [[AZ, 'const issues = preflight(project).map((x) => ({ ...x, text: fact(x) }))', 'const issues = preflight(project).map((x) => ({ ...x, text: x.text || fact(x) }))'], [AZ, 'head: `${list.length}: gaps', 'head: `${list.length} things that would look or sound wrong; found before export: gaps']]],
  ['P18', 'D6 / analyses#10: a retake cut takes 2.5 s of the speech before the dropped take', [[RP, 'cut: [ms(Math.max(0, first[0] - 0.03))', 'cut: [ms(Math.max(0, first[0] - 2.5))']]],
  ['P19', "E1 / safety#2: Save As over a file: its old points stay points before the agent under the moved project's path", [[MR, '    if (kept(p)) continue', '    if (kept(p) || p.at >= 0) continue']]],
  ['P20', 'E1 / safety#2: the point before the agent on disk is taken by path alone (any project identity)', [[RS, '(n) => keyOfName(n) === key && idOfName(n) === id &&', '(n) => keyOfName(n) === key && !!id &&']]],
  ['P21', 'E1 / safety#3: the key is taken at the first agent call and from the path already moved', [[RS, 'const o = open && open.ps === projectSession() ? open : sync(from)', 'const o = sync()'], [RS, '  if (!open || open.ps !== projectSession()) sync()', '  if (open && open.ps !== projectSession()) sync()']]],
  ['P22', 'E1 / safety#3: a closed project renamed leaves its points under the old path', [[RS, 'if (a === b || !io.rekey) return Promise.resolve()', 'if (a !== b || !io.rekey) return Promise.resolve()']]],
  ['P23', "E2 / safety#5: past the cap, other projects' points before the agent are deleted", [[MR, "const spare = left.filter((p) => p.kind !== 'pre')", "const spare = left.filter((p) => p.kind !== 'pre' || p.key !== keepKey)"]]],
  ['P24', 'E1: one point before the agent per path, whatever project it is of', [[MR, "const pre = list.filter((p) => p.kind === 'pre' && p.id === id)", "const pre = list.filter((p) => p.kind === 'pre' && !!id === !!id)"]]],
  ['P25', 'E2 / safety#5: points kept past the cap are not told', [[RS, "if (written.over && written.over > toldOver) tell({ key: 'agent.restoreFull'", "if (written.over && Date.now() < 0) tell({ key: 'agent.restoreFull'"]]],
  ['P26', 'E2 / safety#8: the accept does not wait for the point to be written', [[RS, '    await pointBeforeAccept()', '    void pointBeforeAccept().catch(() => undefined)']]],
  ['P27', 'E1: a file read without an identity gets none', [['src/renderer/src/media/projectio.ts', "if (typeof out.project.uid !== 'string' || !out.project.uid) out.project.uid = newProjectUid()", "if (typeof out.project.uid !== 'string' || !out.project.uid) void newProjectUid"]]],
  ['P28', 'E3 / safety#6: the lines are written into a drag the user is in', [['src/renderer/src/subtitles/write.ts', 'while (dragInProgress() && Date.now() - t0 < maxWait)', 'while (false && dragInProgress() && Date.now() - t0 < maxWait)']]],
  ['P29', 'E3 / safety#6: the lines are no undo step of their own', [['src/renderer/src/subtitles/write.ts', 'st.undoable(() => useStore.getState().setSubtitles(captions))', 'void st; useStore.getState().setSubtitles(captions)']]],
  ['P30', 'table#1: a line taken by its id although its words changed (split)', [[R, 'const found = own && (same(own) || mine) ? [own] :', 'const found = own ? [own] :']]],
  ['P31', 'table#2: touched ranges kept in the draft’s seconds (not carried to the live note)', [['src/renderer/src/agent/notes-tool.ts', 'if (!plan.touched || seen === live) return', 'if (!plan.touched || seen === live || Date.now() > 0) return']]],
  ['P32', 'table#5: the notes listed in live seconds while the agent reads its draft', [['src/renderer/src/agent/notes-tool.ts', 'if (seen === live) return notesText(live, projectPath, filter, taken)', 'if (seen === live || seen !== live) return notesText(live, projectPath, filter, taken)']]],
  ['P33', 'table#3: a delete that fails while pruning fails the write of the point', [[MR, '      // Held by something else right now: the next write tries again.', "      throw new Error('held')"]]],
  ['P34', 'table#4: speech with no words written is in a plain apply', [[AZ, 'data: u, uncertain: true, heading: UNWRITTEN_HEADING', 'data: u, heading: UNWRITTEN_HEADING']]],
  ['P35', "table#6: a call in flight when access goes off is told 'cancelled'", [['src/main/agent-host.ts', 'p.resolve(errorResult(ACCESS_OFF))', "p.resolve(errorResult('Agent access was turned off in Snipp; the call was cancelled.'))"]]],
  ['P36', 'table#7: the speech is read at another window than the other analyses', [[AZ, 'return read(project, clip, ANALYSIS_WINDOW, signal)', 'return read(project, clip, 0.05, signal)']]],
  ['P37', 'table#7: the ids an entry makes are made again differently on every replay', [[R, '    const r = applyOp(cur, op, envFor(entry.seed, index, cur, ctx.extra), ctx, entry.baseLive)', '    const r = applyOp(cur, op, envFor(entry.seed + Math.floor(Math.random() * 1e6), index, cur, ctx.extra), ctx, entry.baseLive)']]],
  ['P38', 'contract#11: a base pasted as the read prints it ("v 4987d-2") is refused', [[D, "const givenOf = (token: unknown): string => (typeof token === 'string' ? token.trim().replace(", "const givenOf = (token: unknown): string => (typeof token === 'string' ? token.trim() || token.replace("]]],
  ['P39', 'contract#11: the changes tool told to "send the edit"', [[D, "const from = keptOf(client, token, 'since')", 'const from = keptOf(client, token)']]],
  ['P40', 'contract#11: a reason says its command name twice', [[A, 'for (const n of [o.name, o.command]) if (n && why.startsWith(`${n}: `)) why = why.slice(n.length + 2)', 'void why']]],
  ['P41', 'contract#11: a transcript range that is no stretch answered as "nothing is said here"', [[F, 'if (to - from <= 0 || from >= dur) throw new Error(', 'if (to - from <= 0 && from >= dur && dur < 0) throw new Error(']]],
  ['P42', 'liveness#6: the structural drop does not name the op that moved the layout', [[R, 'and an earlier edit of yours${mover} moved or cut', 'and an earlier edit of yours${mover && ""} moved or cut']]],
  ['P43', 'contract#11: the edit’s list of commands names the note.* ones', [['src/renderer/src/commands/index.ts', ".filter((n) => !n.startsWith('note.'))", '']]],
  ['P44', 'E2 / safety#5: the overflow is told at every write', [[RS, 'if (written.over && written.over > toldOver) tell(', 'if (written.over) tell(']]],
  ['P45', 'E1 / safety#2: a point of another project at the same path is put back by its name', [[RS, 'if (idOfName(name) !== identityOf(useStore.getState().project)) throw new Error(', 'if (Date.now() < 0) throw new Error(']]],
  // ---- Phase 4A.11, Bölüm A (FAZ4A-PLAN.md 10) ----
  ['Q01', "K1: an op may destroy or write over what someone else changed after the agent read (the general rule off)", [[R, '  for (const r of touchedBy(before, after)) {', '  for (const r of touchedBy(before, before)) {']]],
  ['Q02', "K1: a difference the session wrote itself counts as someone else's", [[R, '  for (let i = list.length - 1; i >= 0; i--) if (Math.min(hi, list[i].hi) - Math.max(lo, list[i].lo) > EXACT || (list[i].lo === -Infinity && lo === -Infinity)) return sameDeep(cur, list[i].value)', '  void list']]],
  ['Q03', 'K1: two halves cut together and linked anew are a changed link', [[R, "      if (!!x !== !!y) out.add(k)\n      continue\n    }\n    if ((k === 'fadeIn'", "      if (!sameDeep(x, y)) out.add(k)\n      continue\n    }\n    if ((k === 'fadeIn'"]]],
  ['Q04', 'K1: a subtitle line that lost words to a cut (or got them back) is a changed line', [[R, '  const cut = both && (', '  const cut = both && Date.now() < 0 && (']]],
  ['Q05', "K1: what the session made is the session's whatever became of it since", [[R, "      if (!was) return `${K1_SAY} (line ${l.id} was not there when you read it)`", "      if (!was || ctx.own.has(`k1 made|${recKey('line', l.id)}`)) continue"]]],
  ['Q06', 'K2: footage that plays in a second place since the first run is cut there too', [[R, '    if (!first && twice && r.twice === false) {', '    if (false) {']]],
  ['Q07', "K3: a second window that takes over a draft takes over the gone session's landed work as its own", [[D, '      sessions.delete(d.session)\n      d.session = session', '      for (const [v, who] of agentVersions) if (who === d.session) agentVersions.set(v, session)\n      sessions.delete(d.session)\n      d.session = session']]],
  ['Q08', "K4: a call's later op is read without what its earlier ops added", [[R, 'for (const [b, f] of frames) frames.set(b, withAdded(f, before, r.project))', 'void frames']]],
  ['Q09', 'K5: a clip whose sound is off counts as the talk', [[C, '    if (!a || !oneToOne(p, c) || c.muted || (c.volume ?? 1) <= 0) continue\n    const own = ', '    if (!a || !oneToOne(p, c)) continue\n    const own = ']]],
  ['Q10', "K6: times given by words do not outlive the session's own cut", [[R, ' && !byWordWhole(op, p)', '']]],
  ['Q11', 'K7: "at the start" outlives a change of someone else\'s after the first run', [[R, "const theirs = foreign && (!ctx.live || locate(ctx.live, op.point!, op.edge === 'end') === 'gone')", 'const theirs = foreign && op.metUnder === undefined']]],
  ['Q12', 'P2: a piece carried off (not restyled) is still the clip named', [[R, '      if (off) apart ??= ', '      if (off && Date.now() < 0) apart ??= ']]],
  ['Q13', 'K1: a value of a draft op that was dropped since counts as someone else\'s change', [[R, '    if (!under) return false\n', '    if (under || !under) return false\n']]],
  ['Q14', 'K1 (seen by the fuzz): a sliver a cut leaves makes its whole content "made by the session"', [[R, '      if (!piecesOf(before, inst).length) {', '      if (!was.length) {']]],
  ['Q15', 'T1: broll.place is not written out in the edit tool', [['src/renderer/src/agent/tools.ts', '    if (BY_HAND[c.name] ?? LINE[c.name]) return BY_HAND[c.name] ?? LINE[c.name]\n    if (FROM_RESULT', '    if (LINE[c.name]) return LINE[c.name]\n    if (FROM_RESULT']]],
  ['Q16', 'T2 / T8: the New line names only ids (no op, no place, no "past the end")', [[E, ', made: newEntries(r.outcomes, namesOf(r.outcomes), useStore.getState().project, live0, kept2.project) })', ' })']]],
  ['Q17', 'T9: a thing sent twice is not said to be the same as the first', [[A, "      if (twin) parts.push(", "      if (twin && Date.now() < 0) parts.push("]]],
  ['Q18', 'T3: a second mover in a call is told to read again, not to come in a call of its own', [[R, "    const here = mover.includes('of this call')", '    const here = false']]],
  ['Q19', 'T4: the 600-range refusal says to read again before sending the rest', [[E, ': send the rest in a next call with the same base (an analyze result: "only":[n…] the items left)', ' (send the rest in a next call, after reading again)']]],
  ['Q20', 'T5: the draft news name only the call', [[D, "  const opOf = (o: Outcome): string => `call #${o.seq} op #${(o.sent ?? o.index) + 1} ${o.name}`", "  const opOf = (o: Outcome): string => `#${o.seq} ${o.name}`"]]],
  ['Q21', "T6: a marker on a word the agent's own op cut says only that the footage is gone", [[R, "    if (by) drop(`the footage at its time was cut by your own op", "    if (by && Date.now() < 0) drop(`the footage at its time was cut by your own op"]]],
  ['Q22', 'T7: an op dropped at a partial accept does not say which call it was written on', [[D, "    return !o.applied && gone !== undefined && !o.reason?.startsWith('call #')", "    return Date.now() < 0 && gone !== undefined"]]],
  ['Q23', 'T10: the preflight head frames the facts as faults found before export', [[AZ, 'head: `${list.length}: gaps', 'head: `${list.length} found before export: gaps']]],
  // ---- K1b: what is lost, not what differs ----
  ['Q25', 'K1b (a): a clip gone whole is not a lost change', [[R, '  if (!now.length || left <= SLIVER + EXACT) return fields[0]', '  if (false) return fields[0]']]],
  ['Q26', 'K1b (b): a clip field the op writes over is not a lost change', [[R, '  const wrote = new Set(now.flatMap((x) => clipDiffers(x, c, solid)))', '  const wrote = new Set<string>()']]],
  ['Q27', 'K1b (c): keys in what the op takes away are not lost', [[R, '    if (TIMED.has(k) && keysWithin(c, k, gone) !== keysWithin(w, k, gone)) return k', '    if (false) return k']]],
  ['Q28', 'K1b (c): a fade or a way in / out on an edge the op takes away is not lost', [[R, "    if ((k === 'fadeIn' && head) || (k === 'fadeOut' && tail) || (k === 'anim' && (head || tail))) return k", '    if (false) return k']]],
  ['Q29', 'K1b (a): a line gone whole is not a lost change', [[R, '  if (!a) return fields[0]', '  if (!a) return null']]],
  ['Q30', 'K1b (b): a line field the op writes over is not a lost change', [[R, '  const wrote = new Set(lineDiffers(a, l))', '  const wrote = new Set<string>()']]],
  ['Q31', 'K1b (c): a retyped word that goes is not lost', [[R, "goneIdx.some((i) => !read.includes(l.words![i].text))) return 'words'", "false) return 'words'"]]],
  ['Q32', 'K1b (c): a marked word that goes is not lost', [[R, "goneIdx.some((i) => (l.marks ?? []).includes(i))) return 'marks'", "false) return 'marks'"]]],
  ['Q33', 'K1b (c): a text of its own, rebuilt from the words left, is not lost', [[R, "&& a.text !== l.text) return 'text'", "&& false) return 'text'"]]],
  ['Q34', 'K1b: a marker or template deleted or written over is not a lost change', [[R, '    const f = theirs.find((k) => !nowRec || !sameDeep(nowRec[k], r.rec[k]))', '    const f = theirs.find(() => false)']]],
  ['Q35', 'K1b: marks do not follow their words when a line lost words (a changed mark is not seen)', [[R, '      if (fromShort.size !== fromLong.size || [...fromShort].some((i) => !fromLong.has(i))) out.push(k)', '      void fromShort']]],
  ['Q36', 'K1b (a): a still deleted while another piece of it stays is not gone whole', [[R, '    : Object.hasOwn(after.clips, c.id) ? [after.clips[c.id]] : []', '    : piecesLike(after, c, solid)']]],
  ['Q37', "K1b: the same content playing in another place counts as a clip's own pieces", [[R, '.filter((x) => x.id === c.id || (!Object.hasOwn(before.clips, x.id) && x.trackId === c.trackId && inside(x, c) && (cutFrom(x)?.id ?? c.id) === c.id))', '.filter((x) => !!x || !!cutFrom(x))']]],
  ['Q38', "K1b: a new piece inside a clip's window is its own even when it was cut from another place", [[R, '(cutFrom(x)?.id ?? c.id) === c.id', '!!cutFrom']]],
  ['Q24', 'the cut halving takes one place of a range and leaves its other place (a range is cut whole or not at all)', [[R, '    if (same) same.spans.push(x.span)\n    else byRange.push({ range: x.range, spans: [x.span] })', '    byRange.push({ range: x.range, spans: [x.span] })\n    void same']]],
  // ---- Faz 4A.11, Bölüm B (FAZ4A-PLAN.md 10.5) ----
  ['B01', 'N1 (1): the sure retake compares folded words (oldu / öldü, sınır / sinir, kar / kâr)', [[RP, 'Array.from({ length: k }, (_, i) => exactWord(words[idx[from + i]].text))', 'Array.from({ length: k }, (_, i) => tok[from + i])']]],
  ['B02', 'N1 (2): a retake ending with ? or ! is sure', [[RP, "    if (endA === '?' || endB === '?') why.push('ends with ?')\n    else if (endA === '!' || endB === '!') why.push('ends with !')\n    else if", '    if']]],
  ['B03', 'N1 (2): two takes with other end marks (or none) are sure', [[RP, "    else if (endA !== endB) why.push('ends differ')\n    else if (!endA) why.push('no end mark')", '    else void endB']]],
  ['B04', 'N1 (3): a retake of three or four words is sure', [[RP, 'const SURE_WORDS = 5', 'const SURE_WORDS = 3']]],
  ['B05', 'N1 (5): two takes far apart are sure', [[RP, '    if (gap > SURE_GAP + 1e-9) why.push(`gap ${gap.toFixed(1)} s`)', '    if (false) why.push(`gap ${gap.toFixed(1)} s`)']]],
  ['B06', 'N2: an estimated word time counts as measured', [['src/renderer/src/analysis/words.ts', 'export const guessedTime = (w: FlatWord): boolean => w.wordIdx < 0 || !!w.estimated', 'export const guessedTime = (w: FlatWord): boolean => w.wordIdx < 0']]],
  ['B07', 'N2: speech with no words is bounded by estimated word times', [[RP, '    if (guessedTime(words[g]) || guessedTime(words[g + 1])) continue', '    if (words[g].wordIdx < 0 || words[g + 1].wordIdx < 0) continue']]],
  ['B08', 'N3: a pause under another voice (a guest with no subtitles) is sure', [[AZ, "const why = touches(r) ? 'enters a word' : await voiceUnder(r)", "const why = touches(r) ? 'enters a word' : null"]]],
  ['B09', 'N3: speech level is the speech\'s own loud level (a bed 8 dB under the voice is not)', [[AZ, 'const SPEECH_BELOW = 10', 'const SPEECH_BELOW = 0']]],
  ['B10', 'N4: a quoted sound is a sure filler', [[FI, "if (/[\"“”«»„‘’]/.test(w) || /^'|'[,.;:…]*$/.test(w)) return 'in quotes'", "if (false) return 'in quotes'"]]],
  ['B11', 'N4: a sound the sentence goes on after is a sure filler ("Um is our app", "aa batteries")', [[FI, "  if (!apart(i)) return 'the sentence goes on'", "  if (false && !apart(i)) return 'the sentence goes on'"]]],
  ['B12', 'N4: a pause of 0.1 s sets a sound apart', [[FI, 'export const APART_PAUSE = 0.15', 'export const APART_PAUSE = 0.1']]],
  ['B13', 'N4: a sound opening a sentence that ends with ! or ? is a sure filler', [[FI, '    if (end) return `opens a sentence ending in ${end[1]}`', '    void end']]],
  ['B14', 'N4: a sound alone on its line after a question is a sure filler', [[FI, "  if (line.every((x) => isFillerSound(x.text, lang)) && prev.length", "  if (false && line.every((x) => isFillerSound(x.text, lang)) && prev.length"]]],
  ['B15', 'P1: a crash snapshot does not name the file its project was of', [[PI, 'export const recoveryText = (project: Project): string => serializeProject(project, { recoveredPath: keyPath })', 'export const recoveryText = (project: Project): string => serializeProject(project)']]],
  ['B16', 'P1: a recovered project loses its file for the restore points (as before: a new key)', [[PI, '  setLastProjectPath(null)\n  keyPath = file\n', '  setLastProjectPath(null)\n  void file\n']]],
  ['B17', "P1: a project moved onto its file: the file's OLDER point before the agent of the same project is demoted, the newer one stays", [[MR, "const kept = (p: Parsed): boolean => p.id !== '' &&", "const kept = (p: Parsed): boolean => false && p.id !== '' &&"]]],
  ['B18', 'P1: in memory a moved point stays "before the agent" after the profile made it a session point', [[RS, '          if (periods.get(to)?.pre === p) periods.delete(to)', '          void to']]],
  ['B19', 'P2: a Save As moves the points (the original file loses its own)', [[RS, "rekey(o.key, next, how === 'saveAs' && o.key.startsWith('f'))", 'rekey(o.key, next, false)']]],
  ['B20', 'P2: the profile renames instead of copying', [[MR, '      if (copy === true) await writeFileAtomic(', '      if (copy === 1) await writeFileAtomic(']]],
  ['B21', 'P3: a file opened with another save id keeps its points before the agent (profile)', [[MR, '  if (was === undefined || was === id) return out', '  if (was !== id || was === id) return out']]],
  ['B22', 'P3: the page does not report the file it opened', [[RS, "  if (!file || !io.opened || projectKey(file.file) !== key) return", '  if (!file || !io.opened || projectKey(file.file) !== key || key) return']]],
  ['B23', "P3: the app's own save is not told to the profile (it looks like another program's)", [[PI, '  savedListeners.forEach((fn) => fn(file, saveId))', '  void savedListeners']]],
  ['B24', 'P3: the window keeps an open period whose point became a session point', [[RS, '      if (period && names[period.pre.name]) periods.delete(key)', '      void period']]],
  ['B25', "P3: a rename leaves the key's save id behind", [[MR, '      saves[to] = saves[from]\n', '']]],
  ['B26', 'S1: the analysis queue is per session (or per call), not per client', [['src/renderer/src/agent/queue.ts', 'analysisQueue.add(work, signal, session.client)', 'analysisQueue.add(work, signal, `${session.client}${Math.random()}`)']]],
  ['B27', 'S1: a client with nothing waiting finds the queue full', [['src/renderer/src/agent/queue.ts', 'if (list.length >= max && (owner === undefined || owned > 0)) throw', 'if (list.length >= max) throw']]],
  ['B28', 'S2: a client may keep any number of sessions', [['src/main/agent-host.ts', '    if (own.length >= SESSIONS_PER_CLIENT) drop(own)', '    if (false) drop(own)']]],
  ['B29', "S2: a full server forgets the oldest session of all, not the opener's own", [['src/main/agent-host.ts', 'if (!drop(all.filter((s) => s.client === name)) && !drop(all))', 'if (!drop(all))']]]
]

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)
const only = arg('only', '')
const chosen = MUTATIONS.filter(([id]) => !only || only.split(',').includes(id))
if (only && chosen.length !== only.split(',').length) {
  console.error(`unknown mutation in --only=${only}`)
  process.exit(2)
}

if (flag('list')) {
  for (const [id, what, edits] of MUTATIONS) console.log(`${id.padEnd(5)} ${what}  [${[...new Set(edits.map((e) => e[0].split('/').pop()))].join(', ')}]`)
  console.log(`${MUTATIONS.length} mutations`)
  process.exit(0)
}

/** The mutated text of a file, or what is wrong with the pattern. */
function mutated(root, edits) {
  const out = new Map()
  for (const [file, find, rep] of edits) {
    const src = (out.get(file) ?? readFileSync(join(root, file), 'utf8')).replace(/\r\n/g, '\n')
    const n = src.split(find).length - 1
    if (n !== 1) return `${file}: the text to change is there ${n} times (once is wanted): ${find.slice(0, 70).replace(/\n/g, '\\n')}`
    out.set(file, src.replace(find, () => rep))
  }
  return out
}

// Every pattern is still in the code, once (a rule that was rewritten needs
// its mutation written again: a stale one is a failure, not a pass).
let stale = 0
for (const [id, , edits] of MUTATIONS) {
  const m = mutated(APP, edits)
  if (typeof m === 'string') {
    stale++
    console.error(`${id}: stale: ${m}`)
  }
}
if (stale) process.exit(2)
if (flag('check')) {
  console.log(`${MUTATIONS.length} mutations, every pattern found once`)
  process.exit(0)
}

// ---- the copy -----------------------------------------------------------------

const SKIP = new Set(['node_modules', 'out', 'out-test', 'models', 'models-dist', 'cikti', 'release', 'release-staged', 'dist', '.git', 'review-fix', 'review-next2', '.videohub'])

/** Removes the copy: the junction to node_modules FIRST and by itself
 *  (rmdir of a junction removes the link, never what it points to), then
 *  the folder. Refuses to go on while the junction is still there. */
function removeCopy() {
  if (!existsSync(TMP)) return
  if (!existsSync(join(TMP, MARK))) throw new Error(`${TMP} is there and is not a copy this script made: remove it yourself`)
  const link = join(TMP, 'node_modules')
  const there = () => {
    try {
      lstatSync(link)
      return true
    } catch {
      return false
    }
  }
  if (there()) {
    if (process.platform === 'win32') spawnSync('cmd', ['/c', 'rmdir', link], { stdio: 'inherit' })
    else unlinkSync(link)
  }
  if (there()) throw new Error(`could not remove the link ${link}: the copy is left as it is (nothing was deleted)`)
  if (!existsSync(join(APP, 'node_modules', 'typescript'))) throw new Error('node_modules of the app is not as it was: stopped, nothing more deleted')
  rmSync(TMP, { recursive: true, force: true })
}

function makeCopy() {
  removeCopy()
  mkdirSync(TMP)
  writeFileSync(join(TMP, MARK), 'a temporary copy made by app\\scripts\\mutate.mjs; node_modules is a junction: remove it with "cmd /c rmdir node_modules" before deleting this folder\n')
  for (const name of readdirSync(APP)) {
    if (SKIP.has(name)) continue
    cpSync(join(APP, name), join(TMP, name), { recursive: true })
  }
  symlinkSync(join(APP, 'node_modules'), join(TMP, 'node_modules'), 'junction')
}

const exec = (cmd, args, timeoutMs) =>
  new Promise((done) => {
    const child = spawn(cmd, args, { cwd: TMP, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      done({ code: code ?? 1, out, hung: signal !== null })
    })
  })

const SHARDS = Math.max(2, Math.min(8, cpus().length - 1))
const SCALE = Number(arg('fuzz', 1))
/** The short oracle run: [kind, sequences]. */
const FUZZ = [
  ['full', Math.round(480 * SCALE)],
  ['agent', Math.round(160 * SCALE)],
  ['pure', Math.round(80 * SCALE)],
  ['two', Math.round(160 * SCALE)]
]
const ALWAYS_ALIVE = ['none', 'cut', 'undo', 'redo', 'split', 'move', 'trim', 'delete', 'add', 'mark', 'note', 'prop', 'capText']

async function fuzz() {
  const jobs = []
  for (const [kind, total] of FUZZ) {
    const parts = kind === 'full' ? Math.min(SHARDS, 4) : 1
    const per = Math.ceil(total / parts)
    for (let i = 0; i < parts; i++) jobs.push(exec(process.execPath, [join('out-test', 'test', 'oracle', 'shard.js'), String(1 + i * per), String(per), kind, 'noshrink'], 600_000).then((r) => ({ kind, r })))
  }
  const sum = { failing: 0, kinds: {}, agentDrops: 0, breaks: 0, crashed: 0 }
  for (const { kind, r } of await Promise.all(jobs)) {
    let t
    try {
      t = JSON.parse(r.out.trim().split('\n').pop()).tally
    } catch {
      sum.crashed++
      continue
    }
    sum.failing += t.failing
    for (const [k, v] of Object.entries(t.byKind)) sum.kinds[k] = (sum.kinds[k] ?? 0) + v
    if (kind === 'pure' || kind === 'agent') sum.agentDrops += Object.values(t.agentDrops).reduce((a, b) => a + b, 0)
    for (const [k, v] of Object.entries(t.liveness)) if (v.dropped > 0 && k.split('+').every((c) => ALWAYS_ALIVE.includes(c))) sum.breaks += v.dropped
  }
  return sum
}

async function tests() {
  const dir = join(TMP, 'out-test', 'test')
  // (Not the scale test: it measures, 45 s of it, and guards no rule.)
  const files = readdirSync(dir).filter((f) => f.endsWith('.test.js') && f !== 'agent-scale.test.js').map((f) => join('out-test', 'test', f))
  const r = await exec(process.execPath, ['--test', ...files], 900_000)
  const failed = Number((r.out.match(/^[ℹ#] fail (\d+)/m) ?? [])[1] ?? (r.code === 0 ? 0 : 1))
  const names = [...r.out.matchAll(/^\s*(?:✖|not ok \d+ -) (.+?)(?: \([\d.]+ms\))?$/gm)].map((m) => m[1].trim())
  return { failed: r.hung ? Math.max(1, failed) : failed, hung: r.hung, names: [...new Set(names)].filter((n) => !/\.test\.js$/.test(n)).slice(0, 3) }
}

async function compile() {
  const r = await exec(process.execPath, [join('node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.test.json', '--incremental', '--tsBuildInfoFile', join('out-test', 'tsbuildinfo')], 600_000)
  writeFileSync(join(TMP, 'out-test', 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n')
  return r
}

async function judge() {
  const c = await compile()
  if (c.code !== 0) return { compile: c.out.split('\n').filter((l) => /error TS/.test(l)).slice(0, 2).join(' | ') || `tsc exit ${c.code}` }
  const [t, f] = await Promise.all([tests(), fuzz()])
  return { tests: t, fuzz: f }
}

const noticedBy = (j) => {
  const by = []
  if (j.tests.failed > 0) by.push(`tests ${j.tests.failed}${j.tests.hung ? ' (hung)' : ''}`)
  const f = j.fuzz
  if (f.failing > 0 || f.agentDrops > 0 || f.breaks > 0 || f.crashed > 0) by.push(`oracle ${f.failing} seq${f.agentDrops ? `, ${f.agentDrops} agent-alone drops` : ''}${f.breaks ? `, ${f.breaks} alive breaks` : ''}${f.crashed ? `, ${f.crashed} shards crashed` : ''}`)
  return by
}

let cleaned = false
const cleanUp = () => {
  if (cleaned || flag('keep')) return
  cleaned = true
  try {
    removeCopy()
  } catch (e) {
    console.error(String(e))
  }
}
process.on('SIGINT', () => {
  cleanUp()
  process.exit(130)
})

// What a run has found so far is written after every mutation: a run that
// was cut goes on with --resume, as long as the sources are the very same.
function treeHash() {
  const h = createHash('sha1')
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx|json|mjs)$/.test(name)) h.update(name).update(readFileSync(full))
    }
  }
  walk(join(APP, 'src'))
  h.update(readFileSync(join(APP, 'tsconfig.test.json')))
  return h.digest('hex')
}
const RESULTS = join(APP, '..', 'testdata', 'fuzz-sonuc')
const PROGRESS = join(RESULTS, 'mutate-progress.json')
const tree = treeHash()
const editsHash = (edits) => createHash('sha1').update(JSON.stringify(edits)).update(JSON.stringify(FUZZ)).digest('hex')
let progress = { tree, base: false, rows: {} }
if (flag('resume') && existsSync(PROGRESS)) {
  try {
    const was = JSON.parse(readFileSync(PROGRESS, 'utf8'))
    if (was.tree === tree) progress = was
  } catch {
    // (An unreadable file: the run starts again.)
  }
}
const save = () => {
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(PROGRESS, JSON.stringify(progress, null, 1))
}

const t0 = Date.now()
const rows = []
let code = 0
try {
  makeCopy()
  // The copy as it is must be clean: otherwise nothing below means anything.
  const base = progress.base ? { tests: { failed: 0, names: [] }, fuzz: { failing: 0, agentDrops: 0, breaks: 0, crashed: 0, kinds: {} } } : await judge()
  if (base.compile || noticedBy(base).length) {
    console.error(`the unmutated copy is not clean: ${base.compile ?? noticedBy(base).join('; ')} ${base.tests ? base.tests.names.join(' | ') : ''}`)
    code = 2
  } else {
    console.log(`unmutated: tests 0 failing, oracle 0 of ${FUZZ.map(([k, n]) => `${k} ${n}`).join(' + ')} sequences (${progress.base ? 'from the run that was cut' : `${((Date.now() - t0) / 1000).toFixed(0)} s`})`)
    progress.base = true
    save()
    for (const [id, what, edits] of chosen) {
      const t1 = Date.now()
      const done = progress.rows[id]
      if (done && done.edits === editsHash(edits)) {
        rows.push(done.row)
        console.log(`${id.padEnd(5)} ${done.row.verdict.padEnd(9)} ${done.row.detail || ''}  (from the run that was cut)  ${what}`)
        continue
      }
      const files = mutated(APP, edits)
      for (const [file, text] of files) writeFileSync(join(TMP, file), text)
      const j = await judge()
      // (Back to the real text, whatever came of it.)
      for (const file of files.keys()) cpSync(join(APP, file), join(TMP, file))
      const row = { id, what, seconds: Math.round((Date.now() - t1) / 1000) }
      if (j.compile) Object.assign(row, { verdict: 'DOES NOT COMPILE', detail: j.compile })
      else {
        const by = noticedBy(j)
        Object.assign(row, { verdict: by.length ? 'killed' : 'SURVIVES', tests: j.tests.failed, oracle: j.fuzz.failing, kinds: j.fuzz.kinds, agentDrops: j.fuzz.agentDrops, breaks: j.fuzz.breaks, detail: by.join('; '), first: j.tests.names })
      }
      rows.push(row)
      progress.rows[id] = { edits: editsHash(edits), row }
      save()
      console.log(`${id.padEnd(5)} ${row.verdict.padEnd(9)} ${row.detail || ''}${row.first?.length ? `  [${row.first[0].slice(0, 90)}]` : ''}  (${row.seconds} s)  ${what}`)
    }
    const survivors = rows.filter((r) => r.verdict !== 'killed')
    const blind = rows.filter((r) => r.verdict === 'killed' && r.oracle === 0 && !r.agentDrops && !r.breaks)
    const testBlind = rows.filter((r) => r.verdict === 'killed' && r.tests === 0)
    console.log(`\n${rows.length} mutations: ${rows.length - survivors.length} killed, ${survivors.length} not (${survivors.map((r) => r.id).join(', ') || 'none'}); seen by the tests only ${blind.length} (${blind.map((r) => r.id).join(', ')}); by the oracle run only ${testBlind.length} (${testBlind.map((r) => r.id).join(', ')}); ${((Date.now() - t0) / 60000).toFixed(1)} min`)
    mkdirSync(RESULTS, { recursive: true })
    writeFileSync(join(RESULTS, only ? 'mutate-some.json' : 'mutate-last.json'), JSON.stringify({ at: new Date().toISOString(), tree, fuzz: FUZZ, rows }, null, 1))
    if (survivors.length) code = 1
  }
} catch (e) {
  console.error(e)
  code = 2
} finally {
  cleanUp()
}
process.exit(code)
