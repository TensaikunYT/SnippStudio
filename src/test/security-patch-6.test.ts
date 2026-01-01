// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 6 (S1, B-G7): which code film folders may run
// unasked. The rules on the real disk (trusted-folders.ts), the question's
// list in the page (security/trust.ts), and the places a folder must not be
// run from without them. The app itself: e2e `security-trusted-folder`.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cleanTrusted, filmTrust, TRUSTED_FILE, TRUSTED_MAX, TrustedFolders } from '../main/trusted-folders'
import { askToShow, folderKey, waitingAssets, type TrustAsk } from '../renderer/src/security/trust-rules'
import type { Asset } from '../renderer/src/types'

const SRC = path.join(__dirname, '..', '..', 'src')

function world(): { root: string; profile: string; proj: string; file: string; outside: string; film: (dir: string) => string } {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'snipp-g6-')))
  const profile = path.join(root, 'profile')
  const proj = path.join(root, 'kotu proje')
  const outside = path.join(root, 'Belgeler')
  for (const d of [profile, proj, outside]) mkdirSync(d)
  const file = path.join(proj, 'p.snipp')
  writeFileSync(file, '{}')
  const film = (dir: string): string => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html>')
    return dir
  }
  return { root, profile, proj, file, outside, film }
}

test('item 6: a folder strictly inside the project folder runs unasked; the project folder itself, its parent and any other folder do not', () => {
  const w = world()
  try {
    const none = new TrustedFolders(() => w.profile)
    assert.equal(filmTrust(w.film(path.join(w.proj, 'anim', 'intro')), w.file, none), 'project')
    assert.equal(filmTrust(w.film(path.join(w.proj, 'pages', 'a', 'b')), w.file, none), 'project')
    // The folder the project file lies in: a project dropped into a folder
    // must not turn the whole folder into its film.
    w.film(w.proj)
    assert.equal(filmTrust(w.proj, w.file, none), null)
    // Its parent (the layout --code-film makes: <film>\snipp\<film>.snipp).
    assert.equal(filmTrust(w.film(w.root), w.file, none), null)
    // A folder elsewhere, a sibling that starts with the same letters.
    assert.equal(filmTrust(w.film(w.outside), w.file, none), null)
    assert.equal(filmTrust(w.film(w.proj + ' 2'), w.file, none), null)
    // No project file (not saved yet), a folder that is not there.
    assert.equal(filmTrust(path.join(w.proj, 'anim', 'intro'), null, none), null)
    assert.equal(filmTrust(path.join(w.proj, 'anim', 'none'), w.file, none), null)
    // A project file in the home folder (or a drive's root) makes nothing its own.
    assert.equal(filmTrust(path.join(w.proj, 'anim', 'intro'), w.file, none, w.proj), null)
  } finally {
    rmSync(w.root, { recursive: true, force: true })
  }
})

test('item 6: a link inside the project folder that leads elsewhere is "elsewhere"', () => {
  const w = world()
  try {
    const none = new TrustedFolders(() => w.profile)
    w.film(w.outside)
    mkdirSync(path.join(w.proj, 'anim'))
    symlinkSync(w.outside, path.join(w.proj, 'anim', 'link'), 'junction')
    assert.equal(filmTrust(path.join(w.proj, 'anim', 'link'), w.file, none), null)
    // And a link that stays inside is the project's own.
    const real = w.film(path.join(w.proj, 'pages', 'x'))
    symlinkSync(real, path.join(w.proj, 'anim', 'in'), 'junction')
    assert.equal(filmTrust(path.join(w.proj, 'anim', 'in'), w.file, none), 'project')
  } finally {
    rmSync(w.root, { recursive: true, force: true })
  }
})

test('item 6: the trusted list: kept in the profile, a folder and what is inside it, read back clean and bounded', () => {
  const w = world()
  try {
    const list = new TrustedFolders(() => w.profile)
    w.film(w.outside)
    assert.equal(list.has(w.outside), false)
    assert.equal(existsSync(path.join(w.profile, TRUSTED_FILE)), false, 'nothing written until something is trusted')
    assert.equal(list.add(w.outside), true)
    assert.equal(list.has(w.outside), true)
    assert.equal(list.has(w.film(path.join(w.outside, 'alt', 'film'))), true, 'what is inside a trusted folder')
    assert.equal(list.has(w.root), false, 'not its parent')
    assert.equal(list.has(w.proj), false)
    assert.equal(list.add(path.join(w.root, 'yok')), false, 'a folder that is not there')
    assert.equal(list.add(w.outside), true)
    assert.deepEqual(list.all(), [w.outside], 'once')
    // Another run of the app reads the same list; the project rule then says 'list'.
    const again = new TrustedFolders(() => w.profile)
    assert.deepEqual(again.all(), [w.outside])
    assert.equal(filmTrust(w.outside, w.file, again), 'list')
    assert.deepEqual(JSON.parse(readFileSync(path.join(w.profile, TRUSTED_FILE), 'utf8')), { folders: [w.outside] })
    // A linked folder is trusted as the folder it leads to.
    symlinkSync(w.outside, path.join(w.root, 'kisayol'), 'junction')
    assert.equal(again.has(path.join(w.root, 'kisayol')), true)
    // A damaged or hostile file: only local folder paths are taken.
    assert.deepEqual(cleanTrusted({ folders: ['C:\\a', 'C:\\a', 'c:/A', '\\\\server\\share', 'relative', 5, null, 'C:\\b\\CONIN$', 'C:\\ok'] }).map((x) => x.toLowerCase()), process.platform === 'win32' ? ['c:\\a', 'c:\\ok'] : [])
    assert.deepEqual(cleanTrusted('nonsense'), [])
    assert.deepEqual(cleanTrusted(null), [])
    writeFileSync(path.join(w.profile, TRUSTED_FILE), '{ not json')
    assert.deepEqual(new TrustedFolders(() => w.profile).all(), [])
    if (process.platform === 'win32') assert.equal(cleanTrusted(Array.from({ length: TRUSTED_MAX + 50 }, (_, i) => `C:\\f\\${i}`)).length, TRUSTED_MAX)
  } finally {
    rmSync(w.root, { recursive: true, force: true })
  }
})

const asset = (id: string, p: string, missing = true): Asset => ({ id, kind: 'code', name: id, path: p, url: missing ? '' : 'snippfilm://0123456789abcdef/', duration: 4, width: 16, height: 9, hasAudio: false, missing } as unknown as Asset)

test('item 6: the question shown: the open project\'s waiting clips, or a folder the app was started for', () => {
  const asks: TrustAsk[] = [{ folder: 'D:\\Elsewhere\\Film', why: 'project' }, { folder: 'D:\\Other', why: 'project' }]
  assert.equal(folderKey('D:\\Elsewhere\\Film\\'), folderKey('d:/elsewhere/film'))
  // Nothing of the open project waits for these folders: no question (a project only offered).
  assert.equal(askToShow(asks, [asset('x', 'D:\\Mine')]), null)
  // A clip of the open project waits: asked, however its path is written.
  assert.equal(askToShow(asks, [asset('a', 'd:/elsewhere/film')])?.folder, 'D:\\Elsewhere\\Film')
  assert.deepEqual(waitingAssets([asset('a', 'd:/elsewhere/film'), asset('b', 'D:\\Elsewhere\\Film2')], 'D:\\Elsewhere\\Film').map((a) => a.id), ['a'])
  // Once its film runs (not missing), nothing is asked.
  assert.equal(askToShow(asks, [asset('a', 'D:\\Elsewhere\\Film', false)]), null)
  // A launch for a folder is asked with no project at all.
  assert.equal(askToShow([{ folder: 'D:\\L', why: 'launch' }], [])?.why, 'launch')
})

test('item 6: a project\'s folder is run only after the trust check, and the page can answer only for a folder it was asked about', () => {
  const media = readFileSync(path.join(SRC, 'main', 'media.ts'), 'utf8')
  // In resolveProjectMedia the check stands before the film is registered.
  const fn = media.slice(media.indexOf('export async function resolveProjectMedia'))
  assert.ok(fn.indexOf('filmMayRun(folder, projectFile)') > 0 && fn.indexOf('filmMayRun(folder, projectFile)') < fn.indexOf('codeFilmAt(a.path)'))
  const ipc = readFileSync(path.join(SRC, 'main', 'ipc', 'media-ipc.ts'), 'utf8')
  const pending = ipc.slice(ipc.indexOf("ipcMain.handle('codefilm:pending'"))
  assert.ok(pending.indexOf('filmMayRun(pending.folder, pending.project)') > 0 && pending.indexOf('filmMayRun(pending.folder, pending.project)') < pending.indexOf('codeFilmAt(pending.folder)'), '--code-film asks before it registers or makes a folder')
  assert.ok(pending.indexOf('askTrust(') < pending.indexOf('fs.mkdir('))
  const trust = ipc.slice(ipc.indexOf("ipcMain.handle('codefilm:trust'"), ipc.indexOf("ipcMain.handle('codefilm:trust'") + 400)
  assert.match(trust, /answerTrust\(event\.sender, raw, run === true\)[\s\S]*if \(!folder\) return null[\s\S]*codeFilmAt\(folder\)/)
  // The product never answers for the user: only a test run does.
  const hooks = readFileSync(path.join(SRC, 'main', 'e2e-hooks.ts'), 'utf8')
  assert.match(hooks, /export function e2eTrustAnswer\(folder: string\): 'run' \| null \{\s*if \(!e2eMode\(\)/)
})
