// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The interface audit patch, worker B (tarifler\YAMA-ARAYUZ.md "İşçi B"), in
// the real window: File → Language turns the top bar, the Inspector, the
// shell's own words and a window Turkish at once, and back (E1); Space presses
// a control the keyboard reached and plays after a click (E2); the Projects
// window keeps Tab inside and its card opens with a key (E6); the Shortcuts
// window has no English left in Turkish (E8); the filled button's ring reads
// at 3 : 1 (E10); one time form, the decimal comma (G6 / G7); the app's own
// question box (G9) and what deleting a file takes with it (G10); the export
// presets fit (item 9).
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

export const name = 'yama-ui-b-lang-shortcuts-projects-a11y'

/** The 4 px around a box, before and with the focus: the most contrasting
 *  colour of that band against its own ground, as a contrast ratio. */
async function ringRatio(c, sel) {
  const box = await c.run((s) => {
    const el = document.querySelector(s)
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, sel)
  const pad = 4
  const clip = { x: Math.max(0, Math.floor(box.x - pad)), y: Math.max(0, Math.floor(box.y - pad)), width: Math.ceil(box.w + 2 * pad), height: Math.ceil(box.h + 2 * pad), scale: 1 }
  await c.sleep(250)
  const r = await c.capture({ format: 'png', clip, captureBeyondViewport: false })
  return c.run(async (b64, pad) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob())
    const cv = new OffscreenCanvas(bmp.width, bmp.height)
    const g = cv.getContext('2d')
    g.drawImage(bmp, 0, 0)
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    const L = (i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2])
    const W = bmp.width, H = bmp.height
    const band = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!(x >= pad && y >= pad && x < W - pad && y < H - pad)) band.push(L((y * W + x) * 4))
    // The band's ground: its darkest common value (the surface behind).
    const sorted = [...band].sort((a, b) => a - b)
    const ground = sorted[Math.floor(sorted.length * 0.1)]
    const top = sorted[sorted.length - 1]
    return +((Math.max(top, ground) + 0.05) / (Math.min(top, ground) + 0.05)).toFixed(2)
  }, r.data, pad)
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const text = (id) => c.run((s) => document.querySelector(s)?.textContent?.trim() ?? null, `[data-testid="${id}"]`)
  const shift = async () => {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  }
  /** The focus put on an element the way the keyboard puts it (a key before
   *  it: ui/focus-origin.ts reads the last input). */
  const keyFocus = async (id) => {
    await c.key('Escape')
    await c.run((s) => { document.querySelector(s).focus(); return true }, `[data-testid="${id}"]`)
  }
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])

  try {
    // ---- E1: the language, from the File menu, at once and kept ---------------------
    assert.equal(await c.st((s) => s.uiLang), 'en', 'English by default')
    await c.click('topbar.file')
    await c.click('menu.file.lang-tr')
    // The menu stays open (a choice among two), now in Turkish.
    await c.waitFor('the menu in Turkish', async () => (await text('menu.file.lang-tr'))?.includes('Türkçe') && (await c.attr('menu.file.lang-tr', 'aria-checked')) === 'true')
    await c.key('Escape')
    assert.equal(await c.st((s) => s.uiLang), 'tr')
    assert.equal(await c.ev(`localStorage.getItem('snipp-ui-lang')`), 'tr', 'kept in the profile')
    assert.equal(await text('topbar.file'), 'Dosya', 'the top bar')
    assert.equal(await text('inspector.tab.clip'), 'Klip', 'the Inspector')
    assert.match(await c.attr('splitter.timeline', 'aria-label'), /^Çizelge yüksekliği/, "the shell's own words (App) at once, no reload")
    // A window: the shortcuts (Settings → Keyboard shortcuts), in Turkish with Turkish key names (E8).
    await c.click('topbar.file')
    await c.click('menu.file.shortcuts')
    await c.waitId('settings.keys')
    const keys = await c.run(() => {
      const box = document.querySelector('[data-testid="settings.keys"]')
      return { title: document.querySelector('[data-testid="settings.nav.keys"]').textContent, labels: [...box.querySelectorAll('.sc-label')].map((e) => e.textContent), keys: [...box.querySelectorAll('.sc-key')].map((e) => e.textContent) }
    })
    assert.equal(keys.title, 'Klavye kısayolları')
    const english = ['Play / Pause', 'Step back one frame', 'Split at playhead', 'Undo', 'Jump to next marker', 'Shuttle forward (L)']
    assert.deepEqual(keys.labels.filter((l) => english.includes(l)), [], 'no English action left')
    assert.ok(keys.keys.includes('Boşluk') && keys.keys.some((k) => k.includes('Sol ok')), `Turkish key names (${keys.keys.slice(0, 14).join(', ')})`)
    assert.equal(keys.keys.filter((k) => /\b(Space|Left|Right|Up|Down)\b/.test(k)).length, 0)
    console.log(`     Kısayollar (TR): ${keys.labels.length} eylem, örnek "${keys.labels[0]}" = ${keys.keys[0]}`)
    await c.click('settings.close')
    await c.waitGone('settings')

    // ---- G6 / G7: one time form, the decimal comma in Turkish -------------------------
    const clock = async () => c.run(() => document.querySelector('.timecode')?.textContent)
    await c.st((s) => s.setTime(4.6))
    await c.waitFor('the clock at 4.6 s', async () => (await clock()) === '0:04,60')
    const ticks = await c.run(() => [...document.querySelectorAll('.tl-tick.major')].map((e) => e.textContent).filter(Boolean))
    assert.ok(ticks.length > 3, `ruler labels (${ticks.join(' ')})`)
    for (const k of ticks) assert.match(k, /^\d+:\d\d(,\d\d)?$/, `ruler label ${k}: m:ss (never m:ss:ff)`)
    // The export presets fit, in Turkish (item 9), and the summary has commas.
    await c.click('topbar.export')
    await c.waitId('dialog.export')
    const fit = async () => c.run(() => [...document.querySelectorAll('.xw .ui-seg-part')].map((e) => ({ t: e.textContent, over: e.scrollWidth - e.clientWidth })))
    const trFit = await fit()
    assert.deepEqual(trFit.filter((x) => x.over > 0), [], `presets fit (TR): ${JSON.stringify(trFit)}`)
    const summary = await text('export.summary')
    assert.match(summary, /kare\/sn/)
    assert.equal(/\d\.\d/.test(summary.replace(/H\.264/g, '')), false, `no decimal point in Turkish: ${summary}`)
    await c.click('export.cancel')
    await c.waitGone('dialog.export')

    // ---- G9 / G10: the app's own question box, in the interface's language ----------------
    await c.ev('window.__e2eShowConfirms = true')
    // Two subtitles heard in the talk; how many a delete takes (the store's own
    // delete, undone) is what the question must name.
    const lost = await c.st((s, id) => {
      const clip = Object.values(s.project.clips).sort((a, b) => a.start - b.start)[0]
      const cue = (n, a, b) => ({ id: 'yb' + n, start: clip.start + a, end: clip.start + b, text: 'w' + n, words: [{ text: 'w' + n, start: clip.start + a, end: clip.start + b }] })
      s.setCaptions([cue(1, 0.5, 1.5), cue(2, 2, 3)])
      const before = window.__store.getState().project.captions.length
      window.__store.getState().deleteAsset(id)
      const after = window.__store.getState().project.captions.length
      window.__store.getState().undo()
      window.__store.getState().setDirty(false)
      return before - after
    }, talk.id)
    assert.equal(await c.st((s) => s.project.assets.length), 1, 'the dry run is undone')
    await c.click(`media.item.${talk.id}.remove`)
    await c.waitId('ask.confirm')
    const ask = await c.run(() => { const b = document.querySelector('[data-testid="ask.confirm"]'); return { title: b.querySelector('h2').textContent, body: b.querySelector('.ask-sub').textContent } })
    assert.match(ask.title, /projeden kaldırılsın mı\?$/, ask.title)
    assert.match(ask.body, /klibi de gider/, ask.body)
    assert.ok(lost > 0, 'the two subtitles go with the talk (subtitles/follow.ts)')
    if (lost > 0) assert.match(ask.body, new RegExp(`${lost > 1 ? lost + ' ' : ''}altyazı satırı da gider`), `the ${lost} subtitles are named: ${ask.body}`)
    else assert.equal(/altyazı/.test(ask.body), false, ask.body)
    await c.click('ask.confirm.cancel')
    await c.waitGone('ask.confirm')
    assert.equal(await c.st((s) => s.project.assets.length), 1, 'Vazgeç: nothing removed')
    console.log(`     medya silme sorusu (giden altyazı ${lost}): "${ask.title}" ${ask.body}`)
    // New project with unsaved work: asked in the app's box, Turkish.
    await c.st((s) => s.setDirty(true))
    await c.click('topbar.file')
    await c.click('menu.file.new-16x9')
    await c.waitId('ask.confirm')
    assert.equal(await c.run(() => document.querySelector('[data-testid="ask.confirm"] h2').textContent), 'Yeni proje başlatılsın mı?')
    assert.equal(await c.run(() => document.querySelector('[aria-modal="true"]') !== null), true, 'modal: the shortcuts stop behind it')
    await c.key('Escape')
    await c.waitGone('ask.confirm')
    assert.equal(await c.st((s) => Object.keys(s.project.clips).length), 1, 'Escape: the project stays')

    // ---- back to English from the same menu -------------------------------------------------
    await c.click('topbar.file')
    await c.click('menu.file.lang-en')
    await c.key('Escape')
    assert.equal(await text('topbar.file'), 'File')
    assert.equal(await text('inspector.tab.clip'), 'Clip')
    assert.match(await c.attr('splitter.timeline', 'aria-label'), /^Timeline height/)
    await c.waitFor('the clock in English', async () => (await clock()) === '0:04.60')
    await c.click('topbar.export')
    await c.waitId('dialog.export')
    const enFit = await fit()
    assert.deepEqual(enFit.filter((x) => x.over > 0), [], `presets fit (EN): ${JSON.stringify(enFit)}`)
    await c.click('export.cancel')
    await c.waitGone('dialog.export')
    await c.ev('window.__e2eShowConfirms = false')
    await c.st((s) => s.setDirty(false))

    // ---- E2: Space presses what the keyboard reached; after a click it plays ----------------
    await c.click('inspector.tab.clip')
    await keyFocus('inspector.tab.project')
    await c.key(' ')
    await c.sleep(150)
    assert.equal(await c.st((s) => s.playing), false, 'Space on a tab the keyboard reached: no playing')
    assert.equal(await c.attr('inspector.tab.project', 'aria-selected'), 'true', 'it chose that tab')
    assert.equal(await lib.focused(c), 'inspector.tab.project', 'and the focus stayed')
    await c.click('inspector.tab.clip')
    await c.key(' ')
    await c.waitFor('playing after a click and Space', () => c.st((s) => s.playing), 3000)
    assert.equal(await c.attr('inspector.tab.clip', 'aria-selected'), 'true')
    await c.st((s) => s.setPlaying(false))

    // ---- E10: the filled button's ring --------------------------------------------------------
    await c.run(() => { document.activeElement?.blur(); return true })
    await c.mouse('mouseMoved', 2, 1078)
    await keyFocus('topbar.export')
    await c.run(() => { for (const t of document.querySelectorAll('[role="tooltip"]')) t.style.visibility = 'hidden'; return true })
    const ring = await ringRatio(c, '[data-testid="topbar.export"]')
    assert.ok(ring >= 3, `the Export button's focus ring against the bar: ${ring} : 1 (was 1.71)`)
    console.log(`     dolu düğme halkası: ${ring} : 1`)
    await c.run(() => { document.activeElement?.blur(); return true })

    // ---- E6: the Projects window, modal for the keyboard -------------------------------------
    const work = mkdtempSync(join(tmpdir(), 'yama-ui-b-'))
    lib.answer(app, { kind: 'save', path: join(work, 'yama b.snipp') })
    await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
    await c.key('s', ['ctrl'])
    await c.waitFor('saved', async () => !(await c.st((s) => s.dirty)), 10000)
    await c.click('topbar.file')
    await c.click('menu.file.projects')
    await c.waitId('home.panel')
    assert.equal(await c.attr('home.panel', 'aria-modal'), 'true')
    await c.waitFor('the focus inside the window', () => c.run(() => !!document.activeElement?.closest('[data-testid="home.panel"]')))
    let outside = 0, card = false
    for (let i = 0; i < 40; i++) {
      await shift()
      const where = await c.run(() => ({ inside: !!document.activeElement?.closest('[data-testid="home.panel"]'), id: document.activeElement?.dataset?.testid ?? null }))
      if (!where.inside) outside++
      if (where.id === 'home.card.open') card = true
    }
    assert.equal(outside, 0, 'Tab never leaves the Projects window')
    assert.ok(card, 'a project card takes the focus')
    await c.key('Escape')
    await c.waitGone('home.panel')
    assert.equal(await lib.focused(c), 'topbar.file', 'the focus goes back to what opened it')
  } finally {
    await c.ev('window.__e2eShowConfirms = false').catch(() => undefined)
    await c.st((s) => { s.setUiLang('en'); s.setPlaying(false) }).catch(() => undefined)
  }
}
