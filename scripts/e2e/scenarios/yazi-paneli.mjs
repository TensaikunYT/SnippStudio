// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Text page made clearer (SnippStudio YAZI-PANELI-PLAN.md), each point as
// the user met it or asked for it:
//   1 the Label look's letters are not doubled, on one line or two (the
//     export's own frame: the ink inside its boxes is the same with its
//     shadow on and off; the shadow is the box's);
//   2 the animations in three groups (10 in, 9 out, 5 while on screen), each
//     picture drawn; a click with nothing selected adds a text with that move
//     only; with a text selected an in card changes its way in only, an out
//     card its way out, a while-on-screen card its idle move; one undo step
//     each; the card of its move is marked;
//   3 a ready-made text: its parts added together, selected, one undo step;
//     the quote is the Templates' own;
//   4 the quick fonts rest with no text selected, set the selected one;
//   5 shapes are added here, not in Effects; a frame; a marker band behind
//     the selected text;
//   6 the page at 1366 × 768 in both languages: no cut-off word or name;
//   7 (REF-AB, item 10) fourteen styles, each its name drawn in its look; a
//     style gives its look to the selected text (its words and place kept);
//   8 (REF-AB, item 6) the search keeps only what it names; a bookmark keeps
//     a card among the favourites; the recently used are the last clicked,
//     newest first; both survive a reload (the profile's own storage).
// Every check runs and the failures are reported together.
export const name = 'yazi-paneli'
export const timeoutMs = 240_000

// (okunur, 23 November: the ready-made texts moved to the Templates
// sub-page, at the user's word; the text sub-page keeps the other four and
// shows ready-made texts only as search / favourite results.)
const SECTIONS = ['styles', 'anims', 'shapes', 'font']

/** In the page: the dark ink inside the white boxes of the export's frame of
 *  `project` at `t` (each box's inside, its border and corners left out). */
async function boxInk(c, project, t) {
  return c.run(async (p, t) => {
    const ex = await window.__exporter()
    const u8 = await ex.exportFramePng(p, t, true, 'final')
    const bmp = await createImageBitmap(new Blob([u8]))
    const cv = new OffscreenCanvas(bmp.width, bmp.height)
    const g = cv.getContext('2d', { willReadFrequently: true })
    g.drawImage(bmp, 0, 0)
    const { data, width, height } = g.getImageData(0, 0, bmp.width, bmp.height)
    const lum = (i) => (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11)
    // The boxes: the runs of rows with many white pixels.
    const rows = []
    for (let y = 0; y < height; y++) {
      let n = 0
      for (let x = 0; x < width; x++) if (lum((y * width + x) * 4) > 235) n++
      rows.push(n)
    }
    const boxes = []
    let at = -1
    for (let y = 0; y <= height; y++) {
      const on = y < height && rows[y] > 40
      if (on && at < 0) at = y
      if (!on && at >= 0) { if (y - at > 12) boxes.push([at, y - 1]); at = -1 }
    }
    let ink = 0
    for (const [y0, y1] of boxes) {
      let x0 = width
      let x1 = 0
      const mid = (y0 + y1) >> 1
      for (let x = 0; x < width; x++) if (lum((mid * width + x) * 4) > 235) { x0 = Math.min(x0, x); x1 = Math.max(x1, x) }
      for (let y = y0 + 6; y <= y1 - 6; y++) for (let x = x0 + 14; x <= x1 - 14; x++) if (lum((y * width + x) * 4) < 90) ink++
    }
    return { boxes: boxes.length, ink }
  }, project, t)
}

/** In the page: words cut off inside the left panel, and the page running sideways. */
function cutOff() {
  const out = []
  const dock = document.querySelector('#dock-page-templates')
  for (const el of dock.querySelectorAll('.text-style-name, .text-font, .ui-btn-label, .ui-section-name, .text-anim-group-name, .ui-tab-label')) {
    const r = el.getBoundingClientRect()
    if (r.width < 2) continue
    if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.closest('[data-testid]')?.dataset.testid ?? ''} "${el.textContent.trim()}" ${el.scrollWidth}>${el.clientWidth}`)
  }
  const body = dock.querySelector('#dock-text-text')
  if (body && body.scrollWidth > body.clientWidth + 1) out.push(`the page scrolls sideways ${body.scrollWidth}>${body.clientWidth}`)
  return out
}

export async function run({ c, lib }) {
  const { assert } = lib
  const bad = []
  const check = async (what, fn) => {
    try {
      const r = await fn()
      if (r) bad.push(`${what}: ${typeof r === 'string' ? r : JSON.stringify(r)}`)
    } catch (e) {
      bad.push(`${what}: ${e.message.split('\n')[0]}`)
    }
  }
  // Every section open (they are remembered: a scenario before may have folded one).
  await lib.openCards(c, ['Text: ready', 'Text: styles', 'Text: animations', 'Text: shapes', 'Text: font'])
  await lib.textPage(c)
  for (const s of SECTIONS) await c.waitId(`dock.text.sec.${s}`)
  await check('0 the ready-made texts live on Templates, first', async () => {
    const out = []
    if (await c.run(() => !!document.querySelector('#dock-text-text [data-testid="dock.text.sec.ready"]'))) out.push('still on the text sub-page')
    await lib.templatesPage(c)
    await c.waitId('dock.text.sec.ready')
    const order = await c.run(() => ['dock.text.sec.ready', 'templates.insert.steps'].map((t) => document.querySelector(`#dock-text-templates [data-testid="${t}"]`)?.getBoundingClientRect().top ?? null))
    if (!(order[0] !== null && order[1] !== null && order[0] < order[1])) out.push(`not over the gallery ${order}`)
    await lib.textPage(c)
    return out.join('; ') || null
  })
  const clear = async () => {
    await c.run(() => { const s = window.__store.getState(); s.newProject('16:9'); s.selectCaptions([]); s.setDirty(false); return true })
    await c.sleep(150)
  }

  // ---- 1: the Label look ----------------------------------------------------------------
  await check('1 Label letters not doubled', async () => {
    await clear()
    await c.click('dock.text.style.label')
    const out = []
    for (const text of ['Label text', 'Two lines of text\ngoing here now']) {
      const id = await c.st((s) => s.project.captions[0]?.id)
      await c.run((id, text) => { window.__store.getState().updateCaption(id, { text }); return true }, id, text)
      const p = await lib.project(c)
      const off = structuredClone(p)
      off.captions[0].style.shadow = { ...off.captions[0].style.shadow, enabled: false }
      const on = await boxInk(c, p, 1.2)
      const without = await boxInk(c, off, 1.2)
      const lines = text.split('\n').length
      if (on.boxes !== lines) out.push(`${lines} line(s): ${on.boxes} boxes`)
      if (without.ink < 200) out.push(`${lines} line(s): no letters found (${without.ink})`)
      else if (on.ink > without.ink * 1.06) out.push(`${lines} line(s): ink ${on.ink} with the shadow, ${without.ink} without`)
    }
    return out.join('; ') || null
  })

  // ---- 2: the animations -----------------------------------------------------------------
  await check('2 three groups, every picture drawn', async () => {
    await clear()
    await c.sleep(400)
    const r = await c.run(() => ['in', 'out', 'idle'].map((g) => [...document.querySelectorAll(`[data-testid="dock.text.anims.${g}"] canvas`)].map((cv) => {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      let lit = 0
      for (let i = 3; i < d.length; i += 4 * 5) if (d[i] > 40) lit++
      return lit
    })))
    const counts = r.map((g) => g.length).join('/')
    if (counts !== '10/9/5') return `groups ${counts}`
    const blank = r.flat().filter((n) => n < 5).length
    return blank ? `${blank} blank pictures` : null
  })
  await check('2 a click with nothing selected adds a text with that move only', async () => {
    await clear()
    assert.match(await c.run(() => document.querySelector('[data-testid="dock.text.target"]').textContent), /./)
    await c.click('dock.text.anim.out.slide')
    const caps = await c.st((s) => s.project.captions.map((x) => ({ id: x.id, anim: x.anim ?? {} })))
    if (caps.length !== 1) return `${caps.length} texts`
    const a = caps[0].anim
    if (a.out !== 'slide' || (a.in && a.in !== 'none') || a.idle) return a
    return (await c.st((s) => s.selectedCaptionIds.length)) === 1 ? null : 'the new text is not selected'
  })
  await check('2 on the selected text: in, out and idle apart, one undo step each', async () => {
    const id = await c.st((s) => s.project.captions[0].id)
    const depth = await lib.undoDepth(c)
    await c.click('dock.text.anim.in.pop')
    await c.click('dock.text.anim.idle.bob')
    const a = await c.st((s, id) => s.project.captions.find((x) => x.id === id).anim, id)
    const out = []
    if (a.in !== 'pop' || a.out !== 'slide' || a.idle !== 'bob') out.push(JSON.stringify(a))
    if ((await c.st((s) => s.project.captions.length)) !== 1) out.push('a text was added')
    const steps = (await lib.undoDepth(c)) - depth
    if (steps !== 2) out.push(`${steps} undo steps for two clicks`)
    if ((await c.attr('dock.text.anim.in.pop', 'aria-pressed')) !== 'true') out.push('its in card is not marked')
    if ((await c.attr('dock.text.anim.in.fade', 'aria-pressed')) === 'true') out.push('another in card is marked')
    await c.click('dock.text.anim.in.type')
    const typed = await c.st((s, id) => s.project.captions.find((x) => x.id === id).anim, id)
    if (!typed.perChar || typed.in !== 'pop') out.push(`type on: ${JSON.stringify(typed)}`)
    await c.click('dock.text.anim.in.fade')
    const back = await c.st((s, id) => s.project.captions.find((x) => x.id === id).anim, id)
    if (back.perChar || back.in !== 'fade') out.push(`another way in after type on: ${JSON.stringify(back)}`)
    return out.join('; ') || null
  })

  // ---- 3: ready-made texts -----------------------------------------------------------------
  await check('3 a lower third: two texts, selected, one undo step', async () => {
    await clear()
    await lib.templatesPage(c)
    const depth = await lib.undoDepth(c)
    await c.click('dock.text.ready.lower')
    const caps = await c.st((s) => s.project.captions.map((x) => ({ id: x.id, text: x.text, layer: x.layer, bg: x.style?.bgOpacity })))
    const out = []
    if (caps.length !== 2) out.push(`${caps.length} texts`)
    if (new Set(caps.map((x) => x.layer)).size !== caps.length) out.push('two parts on one layer')
    if (caps.some((x) => !(x.bg > 0.5))) out.push('a part without its band')
    if ((await c.st((s) => s.selectedCaptionIds.length)) !== 2) out.push('not both selected')
    if ((await lib.undoDepth(c)) - depth !== 1) out.push(`${(await lib.undoDepth(c)) - depth} undo steps`)
    await c.run(() => window.__store.getState().undo())
    if ((await c.st((s) => s.project.captions.length)) !== 0) out.push('one undo leaves some of it')
    return out.join('; ') || null
  })
  await check('3 the quote is the Templates’ quote', async () => {
    await c.click('dock.text.ready.quote')
    const kinds = await c.st((s) => (s.project.templates ?? []).map((x) => x.kind))
    await lib.textPage(c)
    return kinds.includes('quote') ? null : kinds
  })

  // ---- 4: quick fonts -----------------------------------------------------------------------
  await check('4 fonts rest with no text, set the selected one', async () => {
    await clear()
    await c.waitId('dock.text.fonts.pick', 3000)
    const off = await c.run(() => [...document.querySelectorAll('[data-testid="dock.text.fonts"] button')].map((b) => b.disabled))
    const out = []
    if (off.length !== 6) out.push(`${off.length} fonts`)
    if (off.some((d) => !d)) out.push('a font card works with no text')
    await c.click('dock.text.add')
    await c.waitGone('dock.text.fonts.pick', 3000)
    await c.click('dock.text.font.anton')
    const f = await c.st((s) => s.project.captions[0]?.style?.fontFamily)
    if (f !== 'Anton') out.push(`font ${f}`)
    if ((await c.attr('dock.text.font.anton', 'aria-pressed')) !== 'true') out.push('its card is not marked')
    return out.join('; ') || null
  })

  // ---- 5: shapes and highlights ---------------------------------------------------------------
  await check('5 shapes here, a frame, a marker behind the selected text', async () => {
    const out = []
    const text = await c.st((s) => s.project.captions[0])
    await c.run((id) => { window.__store.getState().selectCaptions([id]); return true }, text.id)
    await c.click('shapes.add.marker')
    const marker = await c.st((s) => s.project.captions.find((x) => x.shape?.kind === 'marker'))
    if (!marker) out.push('no marker')
    else if (Math.abs(marker.start - text.start) > 1e-6 || Math.abs(marker.end - text.end) > 1e-6 || marker.layer !== text.layer) out.push('the marker is not behind the text')
    await c.click('shapes.add.frame')
    const frame = await c.st((s) => s.project.captions.find((x) => x.shape?.kind === 'rect'))
    if (!frame || frame.style.bgOpacity !== 0 || !(frame.style.bgBorder?.width > 0)) out.push(`frame ${JSON.stringify(frame?.style?.bgBorder)}`)
    await lib.dockPage(c, 'effects')
    await c.sleep(200)
    if (await c.run(() => !!document.querySelector('#dock-page-effects [data-testid^="shapes.add."], [data-testid="effects.panel"]'))) out.push('shapes still in Effects')
    await lib.textPage(c)
    return out.join('; ') || null
  })

  // ---- 7: the styles grid ----------------------------------------------------------------------
  await check('7 fourteen styles, every one drawn', async () => {
    await clear()
    await c.sleep(400)
    const r = await c.run(() => [...document.querySelectorAll('[data-testid="dock.text.styles"] canvas')].map((cv) => {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      let lit = 0
      for (let i = 3; i < d.length; i += 4 * 5) if (d[i] > 40) lit++
      return lit
    }))
    if (r.length !== 14) return `${r.length} styles`
    const blank = r.filter((n) => n < 5).length
    return blank ? `${blank} blank` : null
  })
  await check('7 a style on the selected text keeps its words and place', async () => {
    await clear()
    await c.click('dock.text.add')
    const id = await c.st((s) => s.project.captions[0].id)
    await c.run((id) => { const s = window.__store.getState(); s.updateCaption(id, { text: 'Keep me' }); s.setCaptionOwnStyle(id, { posX: 0.3, posY: 0.2 }); return true }, id)
    const depth = await lib.undoDepth(c)
    await c.click('dock.text.style.neon')
    const after = await c.st((s) => s.project.captions.map((x) => ({ text: x.text, font: x.style.fontFamily, x: x.style.posX, y: x.style.posY })))
    const out = []
    if (after.length !== 1) out.push(`${after.length} texts`)
    const a = after[0]
    if (a.text !== 'Keep me' || a.x !== 0.3 || a.y !== 0.2) out.push(JSON.stringify(a))
    if (a.font !== 'Inter') out.push(`font ${a.font}`)
    if ((await lib.undoDepth(c)) - depth !== 1) out.push('not one undo step')
    return out.join('; ') || null
  })

  // ---- 8: search, favourites, recently used --------------------------------------------------------
  await check('8 search, favourites, recently used', async () => {
    await clear()
    const out = []
    const shown = () => c.run(() => [...document.querySelectorAll('#dock-text-text [data-testid^="dock.text.style."], #dock-text-text [data-testid^="dock.text.ready."], #dock-text-text [data-testid^="dock.text.anim."]')].map((e) => e.dataset.testid))
    await c.fill('dock.text.find', 'neon')
    await c.sleep(200)
    const found = await shown()
    if (found.join() !== 'dock.text.style.neon') out.push(`"neon" finds ${found.join()}`)
    await c.fill('dock.text.find', 'yukari kay')
    await c.sleep(200)
    const tr = await shown()
    if (!tr.includes('dock.text.anim.in.slide')) out.push(`"yukari kay" finds ${tr.join()}`)
    // A ready-made text is still found from here (its home is Templates).
    await c.fill('dock.text.find', 'alt bant')
    await c.sleep(200)
    const rd = await shown()
    if (rd.join() !== 'dock.text.ready.lower') out.push(`"alt bant" finds ${rd.join()}`)
    await c.fill('dock.text.find', 'zzzz')
    await c.sleep(150)
    if (!(await c.has('dock.text.empty'))) out.push('no "nothing found"')
    await c.fill('dock.text.find', '')
    await c.sleep(150)
    // A favourite.
    await c.run(() => { localStorage.removeItem('snipp-text-picks'); return true })
    await c.send('Page.reload', {})
    await lib.ready(c)
    for (let i = 0; i < 10; i++) { if (await c.has('ask.recovery')) { await c.click('ask.recovery.discard'); break } await c.sleep(100) }
    await lib.textPage(c)
    await c.waitId('dock.text.fav.style:comic')
    await c.click('dock.text.fav.style:comic')
    await c.click('dock.text.mode.fav')
    await c.sleep(200)
    const favs = await shown()
    if (favs.join() !== 'dock.text.style.comic') out.push(`favourites show ${favs.join()}`)
    await c.click('dock.text.mode.fav')
    // Recently used: newest first.
    await c.click('dock.text.anim.out.fade')
    await lib.templatesPage(c)
    await c.click('dock.text.ready.titleSub')
    await lib.textPage(c)
    await c.click('dock.text.style.cinema')
    await c.click('dock.text.mode.recent')
    await c.sleep(200)
    const recent = await c.run(() => [...document.querySelectorAll('[data-testid="dock.text.recent"] [data-testid^="dock.text."]')].map((e) => e.dataset.testid).filter((x) => !x.startsWith('dock.text.fav.')))
    if (recent.join() !== 'dock.text.style.cinema,dock.text.ready.titleSub,dock.text.anim.out.fade') out.push(`recent ${recent.join()}`)
    // Both kept by the profile.
    await c.send('Page.reload', {})
    await lib.ready(c)
    for (let i = 0; i < 10; i++) { if (await c.has('ask.recovery')) { await c.click('ask.recovery.discard'); break } await c.sleep(100) }
    const kept = await c.run(() => JSON.parse(localStorage.getItem('snipp-text-picks') ?? 'null'))
    if (!kept || kept.fav.join() !== 'style:comic' || kept.recent[0] !== 'style:cinema') out.push(`kept ${JSON.stringify(kept)}`)
    await lib.textPage(c)
    return out.join('; ') || null
  })

  // ---- 6: no cut-off words at 1366 × 768 ---------------------------------------------------------
  try {
    for (const lang of ['tr', 'en']) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false })
      await c.run((l) => { window.__store.getState().setUiLang(l); return true }, lang)
      await c.sleep(600)
      await check(`6 ${lang} 1366 nothing cut off`, async () => {
        const found = []
        for (const at of [0, 1]) {
          await c.run((at) => { const el = document.querySelector('#dock-text-text'); el.scrollTop = at ? el.scrollHeight : 0; return true }, at)
          await c.sleep(200)
          found.push(...(await c.run(cutOff)))
        }
        return found.length ? [...new Set(found)].join('; ') : null
      })
    }
  } finally {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await c.run(() => { window.__store.getState().setUiLang('en'); return true })
  }
  if (bad.length) console.log('     ' + bad.join(' | '))
  assert.deepEqual(bad, [], 'the Text page')
}
