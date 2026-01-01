// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Opening a project file (phase Ç2a.1, report P8 / D4.2 / D4.3): a damaged
// file gives a typed error or opens repaired so that it keeps every rule of
// the model; a sound file is not touched; the format version runs its
// conversions in order, once; a newer file is said so; an unknown graphic
// is kept.
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProjectFileError, readProjectFile, repairSummary, serializeProject } from '../renderer/src/media/projectio'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import { CONVERSIONS, CURRENT_FORMAT, convertProject } from '../renderer/src/model/format'
import { createTemplate } from '../renderer/src/templates/model'
import { SHAPES } from './oracle/fixture'
import type { Project } from '../renderer/src/types'
import type { RepairNote } from '../renderer/src/model/repair'
import { setLang } from '../renderer/src/ui/strings'

const DIR = join(process.cwd(), 'src', 'test', 'fixtures')
const BROKEN = join(DIR, 'broken')

/** The broken samples that cannot be opened, and the kind of error each gives. */
const REFUSED: Record<string, ProjectFileError['kind']> = {
  '01-cut-short.snipp': 'damaged',
  '02-not-json.snipp': 'damaged',
  '03-empty.snipp': 'damaged',
  '04-a-list.snipp': 'not-project',
  '05-no-version.snipp': 'not-project',
  '06-newer-file-type.snipp': 'newer-type'
}

/** What each repaired sample must have been told about (at least). */
const TOLD: Record<string, string[]> = {
  '07-no-tracks.snipp': ['shape', 'track-made'],
  '08-no-assets.snipp': ['clip-dropped-asset'],
  '09-start-null.snipp': ['clip-dropped-time'],
  '10-clip-on-two-tracks.snipp': ['track-list'],
  '11-listed-clip-missing.snipp': ['track-list'],
  '12-asset-missing.snipp': ['clip-dropped-asset'],
  '13-overlap.snipp': ['overlap'],
  '14-past-media-end.snipp': ['media-end'],
  '15-repeated-ids.snipp': ['duplicate-id'],
  '16-keys-out-of-order.snipp': ['keys'],
  '17-bad-settings.snipp': ['settings'],
  '18-clips-as-a-list.snipp': ['shape'],
  '19-missing-track-and-partner.snipp': ['track-made', 'link', 'reference'],
  '20-caption-times.snipp': ['caption-dropped']
}

test('every broken sample (at least 12) gives a typed error or opens repaired with no problem left, and says what it mended', () => {
  const files = readdirSync(BROKEN).filter((f) => f.endsWith('.snipp')).sort()
  assert.ok(files.length >= 12, `${files.length} samples`)
  assert.deepEqual(files, [...Object.keys(REFUSED), ...Object.keys(TOLD)].sort(), 'every sample has its expectation here')
  for (const f of files) {
    const text = readFileSync(join(BROKEN, f), 'utf8')
    if (REFUSED[f]) {
      assert.throws(() => readProjectFile(text), (e: unknown) => e instanceof ProjectFileError && e.kind === REFUSED[f] && e.message.length > 10, f)
      continue
    }
    const r = readProjectFile(text)
    assert.equal(describeProblems(checkProject(r.project)), '', `${f}: no problem left`)
    const codes = r.repaired.map((x) => x.code)
    for (const c of TOLD[f]) assert.ok(codes.includes(c as never), `${f}: told ${c} (got ${codes.join(', ')})`)
    assert.ok(repairSummary(r.repaired).length > 0, `${f}: one line for the user`)
    // Saved and read again: nothing left to mend.
    const again = readProjectFile(serializeProject(r.project))
    assert.deepEqual(again.repaired, [], `${f}: a second reading mends nothing`)
  }
})

test('every kind of repair has its words, in English and Turkish', () => {
  const codes: RepairNote['code'][] = ['shape', 'settings', 'clip-time', 'clip-dropped-time', 'clip-dropped-asset', 'track-made', 'track-list', 'duplicate-id', 'overlap', 'media-end', 'link', 'reference', 'keys', 'caption-dropped', 'template-unknown', 'template-dropped']
  for (const lang of ['en', 'tr'] as const) {
    setLang(lang)
    for (const code of codes) assert.doesNotMatch(repairSummary([{ code, count: 2 }]), /project\.repair|\{n\}/, `${lang} ${code}`)
  }
  setLang('en')
})

test('the repair keeps the work: a clip on a track that is gone gets its track back; a clip over the media end is shortened, not removed', () => {
  const r = readProjectFile(readFileSync(join(BROKEN, '19-missing-track-and-partner.snipp'), 'utf8'))
  assert.ok(r.project.clips.a, 'the clip of the missing track is still there')
  assert.ok(r.project.tracks.some((t) => t.id === 'v9' && t.clipIds.includes('a')), 'on its track, made again')
  assert.equal(r.project.clips.a.linkId, undefined, 'its partner is gone: no link')
  const m = readProjectFile(readFileSync(join(BROKEN, '14-past-media-end.snipp'), 'utf8')).project
  assert.equal(m.clips.a.inPoint + m.clips.a.duration, 10, 'a plays to the end of its 10 s file')
  const o = readProjectFile(readFileSync(join(BROKEN, '13-overlap.snipp'), 'utf8')).project
  assert.equal(o.clips.b.start, 4, 'the later clip moves to where the first one ends')
})

test('a sound file is not touched: read, write, read gives the same project and mends nothing', () => {
  resetWorld()
  const sound: Project[] = [fixture(), ...SHAPES.map((s) => s().project)]
  for (const p of sound) {
    assert.deepEqual(checkProject(p), [], `${p.name} is sound`)
    const text = serializeProject(p)
    const a = readProjectFile(text)
    assert.deepEqual(a.repaired, [], `${p.name}: nothing mended`)
    assert.equal(serializeProject(a.project), text, `${p.name}: written back the same`)
  }
})

test('format: a file of format 1 (no number) runs its conversions; written, it says format ' + CURRENT_FORMAT + ' and reads back the same', () => {
  const text = readFileSync(join(DIR, 'format-v1.snipp'), 'utf8')
  assert.ok(!text.includes('formatVersion'))
  const { project, repaired, newerFormat } = readProjectFile(text)
  assert.equal(newerFormat, undefined)
  assert.equal(project.mode, 'frame', 'the canvas view became the frame')
  const raw = project as unknown as Record<string, unknown>
  for (const k of ['canvasSegments', 'cameraKeyframes', 'cameraBase', 'cameraMotion', 'formatVersion']) assert.ok(!(k in raw), k)
  assert.ok(!('depth' in project.clips.a))
  assert.equal(project.assets[0].hasAudio, false, 'a code film is never read for sound')
  assert.equal(project.captionStyle.popup?.style, 'focus')
  assert.equal(project.captions[0].style?.popup?.style, 'focus')
  assert.deepEqual(repaired, [])
  const written = serializeProject(project)
  assert.equal((JSON.parse(written) as { formatVersion: number }).formatVersion, CURRENT_FORMAT)
  assert.equal(serializeProject(readProjectFile(written).project), written)
})

test('format: the conversions are in order, and each can run twice (a file an older Snipp saved again)', () => {
  assert.ok(CONVERSIONS.length > 0)
  CONVERSIONS.forEach((c, i) => assert.equal(c.to, i + 2, `conversion ${i} goes to format ${i + 2}`))
  assert.equal(CONVERSIONS[CONVERSIONS.length - 1].to, CURRENT_FORMAT)
  const once = JSON.parse(readFileSync(join(DIR, 'format-v1.snipp'), 'utf8')) as Project
  convertProject(once, 1)
  const twice = structuredClone(once)
  for (const c of CONVERSIONS) c.run(twice)
  assert.deepEqual(twice, once)
  // A file that says it is already of the newest format runs none.
  const marked = JSON.parse(readFileSync(join(DIR, 'format-v1.snipp'), 'utf8')) as Project
  assert.deepEqual(convertProject(marked, CURRENT_FORMAT), [])
  assert.equal(marked.mode, 'canvas' as never, 'untouched by the conversions (the repair makes it a frame on open)')
})

test('format: a file of a newer format opens and says so; a graphic of an unknown kind is kept in the file, not drawn', () => {
  resetWorld()
  const p = fixture()
  const text = JSON.parse(serializeProject(p)) as Record<string, unknown>
  text.formatVersion = CURRENT_FORMAT + 5
  const future = { id: 'fut1', kind: 'hologram', start: 3, duration: 4, beams: [1, 2, 3] }
  text.templates = [...(text.templates as unknown[]), future]
  const r = readProjectFile(JSON.stringify(text))
  assert.equal(r.newerFormat, CURRENT_FORMAT + 5)
  assert.ok(!(r.project.templates ?? []).some((t) => t.id === 'fut1'), 'not among the drawn graphics')
  assert.deepEqual(r.project.unknownTemplates, [future])
  assert.ok(r.repaired.some((x) => x.code === 'template-unknown' && x.count === 1), 'said so')
  const back = JSON.parse(serializeProject(r.project)) as { templates: unknown[]; unknownTemplates?: unknown }
  assert.ok(!('unknownTemplates' in back))
  assert.deepEqual(back.templates.find((t) => (t as { id: string }).id === 'fut1'), future, 'written back as it was')
  // A graphic this build knows is untouched by it.
  createTemplate(r.project, 'stat', 1)
  assert.equal(r.project.unknownTemplates?.length, 1)
})
