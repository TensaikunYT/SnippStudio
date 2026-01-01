// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The look tour (GORUNUS-PLAN.md): its seven rules counted on a screen. The
// function runs in the page (c.run serialises it: it must not reach outside
// itself) and returns every finding as { rule, where, what }. The screens
// scenario (99-ui3-screens) writes them beside the pictures (denetim.json)
// and the tour's plan counts them rule by rule, before and after.
//   R1 words      a visible text block of more than two lines, or a sentence
//                 shown twice on one screen
//   R2 controls   a button whose height is not 28 / 24 / 20 (the tab row 34,
//                 a card's small tab 26, the play button 36, the switch and the
//                 box are their own controls); a round radio; a native box
//   R3 type       on a card (Inspector, left panel, a window, a menu): a size /
//                 weight that is not title 13/600, label 12/500, value 12 mono,
//                 helper 11
//   R4 colour     a coloured edge, fill or text outside its owner (accent,
//                 selection, agent, danger; clip, mark and note colours only
//                 on the timeline)
//   R6 spacing    an Inspector card whose padding is not 12, two cards not 8
//                 apart, a card whose slider labels are not one width
//   R7 density    words cut off, a button running past its panel, more than
//                 two scroll bars in one panel
// R5 (pictures on cards) is judged by eye; its count is in the plan.
export function gorunusAudit() {
  const out = []
  const add = (rule, el, what) => {
    const id = el?.closest?.('[data-testid]')?.dataset.testid ?? ''
    const cls = el ? `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className ?? '').trim().split(/\s+/).slice(0, 2).join('.')}` : ''
    out.push({ rule, where: `${id} ${cls}`.trim(), what })
  }
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
      if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return false
    }
    // Clipped away by a scroll area or a folded part.
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      const p = e.getBoundingClientRect()
      if (r.bottom <= p.top + 1 || r.top >= p.bottom - 1 || r.right <= p.left + 1 || r.left >= p.right - 1) return false
    }
    return true
  }
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim()
  const inTimeline = (el) => !!el.closest('.timeline, .tl-wrap, [data-testid^="timeline"], .note-lane, .agent-bar, .review-strip, .preview, .player, canvas')
  // Menus (rows of a list) and a window's own title are not a card's words.
  const onCard = (el) => !!el.closest('.inspector, .dock, .ui-dialog, [role="dialog"], .settings') && !el.closest('.ui-menu, .ui-dialog-title, h1, h2')
  const all = [...document.querySelectorAll('body *')].filter((el) => !el.closest('.ui-tooltip-layer, .tour-bubble') && vis(el))

  // ---- R1: words ------------------------------------------------------------
  // A paragraph: a block of words that wraps (more than 60 letters on two
  // lines or more) or holds two sentences or more. The agent's own talk, the
  // tour, menus, code and the timeline are not explanations.
  const seen = new Map()
  const skipWords = '.cm-editor, .tl-clip, .sub-row, .subs-list, .media-name, .ui-menu, .agent-trail, .agent-row, .review-strip, .ui-toast, .project-card, .home-recent, .tpl-card-body pre, code, .wiz-cmd, .wiz-try, .xw-summary'
  for (const el of all) {
    const text = ownText(el)
    if (text.length < 12) continue
    if (el.closest('input, textarea, select, [contenteditable="true"]') || el.closest(skipWords)) continue
    // The whole block, not its pieces (a <b> inside a sentence): climb out
    // of inline parts; a block that holds other blocks is a container, not
    // a paragraph.
    let block = el
    while (block.parentElement && getComputedStyle(block).display.startsWith('inline') && !block.matches('button, label')) block = block.parentElement
    if ([...block.querySelectorAll('*')].some((d) => !getComputedStyle(d).display.startsWith('inline') && getComputedStyle(d).display !== 'none' && (d.textContent ?? '').trim())) continue
    if (block.closest('button, [role="button"], label, .ui-select, .ui-menu-item')) continue
    if (block.dataset.gorunusSeen) continue
    block.dataset.gorunusSeen = '1'
    const words = (block.textContent ?? '').replace(/\s+/g, ' ').trim()
    const cs = getComputedStyle(block)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4
    const lines = Math.round(block.getBoundingClientRect().height / lh)
    const sentences = words.split(/[.!?](?:\s+)(?=\p{Lu})/u).filter((x) => x.trim().length > 3).length
    if (words.length > 60 && lines >= 2) add('R1', block, `paragraph of ${lines} lines: "${words.slice(0, 50)}…"`)
    else if (sentences >= 2) add('R1', block, `${sentences} sentences: "${words.slice(0, 50)}…"`)
    if (words.length >= 24) {
      const key = words.toLowerCase()
      if (seen.has(key) && seen.get(key) !== block) add('R1', block, `said twice: "${words.slice(0, 50)}"`)
      else seen.set(key, block)
    }
  }
  for (const el of document.querySelectorAll('[data-gorunus-seen]')) delete el.dataset.gorunusSeen

  // ---- R2: controls ---------------------------------------------------------
  const okH = new Set([28, 24, 20])
  for (const el of all) {
    if (el.matches('input[type="radio"]')) { add('R2', el, 'a native round radio'); continue }
    if (el.matches('input[type="checkbox"]') && !el.closest('.ui-check, .ui-switch')) { add('R2', el, 'a native check box'); continue }
    if (el.matches('select') && !el.closest('.ui-select')) { add('R2', el, 'a native select'); continue }
    if (!el.matches('button, [role="button"]')) continue
    if (el.matches('.ui-tab, [role="tab"], .ui-seg-part, .ui-switch, .ui-check, .ui-section-head, .ui-subsection-head, .ui-menu-item, .tl-clip, [role="menuitem"]')) continue
    if (el.closest('.tl-clip, .ui-menu, .preview-overlay, canvas')) continue
    if (el.matches('[data-testid="transport.play"], .play-btn')) continue
    const r = el.getBoundingClientRect()
    const h = Math.round(r.height)
    // A card (a thumbnail, a list row) that is a button is not a control.
    if (h >= 40 || r.width > 160 && h > 32) continue
    if (h < 14) continue
    if (!okH.has(h)) add('R2', el, `button ${h} high`)
  }

  // ---- R3: type -------------------------------------------------------------
  for (const el of all) {
    if (!onCard(el)) continue
    const text = ownText(el)
    if (!text || /^[\s·•–—|/:,.()+×%-]*$/.test(text)) continue
    if (el.closest('.cm-editor, .tl-clip, .thumb, .media-thumb, .style-card-sample, [data-sample], .font-sample, .ui-kbd')) continue
    const cs = getComputedStyle(el)
    const size = Math.round(parseFloat(cs.fontSize))
    const weight = Number(cs.fontWeight)
    const mono = /mono|consolas/i.test(cs.fontFamily)
    const field = el.matches('input, textarea, select, option')
    const ok = (size === 13 && weight === 600) ||
      (size === 12 && (weight === 500 || mono || field)) ||
      (size === 12 && weight === 400) ||
      (size === 11 && weight <= 500)
    if (!ok) add('R3', el, `${size}/${weight}${mono ? ' mono' : ''} "${text.slice(0, 30)}"`)
  }

  // ---- R4: colour -----------------------------------------------------------
  const rgb = (s) => {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s)
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
    // color-mix() comes back as color(srgb r g b / a), each 0…1.
    const n = /color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+))?\)/.exec(s)
    return n ? { r: +n[1] * 255, g: +n[2] * 255, b: +n[3] * 255, a: n[4] === undefined ? 1 : +n[4] } : null
  }
  const root = getComputedStyle(document.documentElement)
  const tok = (n) => {
    const p = document.createElement('i'); p.style.color = `var(${n})`; document.body.appendChild(p)
    const c = rgb(getComputedStyle(p).color); p.remove(); return c
  }
  const fam = (names) => names.map(tok).filter(Boolean)
  const general = fam(['--accent', '--accent-text', '--accent-soft', '--accent-line', '--on-accent', '--accent-press', '--focus-halo',
    '--select', '--danger', '--danger-text', '--danger-soft', '--danger-line',
    '--agent', '--agent-text', '--agent-soft', '--agent-line', '--on-agent',
    '--agent-w1', '--agent-w2', '--agent-w3', '--agent-w4', '--agent-w5', '--agent-w6', '--warn', '--level-ok'])
  const accentFam = fam(['--accent', '--accent-text', '--accent-soft', '--accent-line', '--accent-press'])
  const timelineOnly = fam(['--clip-video-fill', '--clip-video-line', '--clip-video-text', '--clip-code-fill', '--clip-code-line', '--clip-code-text',
    '--clip-image-fill', '--clip-image-line', '--clip-image-text', '--clip-audio-fill', '--clip-audio-line', '--clip-audio-text', '--clip-wave',
    '--clip-caption-fill', '--clip-caption-line', '--clip-caption-text', '--mark', '--mark-text', '--select-soft',
    '--note', '--note-soft', '--note-line', '--note-text'])
  void root
  const chroma = (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
  const near = (c, list) => list.some((t) => Math.abs(t.r - c.r) + Math.abs(t.g - c.g) + Math.abs(t.b - c.b) <= 24)
  for (const el of all) {
    if (el.matches('img, canvas, video, svg *, svg:not(.ui-icon)') || el.closest('canvas, .thumb, .media-thumb, .ui-menu-swatch, .swatch, [data-swatch], .color-dot, .label-dot, .ui-kit, .lut-thumb, .look-thumb, .fx-thumb, .tr-thumb, .preview-stage')) continue
    const cs = getComputedStyle(el)
    const checks = [['text', cs.color], ['fill', cs.backgroundColor]]
    if (parseFloat(cs.borderTopWidth) > 0) checks.push(['edge', cs.borderTopColor])
    if (parseFloat(cs.borderLeftWidth) > 0) checks.push(['edge', cs.borderLeftColor])
    for (const [what, value] of checks) {
      const c = rgb(value)
      if (!c || c.a < 0.12 || chroma(c) < 40) continue
      if (what === 'text' && !ownText(el) && !el.matches('svg.ui-icon')) continue
      // The accent belongs to the main action, what is on, focus and a
      // slider's fill; anywhere else it is a colour too many.
      if (near(c, accentFam)) {
        if (el.closest('.ui-btn-primary, .ui-switch, .ui-check, .is-on, [aria-pressed="true"], [aria-checked="true"], [aria-selected="true"], :focus, :focus-within, .ui-range, .tl-snapguide, .ui-chip-accent, .is-ok, .split-primary')) continue
        add('R4', el, `accent ${what} off its place`)
        break
      }
      if (near(c, general)) continue
      if (near(c, timelineOnly) && (inTimeline(el) || el.closest('.notes-panel, .note-card, [data-testid^="notes"], [data-testid^="media.item."]'))) continue
      add('R4', el, `${what} ${value}`)
      break
    }
  }

  // ---- R6: spacing ----------------------------------------------------------
  const cards = all.filter((el) => el.matches('.ui-cards > .ui-section, .ui-section.is-card'))
  for (const card of cards) {
    const cs = getComputedStyle(card)
    if (Math.round(parseFloat(cs.paddingLeft)) !== 12 || Math.round(parseFloat(cs.paddingRight)) !== 12) add('R6', card, `card padding ${cs.paddingLeft} / ${cs.paddingRight}`)
    const next = card.nextElementSibling
    if (next && vis(next) && next.matches('.ui-section')) {
      const gap = Math.round(next.getBoundingClientRect().top - card.getBoundingClientRect().bottom)
      if (gap !== 8) add('R6', card, `cards ${gap} apart`)
    }
    // The label column: a field's label and a one-row slider's (a stacked
    // slider's label spans its row, over its own track).
    const labels = [...card.querySelectorAll('.ui-slider:not(.ui-sliders-stacked .ui-slider) > .ui-slider-label, .ui-field-row > .ui-field-label')].filter(vis).map((l) => Math.round(l.getBoundingClientRect().width))
    const widths = [...new Set(labels)]
    if (widths.length > 1) add('R6', card, `label widths ${widths.join(' / ')}`)
    const rights = [...card.querySelectorAll('.ui-slider .ui-slider-value')].filter(vis).map((v) => Math.round(v.getBoundingClientRect().right))
    const edges = [...new Set(rights)]
    if (edges.length > 1 && Math.max(...edges) - Math.min(...edges) > 2) add('R6', card, `values end at ${edges.join(' / ')}`)
  }

  // ---- R7: density ----------------------------------------------------------
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (el.closest('.timeline, [data-testid^="timeline."], .tl-clip, .media-name, .media-card, .sub-row, .wiz-cmd, [data-testid^="media.item."]')) continue
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && ownText(el).length > 0) add('R7', el, `cut off: "${ownText(el).slice(0, 30)}"`)
    // A label in a card's label column that breaks onto a second line.
    if (el.matches('.ui-field-label, .ui-slider-label') && ownText(el)) {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4
      if (el.getBoundingClientRect().height > lh * 1.6) add('R7', el, `label on two lines: "${ownText(el).slice(0, 30)}"`)
    }
  }
  const panels = [...document.querySelectorAll('.inspector, .dock, .ui-dialog, .timeline-card, .settings')].filter(vis)
  for (const p of panels) {
    const bars = [p, ...p.querySelectorAll('*')].filter((e) => {
      const cs = getComputedStyle(e)
      return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 30 && vis(e)
    })
    if (bars.length > 2) add('R7', p, `${bars.length} scroll bars`)
  }
  const btns = all.filter((el) => el.matches('button'))
  for (const b of btns) {
    const box = b.closest('.ui-dialog, .inspector, .dock, .topbar')
    if (!box) continue
    const r = b.getBoundingClientRect(), q = box.getBoundingClientRect()
    if (r.right > q.right + 1 || r.left < q.left - 1) add('R7', b, 'button runs past its panel')
  }
  return out
}
