// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The visual polish's numbers ("az, çok": SnippStudio GORSEL-PLAN.md), measured
// in the running app on the three screens the work was tried on first: the
// empty editor, the editor with media, the Inspector with a clip selected.
// Runs only when SNIPP_GORSEL names a folder (it checks nothing a test needs);
// SNIPP_GORSEL_LANG=tr measures the Turkish interface. Writes <folder>/<lang>.json:
//   framed       buttons on screen whose edge is drawn (a border of their own)
//   filled       buttons on screen filled with the accent (the main action)
//   toolbars     the width of the timeline's and the preview's tool rows (px)
//   paragraphs   sentences that stay on screen (not an empty state, not a tip)
//   overflow     buttons whose words do not fit (scrollWidth > clientWidth)
//   accent       share of the window's pixels in the accent's hue (empty editor)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { SUBS } from '../media.mjs'
export const name = 'gorsel-measure'

/** In the page: what the rules count. */
function measure() {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    }
    return true
  }
  const alpha = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c)
    if (!m) return 1
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return p.length > 3 ? p[3] : 1
  }
  const name = (el) => el.dataset.testid ?? el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30)
  const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(vis)
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase()
  const hexToRgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`
  const framed = buttons.filter((b) => {
    const cs = getComputedStyle(b)
    return ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && alpha(cs[`border${s}Color`]) > 0.05 && cs[`border${s}Color`] !== cs.backgroundColor)
  })
  const filled = buttons.filter((b) => getComputedStyle(b).backgroundColor === hexToRgb(accent))
  // The tool rows: from the first tool to the last one before the row's gap.
  const row = (sel, stop) => {
    const bar = document.querySelector(sel)
    if (!bar) return null
    const kids = []
    for (const k of bar.children) {
      if (k.matches(stop)) break
      if (vis(k)) kids.push(k.getBoundingClientRect())
    }
    if (!kids.length) return 0
    return Math.round(Math.max(...kids.map((r) => r.right)) - Math.min(...kids.map((r) => r.left)))
  }
  const toolbars = { timeline: row('.tl-toolbar', '.tl-toolbar-gap'), preview: row('.preview-toolbar', '.spacer') }
  // Sentences that stay on screen: an element's own words (not its children's),
  // five words or more, outside controls, menus, tips and fields; an empty
  // state (a class naming "empty", or the Inspector's "select a clip") is not one.
  const paragraphs = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('button, input, textarea, select, [role="menu"], [role="tooltip"], .ui-tooltip-layer, .tl-scroll, .preview-canvas-wrap, [contenteditable]')) continue
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim()
    if (own.split(' ').length < 5 || own.length < 24) continue
    if (!vis(el)) continue
    let empty = false
    for (let e = el; e && e !== document.body; e = e.parentElement) if (/empty|insp-none/.test(e.className?.toString?.() ?? '') || e.dataset?.empty === 'true') empty = true
    paragraphs.push({ text: own.slice(0, 90), cls: el.className?.toString?.() ?? '', empty })
  }
  const overflow = buttons
    .map((b) => b.querySelector('.ui-btn-label') ?? null)
    .filter((l) => l && vis(l) && l.scrollWidth > l.clientWidth + 1)
    .map((l) => ({ name: name(l.closest('button')), text: l.textContent, scroll: l.scrollWidth, client: l.clientWidth }))
  return {
    buttons: buttons.length,
    framed: framed.length,
    framedList: framed.map(name),
    filled: filled.length,
    filledList: filled.map(name),
    toolbars,
    paragraphs: paragraphs.filter((p) => !p.empty).length,
    paragraphList: paragraphs,
    overflow
  }
}

/** Share of pixels in the accent's hue: hue 140–200°, saturation ≥ 0.3, value ≥ 0.3 (HSV). */
async function accentShare(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  const total = info.width * info.height
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    if (max < 0.3 || d / max < 0.3) continue
    let h
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
    if (h >= 140 && h <= 200) n++
  }
  return { pixels: n, total, share: Math.round((10000 * n) / total) / 100 }
}

export async function run({ c, app, media, lib }) {
  const dir = process.env.SNIPP_GORSEL
  if (!dir) {
    console.log('     (SNIPP_GORSEL not set: nothing measured)')
    return
  }
  const lang = process.env.SNIPP_GORSEL_LANG === 'tr' ? 'tr' : 'en'
  mkdirSync(dir, { recursive: true })
  await c.run((l) => { window.__store.getState().setUiLang(l); return true }, lang)
  try {
    const out = { lang, at: new Date().toISOString() }
    await c.sleep(500)
    const shot = join(dir, `${lang}-01-empty.png`)
    await c.shot(shot)
    out.empty = { ...(await c.run(measure)), accent: await accentShare(shot) }

    const [talk, other, card] = await lib.seedAssets(app, c, [media.talk, media.other, media.numbered[2]])
    await lib.seedTimeline(c, [talk.id, other.id, card.id])
    await c.run((subs) => { const s = window.__store.getState(); s.setSubtitles(subs.map((x, i) => ({ id: 's' + i, ...x }))); s.setDirty(false) }, SUBS)
    await lib.seek(c, 2)
    await c.waitFor('three clips', async () => (await lib.clipList(c)).length === 3)
    await c.sleep(500)
    out.media = await c.run(measure)

    const [first] = await lib.clipList(c)
    await c.click(`timeline.clip.${first.id}`, { fx: 0.5 })
    await c.click('inspector.tab.clip')
    await c.waitFor('the clip selected', async () => (await c.st((s) => s.selectedClipIds.length)) >= 1)
    await c.sleep(500)
    out.inspector = await c.run(measure)
    writeFileSync(join(dir, `${lang}.json`), JSON.stringify(out, null, 1))
    console.log(`     ${lang}: framed ${out.empty.framed} · filled ${out.empty.filled} · toolbars ${JSON.stringify(out.empty.toolbars)} · paragraphs ${out.empty.paragraphs}/${out.media.paragraphs}/${out.inspector.paragraphs} · accent ${out.empty.accent.share}% · overflow ${out.empty.overflow.length + out.media.overflow.length + out.inspector.overflow.length}`)
  } finally {
    await c.run(() => { window.__store.getState().setUiLang('en'); return true })
  }
}
