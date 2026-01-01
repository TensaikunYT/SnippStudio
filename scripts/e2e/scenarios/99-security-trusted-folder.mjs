// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 6 (S1, B-G7): a project file (or a launch with
// --code-film) cannot make a folder of the user's run as a code clip unasked.
// The app is started with --e2e-trust=ask, so the question is the product's
// own (every other scenario's test profile answers "run" by itself).
//
//  A. A folder the user adds by hand (the folder dialog) is trusted: saved,
//     closed and opened again in the same profile, its clip runs, unasked.
//  B. The same project on another profile (another computer): the clip of the
//     folder outside the project does NOT run and nothing of that folder is
//     asked for; the clip of a folder inside the project runs. "Don't run"
//     leaves it so; opened again, "Run the code in this folder" starts it and
//     the folder joins the profile's list; opened a third time, no question.
//  C. A project file lying in a film folder itself: that folder is asked about.
//  D. --code-film=<folder>: asked before anything is written into the folder;
//     "Don't run" leaves the folder untouched, "Run" brings the film in.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
export const name = 'security-trusted-folder'
export const timeoutMs = 300_000
export const freshWindow = true

const ASK = ['--e2e-trust=ask']
const filmState = (c, id) => c.run(async (id) => {
  const [films] = await window.__codeFilm()
  const a = window.__store.getState().project.assets.find((x) => x.id === id)
  if (a && a.url) films.codeFilms.ensure(a)
  return { url: a?.url ?? null, missing: !!a?.missing, state: films.codeFilms.status(id)?.state ?? null, live: films.codeFilms.livePages() }
}, id)
const trusted = (profile) => { try { return JSON.parse(readFileSync(join(profile, 'trusted-folders.json'), 'utf8')).folders.map((f) => f.toLowerCase()) } catch { return [] } }
const open = async (app, lib, file, clips) => {
  const c = app.cdp
  lib.answer(app, { kind: 'open', paths: [file] })
  await c.click('topbar.file')
  await c.click('menu.file.open')
  await c.waitFor('the project opened', async () => (await c.st((s) => Object.keys(s.project.clips).length)) === clips, 15000)
}
const seen = (c) => c.ev(`window.api.testFilmProbe({ kind: 'web', since: 0 })`)

export async function run({ media, lib, work, relaunch }) {
  const { assert } = lib
  const outside = join(work, 'baska yer', 'film')
  const projDir = join(work, 'proje')
  const inside = join(projDir, 'anim', 'kendi')
  cpSync(media.film, outside, { recursive: true })
  cpSync(media.film, inside, { recursive: true })
  writeFileSync(join(outside, 'gizli.txt'), 'a private file beside the page')
  const file = join(projDir, 'p.snipp')
  try {
    // ---- A: brought in by hand: trusted, on this profile ---------------------
    let app = await relaunch({ extraArgs: ASK, own: true })
    let c = app.cdp
    // (22 Nov: a folder the PAGE names is not a folder the user brought in. By
    // its path, as text or as a File a script made: not registered, not trusted.
    // The folder dialog below and a real drop are the user's hand.)
    const named = await c.run(async (folder) => ({
      byPath: await window.api.codeFilm.register(folder),
      asText: await window.api.codeFilm.registerDropped(folder),
      made: await window.api.codeFilm.registerDropped(new File(['x'], 'film'))
    }), outside)
    assert.deepEqual(named, { byPath: null, asText: null, made: null }, 'the page cannot register a folder by naming it')
    assert.deepEqual(trusted(app.profile), [], 'and nothing became trusted')
    for (const folder of [outside, inside]) {
      const n = await c.st((s) => s.project.assets.filter((a) => a.kind === 'code').length)
      lib.answer(app, { kind: 'open', paths: [folder] })
      await lib.dockPage(c, 'code')
      await c.click('media.code-film')
      await c.waitFor('the film in the project', async () => (await c.st((s) => s.project.assets.filter((a) => a.kind === 'code').length)) === n + 1, 15000)
    }
    assert.equal(await c.has('trust.ask'), false, 'a folder chosen in the folder dialog is not asked about')
    const assets = await c.st((s) => s.project.assets.filter((a) => a.kind === 'code').map((a) => ({ id: a.id, path: a.path })))
    const out = assets.find((a) => a.path.toLowerCase() === outside.toLowerCase())
    const own = assets.find((a) => a.path.toLowerCase() === inside.toLowerCase())
    assert.ok(out && own)
    await c.run((ids) => { const s = window.__store.getState(); for (const id of ids) s.addToTimeline(id) }, [out.id, own.id])
    assert.ok(trusted(app.profile).includes(outside.toLowerCase()), 'the chosen folder is in the profile\'s list')
    lib.answer(app, { kind: 'save', path: file })
    await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
    await c.key('s', ['ctrl'])
    await c.waitFor('saved', async () => existsSync(file) && !(await c.st((s) => s.dirty)), 10000)
    // Opened again on the same profile: both run, nothing asked.
    app = await relaunch({ profile: app.profile, extraArgs: ASK })
    c = app.cdp
    await open(app, lib, file, 2)
    await c.waitFor('the trusted folder\'s film running', async () => (await filmState(c, out.id)).state === 'ready', 30000)
    assert.equal(await c.has('trust.ask'), false)

    // ---- B: the same project on a profile that never saw the folder ----------
    app = await relaunch({ extraArgs: ASK, own: true })
    c = app.cdp
    assert.deepEqual(trusted(app.profile), [])
    await open(app, lib, file, 2)
    await c.waitId('trust.ask')
    assert.equal((await c.ev(`document.querySelector('[data-testid="trust.ask.folder"]').textContent`)).toLowerCase(), outside.toLowerCase(), 'the question names the folder')
    let st = await filmState(c, out.id)
    assert.deepEqual({ url: st.url, missing: st.missing, state: st.state }, { url: '', missing: true, state: null }, 'the clip of the folder outside the project has no film')
    // The folder inside the project runs meanwhile, unasked.
    await c.waitFor('the project\'s own folder\'s film running', async () => (await filmState(c, own.id)).state === 'ready', 30000)
    const ownId = /^snippfilm:\/\/([a-f0-9]{16})/.exec((await filmState(c, own.id)).url)[1]
    const asked = (await seen(c)).filter((r) => /^snippfilm:/.test(r.url))
    assert.ok(asked.length > 0 && asked.every((r) => r.url.startsWith(`snippfilm://${ownId}/`)), 'only the project\'s own folder was asked for')
    assert.equal((await c.ev(`window.api.codeFilm.trust(${JSON.stringify(projDir)}, true)`)), null, 'the page cannot trust a folder it was not asked about')
    assert.deepEqual(trusted(app.profile), [])
    // "Don't run": the clip stays empty, nothing is trusted.
    await c.click('trust.ask.dont')
    await c.waitGone('trust.ask')
    await c.sleep(500)
    st = await filmState(c, out.id)
    assert.deepEqual({ url: st.url, missing: st.missing, state: st.state }, { url: '', missing: true, state: null })
    assert.deepEqual(trusted(app.profile), [])
    assert.equal(await c.st((s) => s.dirty), false, 'the answer is no edit')
    // Opened again: asked again; "Run" starts it and remembers the folder.
    await open(app, lib, file, 2)
    await c.waitId('trust.ask')
    await c.click('trust.ask.run')
    await c.waitGone('trust.ask')
    await c.waitFor('the allowed folder\'s film running', async () => (await filmState(c, out.id)).state === 'ready', 30000)
    assert.ok(trusted(app.profile).includes(outside.toLowerCase()))
    assert.equal(await c.st((s) => s.dirty), false)
    // A third time: no question.
    await open(app, lib, file, 2)
    await c.waitFor('running, unasked', async () => (await filmState(c, out.id)).state === 'ready', 30000)
    assert.equal(await c.has('trust.ask'), false)

    // ---- C: a project file lying in a film folder itself ----------------------
    const selfDir = join(work, 'indirilenler')
    cpSync(media.film, selfDir, { recursive: true })
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    const selfFile = join(selfDir, 'gelen.snipp')
    const a = saved.assets.find((x) => x.id === out.id)
    writeFileSync(selfFile, JSON.stringify({ ...saved, name: 'gelen', uid: undefined, assets: [{ ...a, path: selfDir }], clips: Object.fromEntries(Object.entries(saved.clips).filter(([, cl]) => cl.assetId === out.id)), tracks: saved.tracks.map((t) => ({ ...t, clipIds: t.clipIds.filter((id) => saved.clips[id].assetId === out.id) })) }))
    await open(app, lib, selfFile, 1)
    await c.waitId('trust.ask')
    assert.equal((await c.ev(`document.querySelector('[data-testid="trust.ask.folder"]').textContent`)).toLowerCase(), selfDir.toLowerCase())
    await c.click('trust.ask.dont')
    await c.waitGone('trust.ask')

    // ---- D: --code-film=<folder> from another program -------------------------
    const launched = join(work, 'baska programdan')
    cpSync(media.film, launched, { recursive: true })
    const before = readdirSync(launched).sort()
    app = await relaunch({ extraArgs: [...ASK, `--code-film=${launched}`], own: true })
    c = app.cdp
    await c.waitId('trust.ask')
    assert.equal((await c.ev(`document.querySelector('[data-testid="trust.ask.folder"]').textContent`)).toLowerCase(), launched.toLowerCase())
    assert.deepEqual(readdirSync(launched).sort(), before, 'nothing written into the folder before the answer')
    assert.equal(await c.st((s) => s.project.assets.length), 0)
    await c.click('trust.ask.dont')
    await c.waitGone('trust.ask')
    await c.sleep(600)
    assert.deepEqual(readdirSync(launched).sort(), before, 'nor after "Don\'t run"')
    assert.equal(await c.st((s) => s.project.assets.length), 0)
    assert.deepEqual(trusted(app.profile), [])
    // Started for it again: "Run" brings the film in and its project is saved beside it.
    app = await relaunch({ extraArgs: [...ASK, `--code-film=${launched}`], own: true })
    c = app.cdp
    await c.waitId('trust.ask')
    await c.click('trust.ask.run')
    await c.waitGone('trust.ask')
    const film = await c.waitFor('the film brought in', () => c.st((s) => s.project.assets.find((x) => x.kind === 'code') ?? null), 20000)
    await c.waitFor('its project saved beside it', async () => existsSync(join(launched, 'snipp', `${basename(launched)}.snipp`)), 15000)
    await c.waitFor('the film running', async () => (await filmState(c, film.id)).state === 'ready', 30000)
    assert.ok(trusted(app.profile).includes(launched.toLowerCase()))
  } finally {
    // The next scenario gets a window that answers the question itself again.
    await relaunch({ own: true })
  }
}
