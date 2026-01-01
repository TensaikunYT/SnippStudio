// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.2, decision 3 (report P9, D6): a project folder that moves finds
// its media. Main's finding (main/project-media.ts) on real folders — Turkish
// letters and paths longer than 260 characters included — the relative path
// written with a save, and the renderer's open of a moved folder (the main
// process stood in by api-stub.ts, finding with the real code).
import { stubApi } from './api-stub'
import './dom-stub'
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { findInFolder, locateMedia, relativeMediaPath, withRelativePaths } from '../main/project-media'
import { openProjectByPath, serializeProject, setLastProjectPath } from '../renderer/src/media/projectio'
import { relinkTheRest, type PickedFile, type RelinkDeps } from '../renderer/src/media/relink'
import { useStore } from '../renderer/src/state/store'
import type { Asset } from '../renderer/src/types'

const isMedia = (p: string): boolean => /\.(mp4|wav|png)$/i.test(p)
const root = (): string => mkdtempSync(path.join(tmpdir(), 'snipp-portable-'))

test('locateMedia: the absolute path, then relPath, then <project>\\media\\<name>, then <project>\\<name>; only media', async () => {
  const r = root()
  const proj = path.join(r, 'proj')
  mkdirSync(path.join(proj, 'media'), { recursive: true })
  mkdirSync(path.join(r, 'shared'))
  writeFileSync(path.join(proj, 'media', 'a.mp4'), 'a')
  writeFileSync(path.join(proj, 'b.wav'), 'bb')
  writeFileSync(path.join(r, 'shared', 'c.png'), 'ccc')
  writeFileSync(path.join(r, 'secret.txt'), 'no')
  const file = path.join(proj, 'p.snipp')
  const gone = 'Z:\\nowhere\\'
  assert.equal((await locateMedia({ path: path.join(proj, 'media', 'a.mp4') }, null, { accept: isMedia }))?.path, path.join(proj, 'media', 'a.mp4'), 'where it was')
  assert.equal((await locateMedia({ path: `${gone}x\\c.png`, relPath: '../shared/c.png' }, file, { accept: isMedia }))?.path, path.join(r, 'shared', 'c.png'), 'by relPath, outside the folder too')
  assert.equal((await locateMedia({ path: `${gone}a.mp4`, size: 1 }, file, { accept: isMedia }))?.path, path.join(proj, 'media', 'a.mp4'), 'media\\<name> (its stored size confirms it)')
  assert.equal((await locateMedia({ path: `${gone}b.wav`, size: 2 }, file, { accept: isMedia }))?.path, path.join(proj, 'b.wav'), '<name>')
  const found = await locateMedia({ path: `${gone}b.wav`, size: 2 }, file, { accept: isMedia })
  assert.equal(found?.size, 2)
  assert.equal(typeof found?.mtime, 'number', 'with its fingerprint')
  assert.equal(await locateMedia({ path: `${gone}x.mp4`, relPath: '../secret.txt' }, file, { accept: isMedia }), null, 'not a media file: not looked at')
  assert.equal(await locateMedia({ path: `${gone}a.mp4` }, null, { accept: isMedia }), null, 'no project file: the absolute path only')
  assert.equal(await locateMedia({ path: '\\\\server\\share\\a.mp4' }, file, { accept: isMedia }), null, 'a network path is not looked at, nor its name')
})

test('a moved folder with Turkish letters and a path longer than 260 characters', async () => {
  const r = root()
  let deep = path.join(r, 'Çekim ğüşıöç İŞĞ')
  while (deep.length < 300) deep = path.join(deep, 'çok uzun bir klasör adı ğüşiöç')
  const proj = path.join(deep, 'Proje')
  mkdirSync(path.join(proj, 'media'), { recursive: true })
  const media = path.join(proj, 'media', 'konuşma çekimi.mp4')
  writeFileSync(media, 'video')
  const file = path.join(proj, 'film.snipp')
  assert.ok(media.length > 260, `a long path (${media.length})`)
  assert.equal(relativeMediaPath(media, file), 'media/konuşma çekimi.mp4')
  assert.equal((await locateMedia({ path: media }, file, { accept: isMedia }))?.path, media, 'found where it is')
  // Moved: the whole folder elsewhere, the original renamed away.
  const moved = path.join(r, 'taşındı', 'Proje')
  cpSync(proj, moved, { recursive: true })
  renameSync(proj, `${proj}-eski`)
  const found = await locateMedia({ path: media, relPath: 'media/konuşma çekimi.mp4' }, path.join(moved, 'film.snipp'), { accept: isMedia })
  assert.equal(found?.path, path.join(moved, 'media', 'konuşma çekimi.mp4'))
})

test('withRelativePaths: written beside every absolute path; none for another drive; a stale one removed; other text untouched', () => {
  const json = JSON.stringify({ version: 1, assets: [
    { id: 'a', path: 'D:\\Film\\proj\\media\\a.mp4' },
    { id: 'b', path: 'D:\\Film\\shared\\b.wav' },
    { id: 'c', path: 'E:\\other\\c.png', relPath: 'old/c.png' },
    { id: 'd', kind: 'code', path: 'D:\\Film\\proj\\films\\intro' }
  ] }, null, 2)
  const out = JSON.parse(withRelativePaths(json, 'D:\\Film\\proj\\film.snipp'))
  assert.deepEqual(out.assets.map((a: { relPath?: string }) => a.relPath ?? null), ['media/a.mp4', '../shared/b.wav', null, 'films/intro'])
  assert.equal(withRelativePaths('not json', 'D:\\x.snipp'), 'not json')
  assert.equal(withRelativePaths('{"a":1}', 'D:\\x.snipp'), '{"a":1}')
})

test('findInFolder: only plain file names, only media', async () => {
  const r = root()
  writeFileSync(path.join(r, 'a.mp4'), 'a')
  writeFileSync(path.join(r, 'b.txt'), 'b')
  const found = await findInFolder(r, ['a.mp4', 'b.txt', '..\\a.mp4', 'missing.mp4', 42], { accept: isMedia })
  assert.deepEqual(Object.keys(found), ['a.mp4'])
})

/** A main process for the open: the project file read, its media found by
 *  the real locateMedia (as media.ts resolveProjectMedia does). */
function mainOpening(): void {
  stubApi({
    setCurrentProjectPath: () => {},
    openProjectPath: async (f: string) => {
      const json = readFileSync(f, 'utf8')
      const resolved: Record<string, unknown> = {}
      for (const a of JSON.parse(json).assets as Asset[]) {
        if (!a.path) continue
        const found = await locateMedia(a, f, { accept: isMedia })
        resolved[a.path] = found ? { url: `media://local/${encodeURIComponent(found.path)}`, size: found.size, mtime: found.mtime, path: found.path, via: found.via } : null
      }
      return { json, path: f, resolved }
    }
  })
}

test('P9: a project folder moved whole opens with 0 missing media, its assets pointing where they are now', async () => {
  resetWorld()
  const r = root()
  const proj = path.join(r, 'Proje Çekim')
  mkdirSync(path.join(proj, 'media'), { recursive: true })
  const p = fixture()
  for (const a of p.assets) {
    const f = path.join(proj, 'media', `${a.id}.${a.kind === 'audio' ? 'wav' : a.kind === 'image' ? 'png' : 'mp4'}`)
    writeFileSync(f, a.id)
    a.path = f
    a.size = a.id.length // (as imported: the file's size)
  }
  const file = path.join(proj, 'film.snipp')
  // Saved as main writes it: with the relative paths.
  writeFileSync(file, withRelativePaths(serializeProject(p), file))
  const moved = path.join(r, 'başka disk', 'Proje Çekim')
  cpSync(proj, moved, { recursive: true })
  renameSync(proj, `${proj} (silindi)`)
  mainOpening()
  const opened = await openProjectByPath(path.join(moved, 'film.snipp'))
  assert.ok(opened)
  assert.deepEqual(opened.missing, [], '0 missing media')
  for (const a of opened.project.assets) assert.ok(a.path!.startsWith(moved), `${a.id} points into the moved folder`)
  setLastProjectPath(null)
})

test('relink: found one, the rest are looked for in the same folder (read and kind-checked each)', async () => {
  resetWorld()
  const p = fixture()
  for (const a of p.assets) Object.assign(a, { url: '', missing: true, path: `C:\\gone\\${a.id}.bin` })
  useStore.getState().loadProject(p)
  const asked: string[][] = []
  const find = async (picked: string, names: string[]): Promise<PickedFile[]> => {
    asked.push(names)
    // (Phase 11b, A5: of the size the project recorded, 1000, as the
    // opening's own search asks.)
    return names.filter((n) => n !== 'img3.bin').map((n) => ({ url: `media://${n}`, name: n, path: path.win32.join(path.win32.dirname(picked), n), size: 1000, mtime: 2 }))
  }
  const kinds: Record<string, Asset['kind']> = Object.fromEntries(p.assets.map((a) => [`${a.id}.bin`, a.kind]))
  kinds['img2.bin'] = 'video' // the file there now is another kind
  const deps: RelinkDeps = { drop: () => {}, probe: async (f) => ({ id: 'x', name: f.name, url: f.url, size: 1, duration: 100, width: 10, height: 10, hasAudio: true, kind: kinds[f.name] }) as Asset }
  const n = await relinkTheRest({ url: '', name: 'vid1.bin', path: 'D:\\found\\vid1.bin', size: 1 }, find, deps)
  assert.equal(asked.length, 1)
  assert.deepEqual(asked[0].sort(), p.assets.map((a) => `${a.id}.bin`).sort())
  assert.equal(n, 4, 'all but img3 (not there) and img2 (another kind)')
  const st = useStore.getState().project
  assert.deepEqual(st.assets.filter((a) => a.missing).map((a) => a.id).sort(), ['img2', 'img3'])
  assert.equal(st.assets.find((a) => a.id === 'vid2')!.path, 'D:\\found\\vid2.bin')
})

test('relink (11b, A5): a file of the same name but not the recorded size is other footage: left missing', async () => {
  resetWorld()
  const p = fixture()
  for (const a of p.assets) Object.assign(a, { url: '', missing: true, path: `C:\\card1\\${a.id}.bin` })
  useStore.getState().loadProject(p)
  // Another card's folder: the same names; vid2 and aud1 of other sizes.
  const sizes: Record<string, number> = { 'vid2.bin': 2048, 'aud1.bin': 999 }
  const find = async (picked: string, names: string[]): Promise<PickedFile[]> => names.map((n) => ({ url: `media://${n}`, name: n, path: path.win32.join(path.win32.dirname(picked), n), size: sizes[n] ?? 1000, mtime: 2 }))
  const kinds: Record<string, Asset['kind']> = Object.fromEntries(p.assets.map((a) => [`${a.id}.bin`, a.kind]))
  const deps: RelinkDeps = { drop: () => {}, probe: async (f) => ({ id: 'x', name: f.name, url: f.url, size: f.size, duration: 100, width: 10, height: 10, hasAudio: true, kind: kinds[f.name] }) as Asset }
  const n = await relinkTheRest({ url: '', name: 'vid1.bin', path: 'D:\\card2\\vid1.bin', size: 1000 }, find, deps)
  assert.equal(n, p.assets.length - 2)
  assert.deepEqual(useStore.getState().project.assets.filter((a) => a.missing).map((a) => a.id).sort(), ['aud1', 'vid2'])
})

test('a project FILE at a path longer than 260 characters, with Turkish letters: written whole, its media relative to it', async () => {
  const { writeFileAtomic } = await import('../main/safe-write')
  const r = root()
  let deep = path.join(r, 'Müşteri Çekimleri İŞĞ')
  while (deep.length < 280) deep = path.join(deep, 'ğüşiöç uzun klasör')
  mkdirSync(path.join(deep, 'media'), { recursive: true })
  const file = path.join(deep, 'Uzun Proje Adı ğüşiöç.snipp')
  const media = path.join(deep, 'media', 'çekim.mp4')
  writeFileSync(media, 'v')
  const json = JSON.stringify({ version: 1, assets: [{ id: 'a', kind: 'video', path: media }] }, null, 2)
  await writeFileAtomic(file, withRelativePaths(json, file))
  assert.ok(file.length > 260, `a long path (${file.length})`)
  const back = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(back.assets[0].relPath, 'media/çekim.mp4')
  assert.equal((await locateMedia(back.assets[0], file, { accept: isMedia }))?.path, media)
})

// == Ç2a patch, item 1 (auditor probe AUDIT 1 / AUDIT 3): a file found only
// by its name (or by relPath) beside the project replaces a missing one only
// when the stored size confirms it. ==

/** A memory card no longer plugged in, a folder that is gone. */
const CARD = 'Q:\\card1\\C0001.MP4'
const GONE = 'Q:\\gone\\vid1.mp4'

/** A project file in `dir` whose vid1 is at `vid1Path` with `vid1` stored;
 *  vid2 lives at a real path of its own. Opened through the stand-in main
 *  (the real locateMedia on the real disk). */
async function openBeside(dir: string, vid1Path: string, vid1: Partial<Asset>) {
  resetWorld()
  const p = fixture()
  Object.assign(p.assets.find((a) => a.id === 'vid1')!, { path: vid1Path, ...vid1 })
  const v2 = path.join(dir, 'keep', 'vid2.mp4')
  mkdirSync(path.dirname(v2), { recursive: true })
  writeFileSync(v2, 'x'.repeat(10))
  Object.assign(p.assets.find((a) => a.id === 'vid2')!, { path: v2, size: 10 })
  const file = path.join(dir, 'p.snipp')
  writeFileSync(file, JSON.stringify(p))
  mainOpening()
  const r = await openProjectByPath(file)
  setLastProjectPath(null)
  assert.ok(r)
  return { r, a: r.project.assets.find((x) => x.id === 'vid1')! }
}

test('Ç2a patch 1: an unrelated same-named file beside the project is not taken: the asset stays missing at its own path, and a save writes that path', async () => {
  const dir = root()
  const wrong = path.join(dir, 'C0001.MP4')
  writeFileSync(wrong, 'y'.repeat(777)) // another take, another card
  const { r, a } = await openBeside(dir, CARD, { size: 5_000_000, mtime: 1_600_000_000_000, duration: 60 })
  assert.equal(a.missing, true, 'missing (the relink button shows)')
  assert.equal(a.path, CARD, 'its own path')
  assert.ok(r.missing.includes(a.name))
  assert.deepEqual(r.changed, [])
  assert.equal(JSON.parse(serializeProject(r.project)).assets.find((x: Asset) => x.id === 'vid1').path, CARD, 'a save writes the original path')
  // media\<name> of another size: not taken either.
  const dir2 = root()
  mkdirSync(path.join(dir2, 'media'))
  writeFileSync(path.join(dir2, 'media', 'vid1.mp4'), 'z'.repeat(333))
  const two = await openBeside(dir2, GONE, { size: 5_000, duration: 60 })
  assert.equal(two.a.missing, true)
  assert.equal(two.a.path, GONE)
})

test('Ç2a patch 1: a same-named file of the stored size is taken (mtime may differ: zip, FAT); one of another size before it is passed over', async () => {
  const dir = root()
  mkdirSync(path.join(dir, 'media'))
  writeFileSync(path.join(dir, 'media', 'vid1.mp4'), 'w'.repeat(12)) // same name, other size
  writeFileSync(path.join(dir, 'vid1.mp4'), 'v'.repeat(40)) // the file
  const { r, a } = await openBeside(dir, GONE, { size: 40, mtime: 1_600_000_000_000, duration: 60 })
  assert.equal(a.missing, false)
  assert.equal(a.path, path.join(dir, 'vid1.mp4'))
  assert.ok(!r.missing.includes(a.name))
})

test('Ç2a patch 1: no stored size: a name-only match is not taken; a relPath match is (a moved folder), and is counted for the open message', async () => {
  const dir = root()
  writeFileSync(path.join(dir, 'vid1.mp4'), 'w'.repeat(10))
  const { r, a } = await openBeside(dir, GONE, { size: undefined, mtime: undefined, duration: 60 })
  assert.equal(a.missing, true, 'name only, nothing to confirm it: missing')
  assert.equal(a.path, GONE)
  assert.deepEqual(r.unconfirmed, [])
  const dir2 = root()
  mkdirSync(path.join(dir2, 'clips'))
  writeFileSync(path.join(dir2, 'clips', 'vid1.mp4'), 'w'.repeat(10))
  const two = await openBeside(dir2, GONE, { size: undefined, relPath: 'clips/vid1.mp4', duration: 60 })
  assert.equal(two.a.missing, false, 'by relPath: taken')
  assert.equal(two.a.path, path.join(dir2, 'clips', 'vid1.mp4'))
  assert.deepEqual(two.r.unconfirmed, [two.a.name], 'counted in the open message')
  // relPath with a stored size that differs: not taken.
  const three = await openBeside(dir2, GONE, { size: 999, relPath: 'clips/vid1.mp4', duration: 60 })
  assert.equal(three.a.missing, true)
  assert.equal(three.a.path, GONE)
})
