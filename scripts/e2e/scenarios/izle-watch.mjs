// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Dalga 3, İ: the watch-and-note mode (Desktop\SnippStudio\IZLE-PLAN.md).
// The top bar's "Watch": the panels give way to the film, a thin strip and a
// list. Three notes by mouse (a double click on the picture, a drag on the strip,
// the pen), three by keyboard alone (Shift+R, N, Tab to a kind, Enter),
// Ctrl+Enter sends them, a scripted agent over real HTTP takes and answers
// them, "Watch what changed" runs on the same screen to its end, a draft
// is one press away from its review strip, and Esc gives the editor back
// exactly as it was (panels, tab, selection, timeline scroll, preview zoom).
// Then the same screen at 1920 x 1080 and 1366 x 768, English and Turkish,
// motion on and off: nothing cut, nothing over anything, nothing outside the
// window. Pictures: tasarim\karsilastirma\izle\ with SNIPP_SCREENS_IZLE=1,
// else the run's own folder.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DIR } from '../app.mjs'
import { connectAgent, versionOf } from '../agent-client.mjs'
import { accessOn } from '../session.mjs'
export const name = 'izle-watch'
export const timeoutMs = 420_000

export async function run({ c, app, media, lib, out }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SCREENS_IZLE ? join(APP_DIR, '..', 'tasarim', 'karsilastirma', 'izle') : join(out, 'izle')
  mkdirSync(dir, { recursive: true })
  const size = (width, height) => c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const lang = (l) => c.run((l) => window.__store.getState().setUiLang(l), l)
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await accessOn(c)
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await c.run(() => window.__agent.setMode('direct'))
  await lang('en')

  // ---- the editor as the user left it: a tab, a selected clip, a scrolled timeline, a zoomed preview.
  await c.click('inspector.tab.clip')
  await c.st((s) => { s.selectClip(Object.keys(s.project.clips)[0]); s.setTime(2) })
  await c.st((s) => s.setPxPerSec?.(160))
  await c.sleep(200)
  await c.run(() => { const el = document.querySelector('.tl-scroll'); el.scrollLeft = 240 })
  await c.st((s) => s.setPreviewView({ zoom: 1.4, x: 30, y: -10 }))
  await c.sleep(200)
  const layout = () =>
    c.run(() => {
      const s = window.__store.getState()
      const tl = document.querySelector('.tl-scroll')
      const r = (sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)].join(',') : null }
      return {
        tab: document.querySelector('[data-testid^="inspector.tab."][aria-selected="true"]')?.dataset.testid ?? null,
        sel: s.selectedClipIds.join(','),
        scroll: [Math.round(tl.scrollLeft), Math.round(tl.scrollTop)],
        view: s.previewView,
        tool: s.noteTool,
        dock: r('.workspace-dock'), inspector: r('.inspector'), timeline: r('.app > .timeline'), preview: r('.main > .preview'),
        previewInEditor: !!document.querySelector('.main .preview-host')
      }
    })
  const before = await layout()
  assert.equal(before.tab, 'inspector.tab.clip')
  assert.ok(before.scroll[0] > 100, `the timeline scrolled (${before.scroll})`)
  const restored = async (what) => {
    await c.waitGone('watch')
    await c.sleep(250)
    const now = await layout()
    assert.deepEqual(now, before, `${what}: the editor is back as it was`)
  }

  const frameAt = async (fx, fy) => {
    const layer = await c.box('notes.draw.layer')
    const f = await c.st((s) => s.project.settings)
    const fw = Math.min(layer.w, (layer.h * f.width) / f.height)
    const fh = (fw * f.height) / f.width
    return [layer.x + (layer.w - fw) / 2 + fw * fx, layer.y + (layer.h - fh) / 2 + fh * fy]
  }
  const notes = () => c.st((s) => (s.project.notes ?? []).map((n) => ({ num: n.num, kind: n.kind, text: n.text, start: +n.start.toFixed(2), end: +n.end.toFixed(2), status: n.status, shapes: (n.shapes ?? []).map((x) => x.type).join(',') })))
  const typeInBubble = async (text) => {
    await c.waitId('watch.bubble.text')
    await c.waitFor('the box has the keyboard', async () => (await lib.focused(c)) === 'watch.bubble.text', 3000)
    await c.type(text)
  }
  // (Toasts left from the steps before are not part of the picture.)
  const clearToasts = () => c.run(() => document.querySelectorAll('[data-testid="toast.stack"] [data-testid$=".dismiss"]').forEach((b) => b.click()))
  const shot = async (n) => {
    await clearToasts()
    // (The pointer off the last button pressed: its tooltip is not the picture's.)
    await c.mouse('mouseMoved', 2, 300)
    await c.sleep(600)
    await c.shot(join(dir, n))
  }

  // ---- 1. In, by the top bar's button.
  await c.click('topbar.watch')
  await c.waitId('watch')
  assert.equal(await c.attr('topbar.watch', 'aria-pressed'), 'true')
  assert.equal(await c.run(() => getComputedStyle(document.querySelector('.main')).visibility), 'hidden', 'the editor is under the layer')
  assert.equal(await c.run(() => !!document.querySelector('[data-testid="watch.screen"] .preview-host')), true, 'the one preview moved in')
  assert.deepEqual(await c.st((s) => s.previewView), { zoom: 1, x: 0, y: 0 }, 'the whole frame')
  assert.equal(await c.st((s) => s.noteTool), 'pin', 'the pin is in hand')
  assert.equal(await c.attr('watch.primary', 'data-kind'), 'send')
  assert.equal(await c.attr('watch.primary', 'disabled'), '', 'nothing to send yet')

  // ---- 2. Three notes by mouse.
  // a. (kullanım, item 6) A click on the picture plays or stops the film
  // and leaves no note; a double click while it plays: it stops, a pin, the
  // box; Enter plays on.
  await c.clickAt(...(await frameAt(0.62, 0.34)), { after: 500 })
  assert.equal(await c.st((s) => s.playing), true, 'a click plays the film')
  assert.equal(await c.has('watch.bubble'), false, 'a click is not a note')
  await c.clickAt(...(await frameAt(0.62, 0.34)), { after: 500 })
  assert.equal(await c.st((s) => s.playing), false, 'a second click stops it')
  assert.equal((await notes()).length, 0, 'no note from clicks')
  await c.click('watch.play')
  await c.waitFor('playing', () => c.st((s) => s.playing))
  await c.sleep(400)
  await c.clickAt(...(await frameAt(0.62, 0.34)), { double: true })
  assert.equal(await c.st((s) => s.playing), false, 'the double click stops the film')
  await typeInBubble('The title comes in too early')
  await c.key('Enter')
  await c.waitGone('watch.bubble')
  assert.equal(await c.st((s) => s.playing), true, 'Enter plays on')
  await c.click('watch.play')
  let list = await notes()
  assert.equal(list.length, 1)
  assert.equal(list[0].kind, 'fix')
  assert.equal(list[0].shapes, 'pin')
  // b. A drag on the strip: a range note; the kind by its chip.
  const strip = await c.box('watch.strip')
  await c.dragAt(strip.x + strip.w * 0.3, strip.y + strip.h / 2, strip.x + strip.w * 0.45, strip.y + strip.h / 2)
  await typeInBubble('Too long here, halve it')
  await c.click('watch.kind.cut')
  assert.equal(await lib.focused(c), 'watch.bubble.text', 'a chip gives the keyboard back to the words')
  await c.key('Enter')
  await c.waitGone('watch.bubble')
  list = await notes()
  assert.equal(list.length, 2)
  const range = list.find((n) => n.text === 'Too long here, halve it')
  assert.equal(range.kind, 'cut')
  assert.ok(range.end - range.start > 1, `a range (${range.start}–${range.end})`)
  // c. The pen: a stroke on the frame, then the words.
  await c.st((s) => s.setTime(1))
  await c.click('watch.pen')
  assert.equal(await c.st((s) => s.noteTool), 'pen')
  await c.dragAt(...(await frameAt(0.2, 0.6)), ...(await frameAt(0.4, 0.7)))
  await typeInBubble('A small animation here')
  await c.click('watch.kind.animate')
  await c.key('Enter')
  await c.waitGone('watch.bubble')
  list = await notes()
  assert.equal(list.length, 3)
  assert.equal(list.find((n) => n.text === 'A small animation here').shapes, 'pen')
  assert.equal(await c.st((s) => s.noteTool), 'pin', 'the pin again after a save')
  // Esc with a box open lets that note go.
  await c.clickAt(...(await frameAt(0.5, 0.5)), { double: true })
  await c.waitId('watch.bubble')
  await c.key('Escape')
  await c.waitGone('watch.bubble')
  assert.equal((await notes()).length, 3, 'Esc: no note')
  assert.ok(await c.has('watch'), 'Esc in the box does not leave the mode')
  // An edit key is quiet while watching: S does not split, Delete does not take the selected clip.
  const clips = await c.st((s) => Object.keys(s.project.clips).length)
  await c.key('s')
  await c.st((s) => s.selectNote(null))
  await c.key('Delete')
  assert.equal(await c.st((s) => Object.keys(s.project.clips).length), clips, 'the film is not edited from the watch mode')

  // ---- 3. Esc: the editor exactly as it was.
  await c.key('Escape')
  await restored('Esc')
  assert.equal(await c.attr('topbar.watch', 'aria-pressed'), 'false')

  // ---- 4. Three notes by keyboard alone.
  await c.run(() => document.activeElement?.blur?.())
  await c.key('R', ['shift'])
  await c.waitId('watch')
  const kinds = ['free', 'fix', 'cut']
  for (let i = 0; i < 3; i++) {
    await c.key('ArrowRight', ['shift'])
    await c.key('ArrowRight', ['shift'])
    await c.key('n')
    await typeInBubble(`Keyboard note ${i + 1}`)
    // Tab to the chip, Space presses it (the words get the keyboard back).
    const tabs = { fix: 1, cut: 2, animate: 3, free: 4 }[kinds[i]]
    const went = []
    for (let k = 0; k < tabs; k++) { await c.key('Tab'); went.push(await lib.focused(c)) }
    assert.equal(went.at(-1), `watch.kind.${kinds[i]}`, `Tab went ${went.join(' > ')}`)
    await c.key(' ')
    await c.waitFor('back in the words', async () => (await lib.focused(c)) === 'watch.bubble.text', 2000)
    await c.key('Enter')
    await c.waitGone('watch.bubble')
  }
  list = await notes()
  assert.equal(list.length, 6)
  assert.deepEqual([1, 2, 3].map((i) => list.find((n) => n.text === `Keyboard note ${i}`).kind).join(' '), kinds.join(' '), 'the kinds the keyboard chose')
  await shot('1920-en-03-liste-dolu.png')

  // ---- 5. Ctrl+Enter sends; a scripted agent takes the notes and answers them.
  await c.key('Enter', ['ctrl'])
  await c.waitFor('in line for the agent', async () => (await c.attr('watch.primary', 'disabled')) === '')
  const ag = await connectAgent({ c, app, assert, client: 'izle-watch' })
  const got = await ag.call('wait', { seconds: 20 })
  assert.match(got.text, /6 notes sent/)
  await c.waitFor('with the agent', async () => (await notes()).every((n) => n.status === 'agent'))
  await ag.call('project')
  await c.waitId('agent.bar', 5000)
  assert.equal(await c.run(() => !!document.querySelector('[data-testid="watch"] [data-testid="agent.bar"]')), true, 'the agent bar on the watch screen')
  await shot('1920-en-04-ajan-calisirken.png')
  list = await notes()
  await ag.call('notes', { update: list.map((n) => ({ id: n.num, status: 'ready', reply: `Done #${n.num}.`, touched: [[n.start, Math.max(n.end, n.start + 0.6)]] })) })
  await c.waitFor('the review is the next step', async () => (await c.attr('watch.primary', 'data-kind')) === 'review')

  // ---- 6. "Watch what changed" on this screen, to its end: Y, a click, "still there".
  await c.click('watch.primary')
  await c.waitId('review.bar')
  assert.equal(await c.run(() => !!document.querySelector('[data-testid="watch.screen"] [data-testid="review.bar"]')), true, 'the review under the film, here')
  await shot('1920-en-05-tur.png')
  for (let i = 0; i < 6; i++) {
    if (!(await c.has('review.bar'))) break
    if (i === 2) {
      await c.click('review.still')
      await c.fill('review.still.why', 'still early')
      await c.key('Enter')
    } else if (i % 2 === 0) await c.key('y')
    else await c.click('review.approve')
    await c.sleep(150)
  }
  await c.waitGone('review.bar')
  list = await notes()
  assert.equal(list.filter((n) => n.status === 'approved').length, 5)
  assert.equal(list.filter((n) => n.status === 'still').length, 1)
  assert.equal(await c.attr('watch.primary', 'data-kind'), 'send', 'the one sent back can go again')
  assert.ok(await c.has('watch'), 'the review ended on the watch screen')

  // ---- 7. A draft: one press to its review strip (the mode closes).
  await c.run(() => window.__agent.setMode('draft'))
  const p = await ag.call('project')
  await ag.call('edit', { ops: [{ op: 'text.add', time: 0.5, text: 'Agent title' }], base: versionOf(p.text) })
  await c.waitFor('the draft is the next step', async () => (await c.attr('watch.primary', 'data-kind')) === 'draft')
  await c.click('watch.primary')
  await c.waitGone('watch')
  await c.waitId('agent.draft')
  await c.click('agent.draft.reject')
  await c.waitGone('agent.draft')
  await c.run(() => window.__agent.setMode('direct'))
  await c.sleep(300)
  await shot('1920-en-06-cikis.png')

  // ---- 8. The same screen in every size, language and motion: whole, nothing over anything.
  const check = (tag) =>
    c.run((tag) => {
      const vw = innerWidth, vh = innerHeight
      const bad = []
      const root = document.querySelector('[data-testid="watch"]')
      for (const el of root.querySelectorAll('[data-testid], button, .watch-keys, .watch-tag, .watch-clock')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || getComputedStyle(el).visibility === 'hidden') continue
        // (A note scrolled out of the list is the list's to show, not the window's.)
        if (el.closest('.watch-list-body')) continue
        if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) bad.push(`${el.dataset.testid ?? el.className} outside the window`)
      }
      // Words cut: a button's or a label's text wider than its box (the key hint may fade out, never a button).
      for (const el of root.querySelectorAll('button, .watch-clock, .watch-list-head, .ui-chip')) {
        if (el.scrollWidth > el.clientWidth + 1) bad.push(`${el.dataset.testid ?? el.className} cut (${el.scrollWidth} > ${el.clientWidth})`)
      }
      const keys = root.querySelector('.watch-keys')
      if (keys && keys.scrollWidth > keys.clientWidth + 1) bad.push('the key hint is cut')
      // The parts do not sit on each other.
      const parts = ['watch.screen', 'watch.strip', 'watch.list', 'watch.play', 'watch.pen', 'watch.keys', 'watch.primary'].map((id) => [id, document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect()]).filter(([, r]) => r)
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const [a, ra] = parts[i], [b, rb] = parts[j]
        if (a === 'watch.list' && b === 'watch.primary') continue
        const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
        if (x > 1 && y > 1) bad.push(`${a} over ${b}`)
      }
      const bubble = document.querySelector('[data-testid="watch.bubble"]')?.getBoundingClientRect()
      const screen = document.querySelector('[data-testid="watch.screen"]').getBoundingClientRect()
      if (bubble && (bubble.left < screen.left - 1 || bubble.right > screen.right + 1 || bubble.top < screen.top - 1 || bubble.bottom > screen.bottom + 1)) bad.push('the box leaves the film')
      return bad.map((b) => `${tag}: ${b}`)
    }, tag)
  const problems = []
  const runs = [
    { w: 1920, h: 1080, l: 'en', motion: 'no-preference' },
    { w: 1920, h: 1080, l: 'tr', motion: 'no-preference' },
    { w: 1366, h: 768, l: 'tr', motion: 'no-preference' },
    { w: 1366, h: 768, l: 'en', motion: 'no-preference' },
    { w: 1920, h: 1080, l: 'tr', motion: 'reduce' },
    { w: 1366, h: 768, l: 'en', motion: 'reduce' }
  ]
  try {
    for (const r of runs) {
      const tag = `${r.w}-${r.l}${r.motion === 'reduce' ? '-hareketsiz' : ''}`
      await size(r.w, r.h)
      await lang(r.l)
      await lib.systemMotion(c, r.motion)
      await c.sleep(250)
      // In (and its fade, or none with motion off).
      await c.click('topbar.watch')
      await c.waitId('watch')
      const anim = await c.run(() => getComputedStyle(document.querySelector('[data-testid="watch"]')).animationName)
      if (r.motion === 'reduce') assert.equal(anim, 'none', `${tag}: no fade with motion off`)
      await c.st((s) => { s.setPlaying(false); s.setTime(8); s.selectNote(null) })
      await shot(`${tag}-01-giris.png`)
      problems.push(...(await check(`${tag} in`)))
      // Writing a note.
      await c.clickAt(...(await frameAt(0.61, 0.34)), { double: true })
      await typeInBubble(r.l === 'tr' ? 'Bu yazı çok erken çıkıyor' : 'This title comes in too early')
      await shot(`${tag}-02-not-yazarken.png`)
      problems.push(...(await check(`${tag} writing`)))
      await c.key('Enter')
      await c.waitGone('watch.bubble')
      await c.st((s) => s.setPlaying(false))
      // The list full (and the newest picked).
      await shot(`${tag}-03-liste-dolu.png`)
      problems.push(...(await check(`${tag} list`)))
      // The agent at work: the new note sent, taken, the project read.
      await c.click('watch.primary')
      await ag.call('wait', { seconds: 10 })
      await ag.call('project')
      await c.waitFor('the agent at work', async () => (await c.attr('agent.bar', 'data-phase')) === 'working', 5000)
      await shot(`${tag}-04-ajan-calisirken.png`)
      problems.push(...(await check(`${tag} agent`)))
      // The review.
      const last = await c.st((s) => Math.max(...s.project.notes.map((n) => n.num)))
      await ag.call('notes', { update: [{ id: last, status: 'ready', reply: 'Moved it later.', touched: [[7.5, 9]] }] })
      await c.waitFor('review next', async () => (await c.attr('watch.primary', 'data-kind')) === 'review')
      await c.click('watch.primary')
      await c.waitId('review.bar')
      await shot(`${tag}-05-tur.png`)
      problems.push(...(await check(`${tag} review`)))
      await c.click('review.approve')
      await c.waitGone('review.bar')
      // Out.
      await c.click('topbar.watch')
      await c.waitGone('watch')
      await shot(`${tag}-06-cikis.png`)
    }
  } finally {
    await lib.systemMotion(c, null)
    await size(1920, 1080)
    await lang('en')
  }
  assert.deepEqual(problems, [], 'nothing cut, outside or on top of anything')
}
