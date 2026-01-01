// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The new interface (v3, tarifler\UI-YENI.md): the main screens in both
// languages at 1920 × 1080 and 1366 × 768, on real material (a film excerpt,
// stills, a voice-over), and no cut-off words on any of them. With
// SNIPP_UI3_SCREENS=<folder> the screens are kept as
// <folder>\<WxH>\<lang>\NN-*.png (tasarim\ekranlar\v3). SNIPP_UI3_ONLY=tr-1920
// (a language and a width) takes one of the four, for quick looks.
//   01 empty · 02 editor · 03 clip selected (Inspector Clip) · 04 the
//   timeline, close · 05 subtitles tab · 06 project tab · 07 templates ·
//   08 the File menu · 09 export window · 10 projects window · DENEME-1:
//   17 a narrow Inspector · 18 a look layer's Camera look · 19 Text ·
//   20 the left panel closed · 21 Settings, the agent page · the look tour
//   (GORUNUS-PLAN.md): 22 the Agent tab · 23 the silence window, and the
//   tour's seven rules counted on every screen (denetim.json beside them)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUBS, TESTDATA, VOICEOVER } from '../media.mjs'
import { gorunusAudit } from '../gorunus-audit.mjs'
export const name = 'ui3-screens'
export const timeoutMs = 10 * 60_000

const SIZES = [
  { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
  { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false }
]

/** In the page: visible buttons, tabs and segments whose words do not fit,
 *  and anything that runs past the window's right or bottom edge. */
function cutOff() {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    }
    return true
  }
  const out = []
  for (const el of document.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], [role="menuitemcheckbox"]')) {
    if (!vis(el)) continue
    const text = (el.textContent ?? '').trim()
    if (!text) continue
    const parts = [...el.querySelectorAll('.ui-btn-label, .ui-tab-label, .ui-seg-label, .ui-menu-label, .tb-label, .dock-cat-label, .ui-section-name, .ui-slider-label')].filter(vis)
    for (const p of parts.length ? parts : [el]) {
      if (p.scrollWidth > p.clientWidth + 1) out.push({ id: el.closest('[data-testid]')?.dataset.testid ?? '', text: (p.textContent ?? '').trim().slice(0, 40), scroll: p.scrollWidth, client: p.clientWidth })
    }
  }
  // Sideways only: under the emulated window size the document's scroll
  // height follows the real window's, not the page's (a panel's own scroll
  // area is not the page's).
  if (document.documentElement.scrollWidth > innerWidth + 1) {
    const past = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && r.right > innerWidth + 1) past.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}[${el.dataset?.testid ?? ''}] ${Math.round(r.right)}`)
    }
    out.push({ id: 'page', text: `the page scrolls sideways: ${past.slice(0, 4).join(' > ')}`, scroll: document.documentElement.scrollWidth, client: innerWidth })
  }
  return out
}

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  const dir = process.env.SNIPP_UI3_SCREENS || null
  const only = process.env.SNIPP_UI3_ONLY || null
  const found = []
  const audit = []
  try {
    for (const size of SIZES) {
      for (const lang of ['tr', 'en']) {
        if (only && only !== `${lang}-${size.width}`) continue
        await c.send('Emulation.setDeviceMetricsOverride', size)
        await shoot({ c, app, lib, work, lang, size, dir: dir ? join(dir, `${size.width}x${size.height}`, lang) : null, found, audit })
      }
    }
  } finally {
    // Back to the window every scenario starts in (cdp.mjs connect: 1920 × 1080).
    await c.send('Emulation.setDeviceMetricsOverride', SIZES[0])
    await c.run(() => { window.__store.getState().setUiLang('en'); return true })
    await lib.reset(c)
  }
  if (dir) writeFileSync(join(dir, 'tasma.json'), JSON.stringify(found, null, 1))
  if (dir) writeFileSync(join(dir, 'denetim.json'), JSON.stringify(audit, null, 1))
  console.log(`     v3 screens: ${found.length} cut-off words${dir ? ` · ${dir}` : ''}`)
  assert.deepEqual(found.map((f) => `${f.lang} ${f.size} ${f.screen}: ${f.id} "${f.text}" ${f.scroll}>${f.client}`), [], 'no cut-off words')
}

async function shoot({ c, app, lib, work, lang, size, dir, found, audit }) {
  await lib.reset(c)
  await c.run((l) => { window.__store.getState().setUiLang(l); return true }, lang)
  if (dir) mkdirSync(dir, { recursive: true })
  const at = async (screen, wait = 500) => {
    await c.sleep(wait)
    // The first-run tour is not one of these screens.
    if (await c.has('tour')) { await c.click('tour.skip'); await c.waitGone('tour'); await c.sleep(200) }
    for (const f of await c.run(cutOff)) found.push({ lang, size: size.width, screen, ...f })
    for (const f of await c.run(gorunusAudit)) audit.push({ lang, size: size.width, screen, ...f })
    if (dir) await c.shot(join(dir, `${screen}.png`))
  }
  await at('01-bos')

  const files = [join(TESTDATA, 'kaynak', 'arkaplan-tr.mp4'), join(VOICEOVER, '4.jpg'), join(VOICEOVER, '9.jpg'), join(VOICEOVER, '14.jpg'), join(TESTDATA, 'ornek', 'tr-kisa.wav')]
  const assets = await lib.seedAssets(app, c, files)
  await c.run((ids) => {
    const s = window.__store.getState()
    for (const id of ids) s.addToTimeline(id)
    s.setDirty(false)
  }, assets.map((a) => a.id))
  await c.run((subs) => { const s = window.__store.getState(); s.setSubtitles(subs.map((x, i) => ({ id: 's' + i, ...x }))); s.setDirty(false) }, SUBS)
  await c.waitFor('the clips', async () => (await lib.clipList(c)).length === assets.length)
  // A short cut of the film: its first 16 s and the voice under them, the stills after.
  await c.run(() => {
    const s = window.__store.getState()
    s.setTime(16)
    s.splitAtPlayhead()
    const p = window.__store.getState().project
    const late = Object.values(p.clips).filter((cl) => cl.start >= 15.9 && cl.start <= 16.1 && p.assets.find((a) => a.id === cl.assetId)?.kind !== 'image').map((cl) => cl.id)
    window.__store.getState().deleteClips(late, true)
    window.__store.getState().selectClips?.([])
    window.__store.getState().setDirty(false)
  })
  await c.click('timeline.zoom.fit')
  await lib.seek(c, 4.2)
  await at('02-editor', 900)

  const film = await c.st((s) => Object.values(s.project.clips).find((cl) => s.project.assets.find((a) => a.id === cl.assetId)?.kind === 'video')?.id)
  await c.click(`timeline.clip.${film}`, { fx: 0.6, fy: 0.7 })
  await c.click('inspector.tab.clip')
  await c.waitFor('the clip selected', async () => (await c.st((s) => s.selectedClipIds.length)) >= 1)
  await at('03-klip-secili')
  if (dir) {
    const b = await c.box('timeline.scroll')
    const r = await c.capture({ format: 'png', clip: { x: Math.max(0, b.x - 60), y: Math.max(0, b.y - 60), width: Math.min(b.w + 60, size.width), height: b.h + 60, scale: 1 } })
    writeFileSync(join(dir, '04-cizelge-yakin.png'), Buffer.from(r.data, 'base64'))
  }
  // Arayüz v4: a sound clip's Audio card (its parts are small tabs).
  const voice = await c.st((s) => Object.values(s.project.clips).find((cl) => s.project.assets.find((a) => a.id === cl.assetId)?.kind === 'audio')?.id)
  await c.click(`timeline.clip.${voice}`, { fx: 0.3, fy: 0.5 })
  await c.waitId('inspector.card.audio')
  await at('16-ses-karti')
  await c.click('inspector.tab.subs')
  await at('05-altyazi')
  await c.click('inspector.tab.project')
  await at('06-proje')
  // The look tour: the Agent tab (when the agent is on) and the silence window.
  if (await c.has('inspector.tab.agent')) {
    await c.click('inspector.tab.agent')
    await at('22-ajan')
    await c.click('inspector.tab.project')
  }
  await c.click('preview.silence')
  await c.waitId('silence')
  await c.waitFor('the silence found', async () => (await c.has('silence.apply')) || (await c.attr('silence.status', 'data-busy')) === '0', 30000)
  await at('23-sessizlik', 600)
  await c.click('preview.silence')
  await c.waitGone('silence')

  // DENEME-1 (worker P): the narrow Inspector the user had, on the cards
  // whose choices ran into each other (Camera look's "Lies over" on a look
  // layer, the Transform card's tools), and the Text page, the closed left
  // panel and the Settings window's agent page.
  const sp = await c.box('splitter.inspector')
  const wide = await c.run(() => document.querySelector('.inspector').getBoundingClientRect().width)
  await c.dragAt(sp.cx, sp.cy, sp.cx + (wide - 260), sp.cy, { steps: 4 })
  await c.click(`timeline.clip.${film}`, { fx: 0.6, fy: 0.7 })
  await c.click('inspector.tab.clip')
  await at('17-dar-inspector')
  await c.run(() => {
    const st = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    st['Camera look'] = true
    localStorage.setItem('snipp-sections', JSON.stringify(st))
    const s = window.__store.getState()
    const id = s.addLookLayer({ grain: 0.3, weave: 0, halation: 0, fade: 0, flicker: 0, dust: 0, mono: 0, vignette: 0.2, vShape: 'round', vMotion: 'still', vSpeed: 1, bars: 0, gate: 0 }, 1, 5)
    window.__store.setState({ selectedClipIds: [id] })
  })
  await c.waitId('inspector.look.over')
  await at('18-gorunum-katmani')
  await c.key('z', ['ctrl'])
  const sp2 = await c.box('splitter.inspector')
  await c.dragAt(sp2.cx, sp2.cy, sp2.cx - (wide - 260), sp2.cy, { steps: 4 })
  // The Text page with a title selected (its quick fonts awake), every
  // section open, its top and its end (YAZI-PANELI-PLAN.md).
  await c.run(() => {
    const st = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    for (const id of ['Text: ready', 'Text: styles', 'Text: animations', 'Text: shapes', 'Text: font']) st[id] = true
    localStorage.setItem('snipp-sections', JSON.stringify(st))
  })
  await lib.textPage(c)
  await c.click('dock.text.add')
  await at('19-yazi', 700)
  await c.run(() => { const el = document.querySelector('#dock-text-text'); el.scrollTop = el.scrollHeight; return true })
  await at('19b-yazi-alt', 500)
  await c.run(() => { const s = window.__store.getState(); s.undo(); s.selectCaptions([]); return true })
  await c.click('dock.close')
  await at('20-sol-panel-kapali')
  await c.click('dock.open')
  await c.click('topbar.settings')
  await c.waitId('settings')
  await c.click('settings.nav.agent')
  await at('21-ayarlar-ajan', 700)
  await c.key('Escape')
  await c.waitGone('settings')

  // Arayüz v4: the left panel's categories (dock.page.<id>).
  await lib.templatesPage(c)
  await at('07-sablonlar')
  await lib.dockPage(c, 'effects')
  await at('11-efektler')
  await lib.dockPage(c, 'transitions')
  await at('12-gecisler')
  await c.click(`timeline.clip.${film}`, { fx: 0.6, fy: 0.7 })
  await lib.dockPage(c, 'filters')
  await at('13-filtreler', 900)
  await lib.dockPage(c, 'code')
  await at('14-kod')
  await lib.dockPage(c, 'captions')
  await at('15-altyazi-kategori')
  await lib.dockPage(c, 'media')

  await c.click('topbar.file')
  await at('08-dosya-menusu', 400)
  await c.key('Escape')

  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await at('09-disa-aktarma')
  await c.click('export.cancel')
  await c.waitGone('dialog.export')

  const file = join(work, `screens v3 ${lang} ${size.width}.snipp`)
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => !(await c.st((s) => s.dirty)), 10000)
  await c.click('topbar.file')
  await c.click('menu.file.projects')
  await c.waitId('home.sample')
  await at('10-projeler', 900)
  await c.key('Escape')
}
