// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Shared by the yazi2-* scenarios (SnippStudio YAZI2-PLAN.md): where the
// titles stand on screen (worked out from the project the engine's way, not
// read from the program's own boxes), slow drags with real mouse events, and
// the frame recorder of scripts/perf/interact.mjs.

/** The outline stands this far outside the letters (text-edit/handles.ts OUTLINE_PAD). */
export const PAD = 6
/** The knob's distance from the outline (text-edit/handles.ts boxKnob). */
export const KNOB = 24

/** The preview, the frame in it, every caption's block on screen, the selection, the typing field. */
export const info = (c) => c.run(() => {
  const s = window.__store.getState()
  const cv = document.querySelector('[data-testid="preview.canvas"]')
  const r = cv.getBoundingClientRect()
  const { width: W, height: H } = s.project.settings
  const k = Math.min(r.width / W, r.height / H) * s.previewView.zoom
  const g = document.createElement('canvas').getContext('2d')
  const caps = s.project.captions.map((cap) => {
    const st = cap.style ?? s.project.captionStyle
    const m = cap.motion ?? { x: 0, y: 0, scale: 1, rot: 0 }
    const wx = (st.posX ?? 0.5) * W + m.x
    const wy = st.posY * H + m.y
    const fs = st.fontSize * H / 1080
    g.font = `${st.italic ? 'italic ' : ''}${st.fontWeight} ${fs}px "${st.fontFamily}", sans-serif`
    g.letterSpacing = `${(st.letterSpacing ?? 0) * H / 1080}px`
    const lines = []
    for (const para of (st.uppercase ? cap.text.toUpperCase() : cap.text).split('\n')) {
      const words = para.trim().split(/\s+/).filter(Boolean)
      if (!words.length) { lines.push(''); continue }
      let line = ''
      for (const w of words) { if (line && line.length + 1 + w.length > st.maxLineChars) { lines.push(line); line = w } else line = line ? line + ' ' + w : w }
      lines.push(line)
    }
    const ww = cap.shape ? cap.shape.w * W : Math.max(20, ...lines.map((l) => g.measureText(l).width))
    const wh = cap.shape ? cap.shape.h * H : Math.max(1, lines.length) * fs * (st.lineHeight ?? 1.25)
    return {
      id: cap.id, text: cap.text, lines, shape: !!cap.shape,
      // On screen: its middle and its size.
      x: r.left + r.width / 2 + s.previewView.x + (wx - W / 2) * k, y: r.top + r.height / 2 + s.previewView.y + (wy - H / 2) * k, w: ww * m.scale * k, h: wh * m.scale * k,
      // On the frame.
      fx: wx, fy: wy, fw: ww * m.scale, fh: wh * m.scale,
      posX: st.posX ?? 0.5, posY: st.posY, rot: +(((st.rotate ?? 0) + (m.rot ?? 0)) * 180 / Math.PI).toFixed(2), scale: +m.scale.toFixed(4),
      start: cap.start, end: cap.end, layer: cap.layer ?? 0, chars: st.maxLineChars, font: st.fontFamily, size: st.fontSize, weight: st.fontWeight, italic: !!st.italic, align: st.align ?? 'center', color: st.color
    }
  })
  const box = (id) => { const b = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect(); return b ? { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom } : null }
  const ta = document.querySelector('[data-testid="preview.text.field"]')
  return {
    k, canvas: { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom },
    frame: { x: r.left + r.width / 2 + s.previewView.x - (W * k) / 2, y: r.top + r.height / 2 + s.previewView.y - (H * k) / 2, w: W * k, h: H * k },
    caps, sel: s.selectedCaptionIds, selClips: s.selectedClipIds, undo: s.past.length, time: s.currentTime,
    typing: ta ? { value: ta.value, a: ta.selectionStart, b: ta.selectionEnd, focused: document.activeElement === ta } : null,
    active: document.activeElement?.dataset?.testid ?? document.activeElement?.tagName, bar: box('preview.text.bar'), cursor: cv.style.cursor.slice(0, 24)
  }
})

/** A drag with real mouse events, slow enough for every frame to be drawn;
 *  `mid` runs while the button is still down at the end point. */
export async function slowDrag(c, x0, y0, x1, y1, o = {}) {
  const steps = o.steps ?? 12
  await c.mouse('mouseMoved', x0, y0, o)
  await c.mouse('mousePressed', x0, y0, o)
  for (let n = 1; n <= steps; n++) {
    await c.mouse('mouseMoved', x0 + ((x1 - x0) * n) / steps, y0 + ((y1 - y0) * n) / steps, { ...o, down: true })
    await c.sleep(24)
  }
  await c.sleep(120)
  if (o.mid) await o.mid()
  await c.mouse('mouseReleased', x1, y1, o)
  await c.sleep(150)
}

/** The colour of the preview canvas at a point of the window: [r, g, b]. */
export const pixel = (c, x, y) => c.run((x, y) => {
  const cv = document.querySelector('[data-testid="preview.canvas"]')
  const r = cv.getBoundingClientRect()
  const dpr = cv.width / r.width
  const d = cv.getContext('2d').getImageData(Math.round((x - r.left) * dpr), Math.round((y - r.top) * dpr), 1, 1).data
  return [d[0], d[1], d[2]]
}, x, y)

/** The frame recorder (scripts/perf/interact.mjs): the main thread's work per
 *  frame, the input events' tasks counted in. */
export const installRecorder = (c) => c.run(() => {
  if (window.__yzFrames) return true
  const F = { on: false, frames: [], acc: 0, lastEnd: 0 }
  const queue = []
  const ch = new MessageChannel()
  ch.port1.onmessage = () => {
    const it = queue.shift()
    const now = performance.now()
    const d = Math.max(0, now - Math.max(it.t, F.lastEnd))
    F.lastEnd = now
    if (it.f) { it.f[1] += d; it.f[2] = 1 } else F.acc += d
  }
  const mark = () => { if (!F.on) return; queue.push({ t: performance.now() }); ch.port2.postMessage(0) }
  for (const type of ['pointermove', 'wheel', 'scroll', 'pointerdown', 'pointerup', 'keydown']) window.addEventListener(type, mark, { capture: true, passive: true })
  const loop = () => {
    const now = performance.now()
    const f = [now, F.acc, 0]
    F.acc = 0
    if (F.on) F.frames.push(f)
    queue.push({ t: now, f })
    ch.port2.postMessage(0)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  F.start = () => { F.frames = []; F.acc = 0; F.on = true }
  F.stop = () => {
    F.on = false
    const fr = F.frames.slice(1).filter((f) => f[2])
    return { frames: fr.map((f) => [+f[0].toFixed(2), +f[1].toFixed(2)]), gap: fr.slice(1).map((f, i) => +(f[0] - fr[i][0]).toFixed(2)) }
  }
  window.__yzFrames = F
  return true
})

/** The work per frame at 60 pictures a second (the recorded frames' work summed into 1/60 s slots). */
export const sixty = (frames) => {
  const slots = new Map()
  for (const [t, w] of frames) {
    const k = Math.floor((t - frames[0][0]) / (1000 / 60))
    slots.set(k, (slots.get(k) ?? 0) + w)
  }
  return [...slots.values()]
}
export const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q) => (s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0)
  return { med: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +(s[s.length - 1] ?? 0).toFixed(2), n: s.length }
}
