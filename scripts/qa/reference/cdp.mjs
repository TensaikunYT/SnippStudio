// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Drives the off-screen Snipp Dev window over the Chrome DevTools Protocol.
// Node 24's built-in WebSocket and fetch: no packages.
import { writeFileSync } from 'node:fs'
import { cdpEvaluate } from '../../page-eval.mjs'

export async function connect(port = 9333) {
  let targets = null
  for (let i = 0; i < 60; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      if (targets.some((t) => t.type === 'page' && !t.url.startsWith('devtools://'))) break
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  const page = targets?.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!page) throw new Error('No Snipp page on port ' + port)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  let seq = 0
  const waiting = new Map()
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id)
      waiting.delete(msg.id)
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
    }
  })
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      waiting.set(id, { res, rej })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  /** Evaluates an expression (or an async function body given as a string) in
   *  the page; a promise is awaited through a handle (scripts/page-eval.mjs). */
  const ev = (expression) => cdpEvaluate(send, expression, { userGesture: true })
  const mouse = (type, x, y, opts = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !opts.down ? 'none' : opts.button ?? 'left', buttons: type === 'mouseReleased' ? 0 : opts.buttons ?? (type === 'mouseMoved' && !opts.down ? 0 : 1), clickCount: opts.clickCount ?? (type === 'mouseMoved' ? 0 : 1), modifiers: opts.modifiers ?? 0, pointerType: 'mouse' })
  /** A drag from (x0,y0) to (x1,y1) in `steps` moves. */
  const drag = async (x0, y0, x1, y1, steps = 8, opts = {}) => {
    await mouse('mouseMoved', x0, y0)
    await mouse('mousePressed', x0, y0, opts)
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, { ...opts, down: true })
      await sleep(16)
    }
    await mouse('mouseReleased', x1, y1, opts)
    await sleep(60)
  }
  const click = async (x, y, opts = {}) => {
    await mouse('mouseMoved', x, y)
    await mouse('mousePressed', x, y, opts)
    await mouse('mouseReleased', x, y, opts)
    await sleep(60)
  }
  const key = async (k, code = undefined, modifiers = 0) => {
    const vk = k.length === 1 ? k.toUpperCase().charCodeAt(0) : { Enter: 13, Escape: 27, Delete: 46, Backspace: 8 }[k] ?? 0
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code ?? (k.length === 1 ? 'Key' + k.toUpperCase() : k), windowsVirtualKeyCode: vk, modifiers, text: k.length === 1 && !modifiers ? k : k === 'Enter' ? '\r' : undefined })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code ?? (k.length === 1 ? 'Key' + k.toUpperCase() : k), windowsVirtualKeyCode: vk, modifiers })
    await sleep(60)
  }
  const type = async (text) => {
    await send('Input.insertText', { text })
    await sleep(60)
  }
  const shot = async (file, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })
    writeFileSync(file, Buffer.from(r.data, 'base64'))
    return file
  }
  /** The centre and box of the first element matching a selector. */
  const rect = (selector, index = 0) => ev(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } })()`)
  /** After a page reload Snipp offers the autosaved snapshot of the test
   *  project ("didn't shut down cleanly"): discarded, so it does not sit over
   *  the editor. Waits a moment for it to appear. */
  const dismissRecovery = async (waitMs = 2500) => {
    for (let t = 0; t < waitMs; t += 150) {
      const done = await ev(`(() => { const b = document.querySelector('[data-testid="ask.recovery.discard"]'); if (!b) return false; b.click(); return true })()`).catch(() => false)
      if (done) return true
      await sleep(150)
    }
    return false
  }
  const close = () => ws.close()
  return { send, ev, mouse, drag, click, key, type, shot, rect, sleep, close, dismissRecovery }
}
