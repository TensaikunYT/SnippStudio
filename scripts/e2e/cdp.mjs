// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The test's hands on the app window, over the Chrome DevTools Protocol
// (Node's own WebSocket and fetch: no packages).
//
// Elements are found ONLY by their test name (data-testid) or by their
// accessible role and name — never by text, emoji or CSS class — so a new look
// (phase 3) does not rewrite the tests. State is read from the store
// (window.__store), which is not a way of finding elements.
import { writeFileSync } from 'node:fs'
import { SCREENSHOT_MS } from './limit.mjs'
import { cdpEvaluate } from '../page-eval.mjs'

const KEYS = {
  Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], Delete: [46, 'Delete'], Backspace: [8, 'Backspace'], Tab: [9, 'Tab'],
  ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'],
  Home: [36, 'Home'], End: [35, 'End'], ' ': [32, 'Space', ' ']
}
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

export async function connect(port) {
  let page = null
  for (let i = 0; i < 120 && !page; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://') && !t.url.startsWith('snippfilm:') && !t.url.includes('#render-worker')) ?? null
    } catch {
      /* not up yet */
    }
    if (!page) await new Promise((r) => setTimeout(r, 250))
  }
  if (!page) throw new Error('No app page on port ' + port)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  let seq = 0
  const waiting = new Map()
  const consoleErrors = []
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id)
      waiting.delete(msg.id)
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text)
    } else if (msg.method === 'Page.fileChooserOpened') {
      // The page asked for files (an <input type=file>): the next files the
      // test queued, or none (cancelled).
      const files = chooserFiles.shift() ?? []
      choosersOpened.push({ mode: msg.params.mode, files })
      if (files.length && msg.params.backendNodeId) void send('DOM.setFileInputFiles', { files, backendNodeId: msg.params.backendNodeId }).catch(() => undefined)
    }
  })
  const chooserFiles = []
  const choosersOpened = []
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      if (ws.readyState !== 1) return rej(new Error('CDP socket closed'))
      const id = ++seq
      waiting.set(id, { res, rej })
      ws.send(JSON.stringify({ id, method, params }))
    })
  await send('Runtime.enable')
  await send('DOM.enable')
  await send('Accessibility.enable')
  await send('Page.enable')
  // A file input never opens the OS chooser: the test hands it its files.
  await send('Page.setInterceptFileChooserDialog', { enabled: true })
  // One fixed window size for every run (the window itself is off-screen).
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  /** The connection's helpers; `lastStep` says what a scenario last waited
   *  for (the runner names it when a scenario runs out of time). */
  const api = { lastStep: '' }

  /** Evaluates an expression in the page (promises awaited, value returned):
   *  scripts/page-eval.mjs, which says why a promise is awaited through a
   *  handle. A promise that never settles never answers: the scenario's time
   *  limit says where it stood. */
  const ev = (expression) => cdpEvaluate(send, expression, { userGesture: true })
  /** Runs `fn` (a function, serialised) in the page with JSON args. */
  const run = (fn, ...args) => ev(`(${fn.toString()})(...${JSON.stringify(args)})`)
  /** The store's state, picked by a function run in the page: st((s) => s.project.name). */
  const st = (fn, ...args) => ev(`(${fn.toString()})(window.__store.getState(), ...${JSON.stringify(args)})`)

  const waitFor = async (what, check, timeout = 8000, every = 80) => {
    api.lastStep = 'waiting for ' + what
    const t0 = Date.now()
    let last
    while (Date.now() - t0 < timeout) {
      try {
        last = await check()
        if (last) return last
      } catch (e) {
        last = e
      }
      await sleep(every)
    }
    throw new Error(`timed out (${timeout} ms) waiting for ${what}${last instanceof Error ? ': ' + last.message : ''}`)
  }

  // ---- finding --------------------------------------------------------------
  const sel = (id) => `[data-testid=${JSON.stringify(id)}]`
  /** The box of the n-th element with this test name (null if none or hidden). */
  const box = (id, n = 0) =>
    run((s, n) => {
      const el = document.querySelectorAll(s)[n]
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return null
      return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
    }, sel(id), n)
  const count = (id) => run((s) => document.querySelectorAll(s).length, sel(id))
  const has = async (id) => !!(await box(id))
  /** Test names present now that start with a prefix (e.g. 'timeline.clip.'). */
  const ids = (prefix) => run((p) => [...document.querySelectorAll('[data-testid]')].map((e) => e.dataset.testid).filter((t) => t.startsWith(p)), prefix)
  const attr = (id, name) => run((s, a) => document.querySelector(s)?.getAttribute(a) ?? null, sel(id), name)
  const value = (id) => run((s) => document.querySelector(s)?.value ?? null, sel(id))
  const waitId = (id, timeout) => waitFor('test id ' + id, () => box(id), timeout)
  const waitGone = (id, timeout) => waitFor('test id gone ' + id, async () => !(await box(id)), timeout)

  /** An element by accessible role and name (the accessibility tree). */
  const byRole = async (role, name) => {
    const { root } = await send('DOM.getDocument', { depth: 0 })
    const { nodes } = await send('Accessibility.queryAXTree', { nodeId: root.nodeId, role, accessibleName: name })
    const n = nodes.find((x) => x.backendDOMNodeId && !x.ignored)
    if (!n) return null
    try {
      const { model } = await send('DOM.getBoxModel', { backendNodeId: n.backendDOMNodeId })
      const q = model.border
      const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]]
      const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y
      return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, backendNodeId: n.backendDOMNodeId }
    } catch {
      return null
    }
  }
  const waitRole = (role, name, timeout) => waitFor(`${role} "${name}"`, () => byRole(role, name), timeout)

  // ---- input ----------------------------------------------------------------
  const mods = (m) => (m ?? []).reduce((a, k) => a | (MOD[k] ?? 0), 0)
  const mouse = (type, x, y, o = {}) =>
    send('Input.dispatchMouseEvent', {
      type, x, y,
      button: o.button ?? (type === 'mouseMoved' && !o.down ? 'none' : 'left'),
      buttons: type === 'mouseReleased' ? 0 : type === 'mouseMoved' && !o.down ? 0 : o.button === 'right' ? 2 : 1,
      clickCount: type === 'mouseMoved' ? 0 : o.clickCount ?? 1,
      modifiers: mods(o.mods), pointerType: 'mouse'
    })
  const clickAt = async (x, y, o = {}) => {
    await mouse('mouseMoved', x, y, o)
    await mouse('mousePressed', x, y, o)
    await mouse('mouseReleased', x, y, o)
    if (o.double) {
      await mouse('mousePressed', x, y, { ...o, clickCount: 2 })
      await mouse('mouseReleased', x, y, { ...o, clickCount: 2 })
    }
    await sleep(o.after ?? 80)
  }
  const dragAt = async (x0, y0, x1, y1, o = {}) => {
    const steps = o.steps ?? 10
    await mouse('mouseMoved', x0, y0, o)
    await mouse('mousePressed', x0, y0, o)
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, { ...o, down: true })
      await sleep(16)
    }
    await mouse('mouseReleased', x1, y1, o)
    await sleep(o.after ?? 100)
  }
  const at = (b, o = {}) => [b.x + (o.fx ?? 0.5) * b.w + (o.dx ?? 0), b.y + (o.fy ?? 0.5) * b.h + (o.dy ?? 0)]
  /** A point of the element a click there would really reach (another element
   *  may cover part of it, as a user would see): the asked point if it hits,
   *  else the first of a grid of points inside that does. */
  const reachable = (id, fx, fy) =>
    run((s, fx, fy) => {
      const el = document.querySelector(s)
      if (!el) return null
      // Scrolled into its panel's view first, as a user would.
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      const hits = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e)) }
      const exact = fx !== null || fy !== null
      const tries = [[fx ?? 0.5, fy ?? 0.5]]
      if (!exact) for (const gy of [0.5, 0.3, 0.7, 0.15, 0.85]) for (const gx of [0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95]) tries.push([gx, gy])
      for (const [px, py] of tries) {
        const x = r.left + px * r.width, y = r.top + py * r.height
        if (hits(x, y)) return [x, y]
      }
      return null
    }, sel(id), fx, fy)
  /** Clicks the element with this test name (waits for it to be there and
   *  reachable; an asked point fx/fy (0..1 inside) must itself be reachable).
   *  o: fx/fy, dx/dy, button, mods, double, force (no reachability check). */
  const click = async (id, o = {}) => {
    const b = await waitId(id, o.timeout)
    if (o.dx || o.dy || o.force) return clickAt(...at(b, o), o)
    const p = await waitFor('a reachable point of ' + id, () => reachable(id, o.fx ?? null, o.fy ?? null), o.timeout ?? 4000)
    await clickAt(p[0], p[1], o)
  }
  const clickRole = async (role, name, o = {}) => {
    const b = await waitRole(role, name, o.timeout)
    await clickAt(...at(b, o), o)
  }
  const drag = async (id, dx, dy, o = {}) => {
    const b = await waitId(id, o.timeout)
    const [x, y] = at(b, o)
    await dragAt(x, y, x + dx, y + dy, o)
  }
  const key = async (k, m = []) => {
    const [vk, code, text] = KEYS[k] ?? [k.toUpperCase().charCodeAt(0), /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : /^\d$/.test(k) ? 'Digit' + k : k, k]
    const modifiers = mods(m)
    const plain = !(modifiers & (MOD.ctrl | MOD.alt | MOD.meta))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(plain && text ? { text: modifiers & MOD.shift && text.length === 1 ? text.toUpperCase() : text } : {}) })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    await sleep(80)
  }
  const type = async (text) => {
    await send('Input.insertText', { text })
    await sleep(60)
  }
  /** Puts the caret in a field (by test name), selects what is there and types over it. */
  const fill = async (id, text, o = {}) => {
    await click(id, o)
    await key('a', ['ctrl'])
    await type(String(text))
    if (o.enter) await key('Enter')
  }
  /** Sets a <select> by test name to a value (fires change the way React hears it). */
  const select = (id, v) =>
    run((s, v) => {
      const el = document.querySelector(s)
      if (!el) throw new Error('no select ' + s)
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      set.call(el, v)
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return el.value
    }, sel(id), v)
  /** Sets a range or text input by test name to a value the React way. */
  const setInput = (id, v) =>
    run((s, v) => {
      const el = document.querySelector(s)
      if (!el) throw new Error('no input ' + s)
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, String(v))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return el.value
    }, sel(id), v)
  /** Page.captureScreenshot within SCREENSHOT_MS (limit.mjs); once more after
   *  bringing the page forward and asking it for a frame; then an error, never
   *  a wait without end (a locked or switched-off screen may never present the
   *  frame the capture waits for). */
  const capture = async (params) => {
    const once = () => {
      let timer
      return Promise.race([
        send('Page.captureScreenshot', params),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('no screenshot')), SCREENSHOT_MS) })
      ]).finally(() => clearTimeout(timer))
    }
    api.lastStep = 'a screenshot'
    try {
      return await once()
    } catch {
      await Promise.race([send('Page.bringToFront').catch(() => undefined), sleep(2000)])
      await Promise.race([ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))').catch(() => undefined), sleep(2000)])
      try {
        return await once()
      } catch {
        throw new Error('the screenshot was not delivered (is the screen locked or off?)')
      }
    }
  }
  const shot = async (file) => {
    const r = await capture({ format: 'png' })
    writeFileSync(file, Buffer.from(r.data, 'base64'))
    return file
  }
  const close = () => ws.close()
  /** The files the page's next file chooser gets (an <input type=file>). */
  const chooseFiles = (files) => chooserFiles.push(files)
  Object.assign(api, {
    chooseFiles, choosersOpened,
    send, ev, run, st, sleep, waitFor, box, count, has, ids, attr, value, waitId, waitGone, byRole, waitRole,
    mouse, clickAt, dragAt, click, clickRole, drag, key, type, fill, select, setInput, shot, capture, close, consoleErrors
  })
  return api
}
