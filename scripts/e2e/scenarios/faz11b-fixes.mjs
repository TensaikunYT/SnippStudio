// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11b, the usability audit's findings checked in a real window:
// U3 (an empty timeline: the export check says so and Export is off), U1 (the
// project name in the top bar has room for the marks of İ, Ö, Ğ), U10 (↑ in a
// camera-look field with nothing selected makes ONE layer and the focus stays
// in the field), U2 (the tour's bubble keeps off Play and the time in steps
// 2 and 3).
export const name = 'faz11b-fixes'

async function reloadUnseen(c, lib) {
  await c.run(() => { localStorage.removeItem('snipp-tour-seen'); window.__store.getState().setDirty(false); return true })
  await c.send('Page.reload', { ignoreCache: false })
  await c.sleep(300)
  await lib.ready(c)
  for (let i = 0; i < 10; i++) {
    if (await c.has('ask.recovery')) {
      await c.click('ask.recovery.discard')
      break
    }
    await c.sleep(100)
  }
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const out = {}

  // ---- U3: an empty timeline -------------------------------------------------
  assert.equal(await c.st((s) => Object.keys(s.project.clips).length), 0, 'a new project')
  await c.click('topbar.export')
  await c.waitId('dialog.export')
  await c.waitId('export.empty', 5000)
  out.u3 = { said: await c.ev(`document.querySelector('[data-testid="export.empty"]').textContent`), disabled: await c.ev(`document.querySelector('[data-testid="export.start"]').disabled`) }
  assert.match(out.u3.said, /timeline is empty/i)
  assert.equal(out.u3.disabled, true, 'Export is off')
  await c.click('export.cancel')
  await c.waitGone('dialog.export')

  // ---- U1: the name's marks ---------------------------------------------------
  await c.run(() => { window.__store.getState().setProjectName?.('Örnek İş Ğüzel') ?? window.__store.setState((s) => ({ project: { ...s.project, name: 'Örnek İş Ğüzel' } })); return true })
  await c.sleep(150)
  out.u1 = await c.run(() => {
    const el = document.querySelector('.tb-name-text')
    if (!el) return null
    const fs = parseFloat(getComputedStyle(el).fontSize)
    return { text: el.textContent, h: el.clientHeight, fs }
  })
  assert.ok(out.u1 && out.u1.text.includes('Örnek'), JSON.stringify(out.u1))
  assert.ok(out.u1.h >= out.u1.fs * 1.3, `the line has room over the capitals (${out.u1.h} px for ${out.u1.fs} px type)`)

  // ---- U10: ↑ in a camera-look field, nothing selected -------------------------
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run(() => { window.__store.setState({ selectedClipIds: [] }); window.__store.getState().setTime(1); return true })
  await c.click('inspector.tab.fx')
  const before = await c.st((s) => Object.keys(s.project.clips).length)
  const label = await c.run(() => {
    const el = [...document.querySelectorAll('input')].find((x) => x.getAttribute('aria-label') === 'Grain value' && x.offsetParent !== null)
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    el.focus()
    return el.getAttribute('aria-label')
  })
  assert.equal(label, 'Grain value', 'the Grain field')
  await c.key('ArrowUp')
  await c.sleep(300)
  await c.key('ArrowUp')
  await c.sleep(300)
  out.u10 = {
    clips: (await c.st((s) => Object.keys(s.project.clips).length)) - before,
    focus: await c.ev(`document.activeElement?.tagName + ':' + (document.activeElement?.getAttribute('aria-label') ?? '')`),
    grain: await c.st((s) => Object.values(s.project.clips).find((k) => k.adjustment)?.cameraLook?.grain ?? null)
  }
  assert.equal(out.u10.clips, 1, 'one look layer')
  assert.equal(out.u10.focus, 'INPUT:Grain value', 'the focus stays in the field')
  // (Two steps of 1 % since arayüz v4's slider steps, 5 % before: the first ↑
  // makes the layer at 1 %, the second writes 2 % onto it. Had the second
  // gone anywhere else, the layer would still hold 1 %.)
  assert.ok(out.u10.grain > 0.015, `the second ↑ went to the layer (${out.u10.grain})`)

  // ---- U2: the tour keeps off Play and the time --------------------------------
  await reloadUnseen(c, lib)
  await c.waitId('tour', 6000)
  out.u2 = []
  for (let i = 0; i < 3; i++) {
    const step = await c.attr('tour', 'data-step')
    await c.sleep(450) // (it follows its part every 400 ms)
    const over = await c.run(() => {
      const b = document.querySelector('[data-testid="tour"]').getBoundingClientRect()
      const hit = (id) => {
        const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect()
        return !!r && r.width > 0 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top
      }
      return { play: hit('transport.play'), start: hit('transport.start'), vw: innerWidth, vh: innerHeight }
    })
    out.u2.push({ step, ...over })
    if (step === 'timeline' || step === 'preview') assert.ok(!over.play && !over.start, `step ${step}: Play and Start in sight (${JSON.stringify(over)})`)
    await c.click('tour.next')
    await c.sleep(150)
  }
  await c.key('Escape')
  return out
}
