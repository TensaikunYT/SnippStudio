// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The path layer (SnippStudio phase 10a, step 1; haritalar\cekirdek-platform.md
// P1–P6 and §5.1): tables for Windows, macOS and Linux, run on Windows by
// naming the platform; recents-store.ts's own copy of the rule agrees with it;
// the Linux twins of the recents and code film cases. Windows' answers are the
// ones the code gave before the layer (decision 1).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { currentPlatform, foldKey, isInside, isLocalFilePath, pathApi, pathKey, setPlatformForTests, type Platform } from '../main/platform-path'
import { cleanRecent, isLocalFilePath as recentsLocal, mergeRecents, pathRoot, recentKey, removeRecentPath, renameRecentPath, setRecentsPlatformForTests, type RecentRecord } from '../main/recents-store'
import { filmPathFor, FilmRegistry, isInside as filmInside } from '../main/codefilm'
import { relativeMediaPath } from '../main/project-media'
import { codeFilmMix } from '../renderer/src/state/store'
import { defaultProject, type Asset } from '../renderer/src/types'

const ALL: Platform[] = ['win32', 'darwin', 'linux']

/** Runs `fn` with every path rule set to `p`, then back to this computer's. */
function as<T>(p: Platform, fn: () => T): T {
  setPlatformForTests(p)
  setRecentsPlatformForTests(p)
  try {
    return fn()
  } finally {
    setPlatformForTests(null)
    setRecentsPlatformForTests(null)
  }
}

test('the platform is this computer\'s unless a test names one', () => {
  assert.equal(currentPlatform(), process.platform)
  as('linux', () => assert.equal(currentPlatform(), 'linux'))
  assert.equal(currentPlatform(), process.platform)
  assert.equal(pathApi('win32').sep, '\\')
  assert.equal(pathApi('darwin').sep, '/')
  assert.equal(pathApi('linux').sep, '/')
})

test('a local file path, per platform (§5.1)', () => {
  const table: [unknown, boolean, boolean, boolean][] = [
    // value                          win32  darwin linux
    ['C:\\x.snipp', true, false, false],
    ['c:/Users/u/x.snipp', true, false, false],
    ['/Users/a/x.snipp', false, true, true],
    ['/home/a/x.snipp', false, true, true],
    ['\\\\server\\share\\x.snipp', false, false, false],
    ['//server/share/x.snipp', false, false, false],
    ['\\\\?\\C:\\x', false, false, false],
    ['C:\\x.snipp:stream', false, false, false],
    ['C:\\con\\x', false, false, false],
    ['C:\\nul.txt', false, false, false],
    ['/dev/null', false, false, false],
    ['/proc/self/environ', false, false, false],
    ['/sys/x', false, false, false],
    ['/devices/x.mp4', false, true, true],
    ['relative.snipp', false, false, false],
    ['', false, false, false],
    ['/a\u0000b', false, false, false],
    ['/a\nb', false, false, false],
    ['/' + 'a'.repeat(4096), false, false, false],
    [42, false, false, false]
  ]
  for (const [v, w, d, l] of table) {
    assert.equal(isLocalFilePath(v, 'win32'), w, `win32 ${String(v).slice(0, 40)}`)
    assert.equal(isLocalFilePath(v, 'darwin'), d, `darwin ${String(v).slice(0, 40)}`)
    assert.equal(isLocalFilePath(v, 'linux'), l, `linux ${String(v).slice(0, 40)}`)
    // recents-store.ts's own copy says the same.
    for (const p of ALL) assert.equal(recentsLocal(v, p), isLocalFilePath(v, p), `${p} copy ${String(v).slice(0, 40)}`)
  }
  assert.equal(isLocalFilePath('/Users/a/x.snipp', 'darwin'), true)
  assert.equal(isLocalFilePath('C:\\x', 'linux'), false)
})

test('keys: Windows folds case (as before), macOS composes Unicode, Linux keeps the string', () => {
  // Windows: exactly what the code did (toLowerCase; normalize + toLowerCase).
  for (const p of ['C:\\A\\Film.snipp', 'c:/a/FILM.snipp', 'C:\\a\\..\\b\\X.mp4']) {
    assert.equal(foldKey(p, 'win32'), p.toLowerCase())
    assert.equal(pathKey(p, 'win32'), pathApi('win32').normalize(p).toLowerCase())
  }
  assert.equal(pathKey('C:/Users/A/Film.snipp', 'win32'), pathKey('c:\\users\\a\\FILM.snipp', 'win32'))
  assert.notEqual(pathKey('/a/B.mp4', 'linux'), pathKey('/a/b.mp4', 'linux'))
  assert.equal(pathKey('/a//b/../c.mp4', 'linux'), '/a/c.mp4')
  // macOS: é written two ways is one name; case is kept.
  assert.equal(pathKey('/a/caf\u0065\u0301.mp4', 'darwin'), pathKey('/a/caf\u00e9.mp4', 'darwin'))
  assert.notEqual(pathKey('/a/B.mp4', 'darwin'), pathKey('/a/b.mp4', 'darwin'))
  assert.equal(foldKey(undefined), undefined)
  assert.equal(foldKey(null, 'win32'), undefined)
})

test('inside a folder, per platform: no climbing out, no look-alike siblings', () => {
  assert.equal(isInside('C:\\Films\\f', 'C:\\Films\\F\\x.js', 'win32'), true)
  assert.equal(isInside('C:\\Films\\f', 'C:\\Films\\f2\\x.js', 'win32'), false)
  assert.equal(isInside('C:\\Films\\f\\', 'C:\\Films\\f', 'win32'), true)
  assert.equal(isInside('/films/f', '/films/f2/x', 'linux'), false)
  assert.equal(isInside('/films/f', '/films/f/x', 'linux'), true)
  assert.equal(isInside('/films/f', '/films/F/x', 'linux'), false)
  assert.equal(isInside('/films/f', '/films/f/../g/x', 'linux'), false)
  assert.equal(isInside('/films/f/', '/films/f', 'darwin'), true)
  assert.equal(isInside('/', '/anything', 'linux'), true)
})

test('code films: a snippfilm path stays inside its folder on every platform (Linux twin of codefilm.test)', () => {
  // Windows: the code film test's own cases (unchanged).
  assert.equal(filmPathFor('C:\\Films\\videohub', '/img/a.jpg', 'win32'), 'C:\\Films\\videohub\\img\\a.jpg')
  assert.equal(filmPathFor('C:\\Films\\videohub', '/a.txt:stream', 'win32'), null)
  assert.equal(filmPathFor('C:\\Films\\videohub', '/con', 'win32'), null)
  // Linux: the same cases with POSIX paths.
  const R = '/films/videohub'
  assert.equal(filmPathFor(R, '/', 'linux'), '/films/videohub/index.html')
  assert.equal(filmPathFor(R, '/img/notes/n01.jpg', 'linux'), '/films/videohub/img/notes/n01.jpg')
  assert.equal(filmPathFor(R + '/', '/fonts/a%20b.woff2', 'linux'), '/films/videohub/fonts/a b.woff2')
  for (const bad of ['/../secret.txt', '/img/../../x', '/%2e%2e/x', '/..%5Cx', '/a%00b', '/%E0%A4%A']) assert.equal(filmPathFor(R, bad, 'linux'), null, bad)
  // §5.1: filmPathFor('/films/f', '../etc', 'linux') === null
  assert.equal(filmPathFor('/films/f', '../etc', 'linux'), null)
  // A colon or "con" is a plain name there.
  assert.equal(filmPathFor(R, '/a:b.txt', 'linux'), '/films/videohub/a:b.txt')
  assert.equal(filmPathFor(R, '/con', 'linux'), '/films/videohub/con')
  as('linux', () => {
    assert.equal(filmInside(R, '/films/videohub2/x.js'), false)
    assert.equal(filmInside(R, '/films/VideoHub/x.js'), false, 'Linux is case-sensitive')
    assert.equal(filmInside(R, '/films/videohub/x.js'), true)
    const reg = new FilmRegistry()
    const id = reg.idFor(R)
    assert.equal(reg.idFor(R + '/'), id)
    assert.notEqual(reg.idFor('/films/VideoHub'), id, 'another folder on Linux')
    assert.equal(reg.root(id), R)
  })
})

const rec = (p: string, lastOpened: number, extra: Partial<RecentRecord> = {}): RecentRecord => ({
  path: p, name: p.split('/').pop()!.replace(/\.\w+$/, ''), durationSec: 10, width: 1920, height: 1080, lastOpened, sizeBytes: 0, ...extra
})

test('the Projects list on Linux (twin of recents.test)', () => {
  as('linux', () => {
    // One entry per file: slashes collapse, but case makes another file.
    assert.equal(recentKey('/home/a//Film.snipp'), recentKey('/home/a/Film.snipp'))
    assert.notEqual(recentKey('/home/a/Film.snipp'), recentKey('/home/a/film.snipp'))
    const list = mergeRecents([rec('/a/film.snipp', 1, { thumbnail: 'data:image/jpeg;base64,AA' })], [rec('/a//film.snipp', 5)])
    assert.equal(list.length, 1)
    assert.equal(list[0].lastOpened, 5)
    assert.equal(list[0].thumbnail, 'data:image/jpeg;base64,AA')
    assert.equal(mergeRecents([rec('/a/film.snipp', 1)], [rec('/a/FILM.snipp', 2)]).length, 2)
    // Touch, fill, remove, rename.
    const base = [rec('/p/a.snipp', 30), rec('/p/b.snipp', 20)]
    assert.deepEqual(mergeRecents(base, [rec('/p/b.snipp', 40)], 'touch').map((e) => e.path), ['/p/b.snipp', '/p/a.snipp'])
    const filled = mergeRecents(base, [rec('/p/c.snipp', 10)], 'fill')
    assert.deepEqual(removeRecentPath(filled, '/p/b.snipp').map((e) => e.path), ['/p/a.snipp', '/p/c.snipp'])
    assert.equal(removeRecentPath(filled, '/p/B.snipp').length, 3, 'another case is another file')
    assert.equal(renameRecentPath(filled, '/p/a.snipp', '/p/new name.snipp', 'new name')[0].path, '/p/new name.snipp')
    // An entry must be a local project path.
    for (const p of ['//server/share/x.snipp', 'relative.snipp', '/p/x.exe', 'C:\\x.snipp', '/dev/x.snipp', 42]) assert.equal(cleanRecent({ path: p }), null, String(p))
    const e = cleanRecent({ path: '/home/t//Film.snipp', name: '' })
    assert.equal(e?.path, '/home/t/Film.snipp')
    assert.equal(e?.name, 'Film')
    assert.equal(pathRoot('/home/t/Film.snipp'), '/')
  })
  // Windows: as it was.
  as('win32', () => {
    assert.equal(cleanRecent({ path: 'C:/Users/T/Film.snipp' })?.path, 'C:\\Users\\T\\Film.snipp')
    assert.equal(pathRoot('D:\\x\\y.snipp'), 'd:\\')
  })
})

test('media beside the project: relative on every platform; another drive only on Windows', () => {
  assert.equal(as('win32', () => relativeMediaPath('C:\\v\\media\\a.mp4', 'C:\\v\\p.snipp')), 'media/a.mp4')
  assert.equal(as('win32', () => relativeMediaPath('D:\\a.mp4', 'C:\\v\\p.snipp')), null)
  assert.equal(as('linux', () => relativeMediaPath('/home/u/v/media/a.mp4', '/home/u/v/p.snipp')), 'media/a.mp4')
  assert.equal(as('linux', () => relativeMediaPath('/mnt/b/a.mp4', '/home/u/v/p.snipp')), '../../../mnt/b/a.mp4')
})

test('a code film\'s sound is found by its path with either separator (P6)', () => {
  const p = defaultProject()
  const code = { id: 'c', kind: 'code', name: 'f', path: '/films/f', duration: 5 } as unknown as Asset
  const mix = { id: 'm', kind: 'audio', name: 'mix.wav', path: '/films/f/audio/mix.wav', duration: 5 } as unknown as Asset
  p.assets.push(code, mix)
  assert.equal(codeFilmMix(p, code)?.id, 'm')
  const win = { ...code, id: 'c2', path: 'C:\\Films\\f' } as Asset
  const winMix = { ...mix, id: 'm2', path: 'C:\\Films\\f\\audio\\mix.wav' } as Asset
  p.assets.push(win, winMix)
  assert.equal(codeFilmMix(p, win)?.id, 'm2')
})
