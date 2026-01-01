// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// REF-AB, worker P2 (REF-AB-PLAN-P.md): the Projects window at launch, the
// media panel's badge, order and search, the panels' favourites and recents,
// the export window's name and place (the main process's check) and cover.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homeAtLaunch } from '../renderer/src/components/app/launch-home'
import { fold, matches, sortAssets, usedAssetIds } from '../renderer/src/media/bin-order'
import { RECENT_MAX, cleanLists, toggleFav, used, visible, type PickLists } from '../renderer/src/components/picks/picks'
import { EXPORT_EXTENSIONS, cleanStem, exportFileList, safeExportName, stemProblem } from '../shared/export-place'
import { WINDOWS_DEVICE_NAME } from '../main/platform-path'
import { STRINGS_REF_P } from '../renderer/src/ui/strings-ref-p'
import { STRINGS } from '../renderer/src/ui/strings'
import type { Clip } from '../renderer/src/types'

const SRC = join(__dirname, '..', '..', 'src')
const code = (f: string): string => readFileSync(join(SRC, f), 'utf8')

// ---- item 1 ----------------------------------------------------------------------
test('Projects at launch: only when nothing came (no crash, no project, no film) and the setting is on', () => {
  const none = { recovery: false, project: false, film: false }
  assert.equal(homeAtLaunch(true, none), true)
  assert.equal(homeAtLaunch(false, none), false, 'the setting off')
  assert.equal(homeAtLaunch(true, { ...none, recovery: true }), false, 'a crash to recover first')
  assert.equal(homeAtLaunch(true, { ...none, project: true }), false, 'a project from the command line / the OS')
  assert.equal(homeAtLaunch(true, { ...none, film: true }), false, 'a film from VideoHub')
  assert.equal(homeAtLaunch(true, { recovery: false, project: false }), null, 'not decided before all three said')
  assert.equal(homeAtLaunch(true, { project: true }), false, 'one that brought something decides at once')
})

test('Projects at launch: the app waits for the three sources; Settings has the switch; the tour waits for the window', () => {
  const app = code('renderer/src/App.tsx')
  for (const s of ["noteLaunch('recovery'", "noteLaunch('project'", "noteLaunch('film'"]) assert.ok(app.includes(s), s)
  assert.match(app, /whenLaunchSettled\(\(open\) => open && setShowProjects\(true\)\)/)
  assert.match(code('renderer/src/components/settings/SettingsWindow.tsx'), /settings\.general\.homeAtLaunch/)
  assert.match(code('renderer/src/components/Tour.tsx'), /homeBlocksTour\(\)/)
  const home = code('renderer/src/components/ProjectHome.tsx')
  for (const id of ['home.first', 'home.first.new', 'home.first.open', 'home.first.sample', 'home.nomatch']) assert.ok(home.includes(`"${id}"`), id)
})

// ---- item 5 ----------------------------------------------------------------------
const clip = (id: string, assetId: string, nested?: Clip[]): Clip => ({ id, assetId, nested: nested ? { clips: nested } : undefined }) as unknown as Clip

test('media: a file is "in the timeline" when a clip of it is there, inside a compound clip too', () => {
  const clips = { a: clip('a', 'v1'), b: clip('b', '', [clip('c', 'v2', [clip('d', 'v3')])]) }
  assert.deepEqual([...usedAssetIds({ clips: clips as never })].sort(), ['v1', 'v2', 'v3'])
  assert.equal(usedAssetIds({ clips: {} as never }).size, 0)
})

test('media: the orders (added keeps the project order; date newest first, unknown last; ties keep the order)', () => {
  const list = [
    { name: 'b10.mp4', kind: 'video', duration: 5, mtime: 100 },
    { name: 'A2.png', kind: 'image', duration: 0 },
    { name: 'b9.wav', kind: 'audio', duration: 9, mtime: 300 },
    { name: 'c.mp4', kind: 'video', duration: 5, mtime: 200 }
  ] as const
  const names = (by: Parameters<typeof sortAssets>[1]): string[] => sortAssets(list.slice(), by).map((a) => a.name)
  assert.deepEqual(names('added'), ['b10.mp4', 'A2.png', 'b9.wav', 'c.mp4'])
  assert.deepEqual(names('name'), ['A2.png', 'b9.wav', 'b10.mp4', 'c.mp4'])
  assert.deepEqual(names('date'), ['b9.wav', 'c.mp4', 'b10.mp4', 'A2.png'])
  assert.deepEqual(names('duration'), ['b9.wav', 'b10.mp4', 'c.mp4', 'A2.png'])
  assert.deepEqual(names('kind'), ['b10.mp4', 'c.mp4', 'A2.png', 'b9.wav'])
})

test('search: every word, letter case, accents and the Turkish i folded', () => {
  assert.equal(fold('İSTANBUL Işık'), 'istanbul isik')
  assert.ok(matches('ışık', 'ISIK.mp4'))
  assert.ok(matches('gec bul', 'Geçiş', 'Bulanık'))
  assert.ok(!matches('zoom', 'Kaydır', 'Hareket'))
  assert.ok(matches('   ', 'anything'))
})

// ---- item 6 ----------------------------------------------------------------------
test('picks: recents are the last 12, newest first, once each; favourites toggle', () => {
  let l: PickLists = { fav: {}, recent: {} }
  for (let i = 0; i < 15; i++) l = used(l, 'transitions', `k${i}`)
  l = used(l, 'transitions', 'k5')
  assert.equal(l.recent.transitions!.length, RECENT_MAX)
  assert.equal(l.recent.transitions![0], 'k5')
  assert.equal(new Set(l.recent.transitions).size, RECENT_MAX)
  assert.equal(l.recent.filters, undefined, 'per page')
  l = toggleFav(l, 'filters', 'warm')
  assert.deepEqual(l.fav.filters, ['warm'])
  l = toggleFav(l, 'filters', 'warm')
  assert.deepEqual(l.fav.filters, [])
})

test('picks: what a page shows (search by name and group; favourites and recents in their order; unknown ids left out)', () => {
  const items = [
    { id: 'mix', name: 'Mix', group: 'Basic' },
    { id: 'slide', name: 'Slide', group: 'Motion' },
    { id: 'zoom', name: 'Zoom', group: 'Motion' }
  ]
  const l: PickLists = { fav: { transitions: ['zoom', 'gone', 'mix'] }, recent: { transitions: ['slide', 'zoom'] } }
  const ids = (m: 'all' | 'fav' | 'recent', q: string): string[] => visible(items, l, 'transitions', m, q).map((x) => x.id)
  assert.deepEqual(ids('all', ''), ['mix', 'slide', 'zoom'])
  assert.deepEqual(ids('all', 'motion'), ['slide', 'zoom'], 'by group')
  assert.deepEqual(ids('all', 'zo'), ['zoom'])
  assert.deepEqual(ids('fav', ''), ['zoom', 'mix'])
  assert.deepEqual(ids('recent', ''), ['slide', 'zoom'])
  assert.deepEqual(ids('recent', 'zoom'), ['zoom'])
})

test('picks: a stored value is cleaned, never trusted (kept in the profile, not the project)', () => {
  assert.deepEqual(cleanLists(null), { fav: {}, recent: {} })
  const c = cleanLists({ fav: { effects: ['a', 'a', 3, ''], evil: ['x'] }, recent: { filters: Array.from({ length: 40 }, (_, i) => `l${i}`) } })
  assert.deepEqual(c.fav.effects, ['a'])
  assert.equal((c.fav as Record<string, unknown>).evil, undefined)
  assert.equal(c.recent.filters!.length, RECENT_MAX)
  const picks = code('renderer/src/components/picks/picks.ts')
  assert.match(picks, /localStorage/)
  assert.doesNotMatch(picks, /useStore|state\/store/, 'nothing of it goes into the project')
})

test('picks: Effects, Transitions and Filters pages have the search line and bookmarks; the Inspector grids unchanged without them', () => {
  const pages = code('renderer/src/components/picks/pages.tsx')
  assert.match(pages, /testid="effects\.pick"/)
  assert.match(pages, /testid="transitions\.pick"/)
  assert.match(code('renderer/src/components/WorkspaceDock.tsx'), /testid="filters\.pick"/)
  // (The Inspector passes none of the new props: its grids are as they were.)
  const insp = code('renderer/src/components/inspector/transition-section.tsx')
  assert.match(insp, /return mark \? <div className="pick-card"/)
})

// ---- item 7 ----------------------------------------------------------------------
test('empty states: a picture drawn in code, one sentence, one action, in Media, Sound, the pages, the search and Projects', () => {
  const art = code('renderer/src/components/empty-art.tsx')
  for (const k of ['media', 'sound', 'effects', 'search', 'projects']) assert.match(art, new RegExp(`\\b${k}: \\(`), k)
  assert.match(code('renderer/src/components/MediaBin.tsx'), /art="media"/)
  assert.match(code('renderer/src/components/MediaBin.tsx'), /art="search"/)
  assert.match(code('renderer/src/components/SoundEffectsPanel.tsx'), /art="sound"/)
  assert.match(code('renderer/src/components/picks/PickBar.tsx'), /art="search"/)
  assert.match(code('renderer/src/components/ProjectHome.tsx'), /kind="projects"/)
})

// ---- item 11 ---------------------------------------------------------------------
test('export names: a plain file name of an export kind; never a folder, a device, a project file', () => {
  assert.ok(safeExportName('film.mp4'))
  assert.ok(safeExportName('Benim filmim (2).webm'))
  assert.ok(safeExportName('film-kapak.png'))
  for (const bad of ['..\\x.mp4', 'a/b.mp4', 'c:x.mp4', 'film.snipp', 'film.json', 'film.exe', 'film', '.mp4', 'con.mp4', 'NUL .png', 'film..mp4', 'film .mp4', 'a?.png', 'x\u0001.wav', 3, null])
    assert.equal(safeExportName(bad), false, String(bad))
  assert.deepEqual(exportFileList(['a.mp4', 'a.wav']), ['a.mp4', 'a.wav'])
  assert.equal(exportFileList(['a.mp4', 'A.MP4']), null, 'the same file twice')
  assert.equal(exportFileList([]), null)
  assert.equal(exportFileList(Array.from({ length: 7 }, (_, i) => `f${i}.png`)), null)
  assert.equal(exportFileList('a.mp4'), null)
  for (const e of EXPORT_EXTENSIONS) assert.ok(!['snipp', 'autocut', 'json', 'txt'].includes(e))
})

test('export names: what the window says and offers', () => {
  assert.equal(stemProblem(''), 'empty')
  assert.equal(stemProblem('a:b'), 'chars')
  assert.equal(stemProblem('film.'), 'end')
  assert.equal(stemProblem('com1'), 'device')
  assert.equal(stemProblem('Film 1'), null)
  assert.equal(cleanStem('a: b?'), 'a- b-')
  assert.equal(cleanStem('...'), 'export')
  assert.equal(cleanStem('nul'), 'export')
})

test('export names: the device rule is the main process’s own', () => {
  for (const n of ['con', 'CON', 'nul.txt', 'com1', 'lpt9', 'COM¹', 'conin$', 'clock$', 'con .txt', 'console', 'comx', 'lpt', 'film'])
    assert.equal(stemProblem(n) === 'device', WINDOWS_DEVICE_NAME.test(n), n)
})

test('export place: the main process writes only into a folder the user chose, only plain export names, a file there only when agreed', () => {
  const ipc = code('main/ipc/export-place-ipc.ts')
  assert.match(ipc, /showOpenDialog\(win, \{\s*properties: \['openDirectory', 'createDirectory'\]/)
  assert.match(ipc, /const dir = await known\(args\.dir\)\s*\n\s*if \(!dir\) return \{ ok: false, error: 'folder not chosen' \}/)
  assert.match(ipc, /exportFileList\(args\.files\)/)
  assert.match(ipc, /isSafeOutput\(p\) && path\.dirname\(p\) === dir/)
  assert.match(ipc, /if \(there\.length && args\.replace !== true\) return \{ ok: false, exists: there \}/)
  // The paths become writable only after all of that (as a save dialog's).
  assert.ok(ipc.lastIndexOf('chosenSavePaths') > ipc.indexOf('args.replace !== true'))
  assert.equal((ipc.match(/chosenSavePaths/g) ?? []).length, 2, 'named in the header, added to in one place')
  // The save dialog's folder counts as chosen; nothing else adds to the list.
  assert.match(code('main/ipc/file-ipc.ts'), /await rememberExportFolder\(path\.dirname\(p\)\)/)
  assert.equal((ipc.match(/rememberExportFolder\(/g) ?? []).length, 3, 'defined, the folder window, a run approved')
})

test('export window: name and place fields, the folder button the only system window, the cover beside the video', () => {
  const xw = code('renderer/src/components/ExportWindow.tsx')
  const place = code('renderer/src/components/export/ExportPlace.tsx')
  assert.match(place, /testid="export\.name"/)
  assert.match(place, /testid="export\.place\.choose"/)
  assert.match(place, /chooseFolder\(/)
  assert.match(xw, /coverName = \(s: string\): string => `\$\{s\}-\$\{say\('refp\.export\.cover\.suffix'\)\}\.png`/)
  assert.match(xw, /saveStillFrame\(\{ size: 'project', format: 'png', captions: true \}, \{ path: coverPath, time: coverAt \}\)/)
  // A file already there: asked first.
  assert.match(xw, /confirmDialog\(\{ title: say\('refp\.export\.replace\.title'\)/)
})

// ---- the words -----------------------------------------------------------------------
test('REF-AB P2 words: English and Turkish, the same parameters, in STRINGS', () => {
  const params = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  for (const [k, v] of Object.entries(STRINGS_REF_P) as [string, { en: string; tr?: string }][]) {
    assert.ok(v.tr, `${k}: Turkish`)
    assert.deepEqual(params(v.tr!), params(v.en), `${k}: parameters`)
    assert.ok(k in STRINGS, `${k} in STRINGS`)
  }
})
