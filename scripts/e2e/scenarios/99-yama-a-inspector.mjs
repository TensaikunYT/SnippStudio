// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The interface audit's patch, worker A (tarifler\YAMA-ARAYUZ.md): the
// Inspector.
//   - G1: with the agent switched on, an empty command box is one line too;
//     the Inspector's body is tall again (1920×1080 and 1366×768); a click
//     opens it, text keeps it open, a waiting draft keeps it open;
//   - G5: each tab opens where it was left (the first time at its top);
//   - G8: the In / Out / Idle choices say names, not ids;
//   - G2: the transition panel's "Play the cut" and "Remove" are readable
//     (English and Turkish);
//   - E4: "(Delete)" in the remove tip only where Delete removes it;
//   - E3: arrows after a mouse click on a speed mode step the frame, they do
//     not throw the curve away;
//   - G11: the speed curve's graph is at least 160 px, its shapes readable;
//   - 14: a curve point shows its own focus ring and the arrows nudge it; a
//     flat curve wears no "1–1×" badge.
// Each part is checked on its own (one that fails is said, the next runs).
import { status } from '../session.mjs'
export const name = 'yama-a-inspector'

const BIG = { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }
const SMALL = { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false }

/** Is the text of this element (or of its label span) cut? */
const cut = (c, id) =>
  c.run((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`)
    if (!el) return 'missing'
    const parts = [el, ...el.querySelectorAll('span')]
    const bad = parts.filter((p) => p.scrollWidth > p.clientWidth + 1 && p.clientWidth > 0)
    const r = el.getBoundingClientRect()
    return bad.length ? `cut (${Math.round(r.width)} px)` : r.width < 40 ? `narrow (${Math.round(r.width)} px)` : null
  }, id)

/** The tip a hover on this element shows (read through aria-describedby). */
async function tipOf(c, id) {
  const b = await c.box(id)
  await c.mouse('mouseMoved', b.cx, b.cy)
  const text = await c.waitFor(`the tip of ${id}`, () =>
    c.run((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`)
      const of = el?.getAttribute('aria-describedby')
      return of ? document.getElementById(of)?.textContent ?? null : null
    }, id), 4000)
  await c.mouse('mouseMoved', 5, 5)
  await c.sleep(100)
  return text
}

const intoView = (c, id, block = 'nearest') => c.run((id, block) => document.querySelector(`[data-testid="${id}"]`)?.scrollIntoView({ block }), id, block)

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  // (Cards fold by default per kind of selection since kullanım, item 5.)
  await lib.openCards(c, ['Clip', 'Speed', 'Motion', 'Audio', 'Opacity'])
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  const [first, second] = await lib.clipList(c)
  const body = async () => (await c.byRole('tabpanel', 'Clip'))?.h ?? 0
  const failed = []
  const step = async (what, fn) => {
    try {
      await fn()
    } catch (e) {
      const said = String(e?.message ?? e).split('\n')[0]
      failed.push(`${what}: ${said}`)
      console.log(`     FAILED ${what}: ${said}`)
      await c.send('Emulation.setDeviceMetricsOverride', BIG).catch(() => undefined)
      await c.run(() => window.__store.getState().setUiLang('en')).catch(() => undefined)
    }
  }
  try {
    // ---- G1: the command box with the agent on --------------------------------
    await step('G1', async () => {
      await c.waitFor('the agent on', async () => !!(await status(c)).server?.running && (await c.attr('agent.switch', 'aria-checked')) === 'true')
      await c.st((s, id) => s.selectClips([id]), first.id)
      await c.click('inspector.tab.clip')
      await c.sleep(300)
      const big = await body()
      await c.send('Emulation.setDeviceMetricsOverride', SMALL)
      await c.sleep(400)
      const small = await body()
      await c.send('Emulation.setDeviceMetricsOverride', BIG)
      await c.sleep(300)
      console.log(`     G1: Inspector body ${Math.round(big)} px at 1080, ${Math.round(small)} px at 768 (agent on, box empty: folded ${await c.attr('agent.box', 'data-folded')})`)
      assert.equal(await c.attr('agent.box', 'data-folded'), 'true', 'empty and left alone: one line')
      assert.ok(big >= 450, `the body at 1080 (${big})`)
      assert.ok(small >= 280, `the body at 768 (${small})`)
      // A click opens it with the focus in its text (GONDER: the box takes a
      // job in words first; the ready jobs follow); left: one line.
      await c.click('agent.box.open')
      await c.waitFor('open', async () => (await c.attr('agent.box', 'data-folded')) === 'false')
      assert.equal(await lib.focused(c), 'agent.box.text')
      await lib.seek(c, 2)
      await c.waitFor('folded again', async () => (await c.attr('agent.box', 'data-folded')) === 'true')
      // A waiting draft keeps it open (its line says the draft is ready).
      await c.run(() => window.__agent.setMode('draft'))
      await lib.openBox(c)
      await c.click('agent.ready.silences')
      await c.waitFor('a draft', () => c.run(() => !!window.__agent.store.getState().draft), 15000)
      await lib.seek(c, 3)
      await c.sleep(300)
      const folded = await c.attr('agent.box', 'data-folded')
      console.log(`     G1: with a draft waiting the box is ${folded === 'true' ? 'folded' : 'open'}`)
      await c.click('inspector.tab.agent')
      await c.click('agent.draft.reject')
      await c.waitGone('agent.draft')
      // (D22, worker C, the audit's A3: a waiting draft no longer holds the box
      // open: it is reviewed in the strip over the timeline, the Inspector keeps its room.)
      assert.equal(folded, 'true', 'a waiting draft does not hold the box open')
      await lib.seek(c, 0.5)
      await c.waitFor('folded after the draft', async () => (await c.attr('agent.box', 'data-folded')) === 'true')
    })

    // ---- G5: each tab opens where it was left ------------------------------------
    await step('G5', async () => {
      await c.st((s, id) => s.selectClips([id]), first.id)
      await c.click('inspector.tab.clip')
      const scroll = (top) => c.run((top) => { const b = document.querySelector('.inspector [role="tabpanel"]'); if (top !== null) b.scrollTop = top; return b.scrollTop }, top)
      const clipTop = await scroll(300)
      await c.click('inspector.tab.fx')
      await c.sleep(150)
      const lookTop = await scroll(null)
      await scroll(80)
      await c.click('inspector.tab.clip')
      await c.sleep(150)
      const backTop = await scroll(null)
      console.log(`     G5: Clip scrolled to ${clipTop}; Look opens at ${lookTop}; back on Clip at ${backTop}`)
      await scroll(0)
      assert.equal(lookTop, 0, 'Look opens at its top')
      assert.equal(backTop, clipTop, 'Clip opens where it was left')
    })

    // ---- G8: the motion choices say names ------------------------------------------
    await step('G8', async () => {
      await c.st((s, id) => s.selectClips([id]), first.id)
      await c.click('inspector.tab.clip')
      const names = await c.run(() => {
        const sel = document.querySelector('[data-testid="inspector.clip.motion.in"]') ?? document.querySelector('[data-section="motion"] select')
        return sel ? [...sel.options].map((o) => [o.value, o.textContent]) : null
      })
      assert.ok(names, 'the Entrance choice')
      const raw = names.filter(([v, l]) => v !== 'none' && l === v)
      console.log(`     G8: entrances ${names.slice(0, 4).map(([, l]) => l).join(', ')}…; raw ids ${raw.length}`)
      assert.deepEqual(raw, [], 'no raw id among the entrances')
      await c.select('inspector.clip.motion.in', 'ramp-right')
      await c.sleep(100)
      const said = await c.run(() => document.querySelector('[data-testid="inspector.clip.motion.part.in"]')?.textContent ?? '')
      await c.key('z', ['ctrl'])
      assert.ok(said && !/·\s*right$/.test(said), `the part names the entrance (${said})`)
    })

    // ---- G2 and E4: the transition panel --------------------------------------------
    await step('G2', async () => {
      await c.st((s) => s.selectClips([]))
      await c.click(`timeline.junction.${first.id}.add`, { force: true })
      await c.waitId('inspector.trans.play')
      const seen = []
      for (const lang of ['en', 'tr']) {
        await c.run((l) => window.__store.getState().setUiLang(l), lang)
        await c.sleep(150)
        for (const id of ['inspector.trans.play', 'inspector.trans.remove']) {
          await intoView(c, id)
          seen.push([`${id} (${lang})`, await cut(c, id)])
        }
      }
      await c.run(() => window.__store.getState().setUiLang('en'))
      await c.sleep(100)
      console.log(`     G2: ${seen.map(([k, v]) => `${k} ${v ?? 'ok'}`).join('; ')}`)
      assert.deepEqual(seen.filter(([, v]) => v), [], 'readable')
    })
    await step('E4', async () => {
      if (!(await c.has('inspector.trans.remove'))) {
        await c.st((s) => s.selectClips([]))
        await c.click(`timeline.junction.${first.id}.block`, { force: true })
      }
      // Selected on the timeline: Delete removes it, the tip says so.
      await intoView(c, 'inspector.trans.remove')
      const aloneTip = await tipOf(c, 'inspector.trans.remove')
      // Under a selected clip: Delete removes the clip, so the tip does not say Delete.
      await c.st((s, id) => s.selectClips([id]), first.id)
      await c.click('inspector.tab.clip')
      // (Under a clip the section is folded until opened: opened here, folded again after.)
      await c.waitId('inspector.trans.head')
      const folded = (await c.attr('inspector.trans.head', 'aria-expanded')) === 'false'
      if (folded) await c.click('inspector.trans.head')
      await c.waitId('inspector.trans.remove')
      await intoView(c, 'inspector.trans.remove')
      const clipTip = await tipOf(c, 'inspector.trans.remove')
      if (folded) await c.click('inspector.trans.head')
      console.log(`     E4: tip with the transition selected "${aloneTip}"; under a selected clip "${clipTip}"`)
      assert.match(aloneTip, /Delete/, 'the selected transition\'s tip says Delete')
      assert.doesNotMatch(clipTip, /Delete/, 'the tip under a selected clip does not')
    })

    // ---- E3: arrows after a click on a speed mode --------------------------------------
    await step('E3', async () => {
      await c.st((s, id) => s.setClipSpeedCurve(id, { points: [{ u: 0, v: 0.5 }, { u: 0.5, v: 3 }, { u: 1, v: 0.5 }] }), second.id)
      await c.st((s, id) => s.selectClips([id]), second.id)
      await c.click('inspector.tab.clip')
      await c.waitId('inspector.clip.speed.mode.curve')
      await lib.seek(c, 1)
      const t0 = await c.st((s) => s.currentTime)
      await intoView(c, 'inspector.clip.speed.mode.curve')
      await c.click('inspector.clip.speed.mode.curve')
      await c.key('ArrowRight')
      const after = await c.st((s, id) => ({ curve: !!s.project.clips[id].speedCurve, t: s.currentTime }), second.id)
      console.log(`     E3: after a click on "Curve" and →: curve ${after.curve ? 'kept' : 'gone'}, time ${t0} → ${after.t}`)
      if (!after.curve) await c.key('z', ['ctrl'])
      assert.equal(after.curve, true, 'the curve is kept')
      assert.ok(after.t > t0, 'the arrow stepped the frame')
    })

    // ---- G11: the curve's graph and its shapes ------------------------------------------
    await step('G11', async () => {
      await c.st((s, id) => s.setClipSpeedCurve(id, { points: [{ u: 0, v: 0.5 }, { u: 0.5, v: 3 }, { u: 1, v: 0.5 }] }), second.id)
      await c.st((s, id) => s.selectClips([id]), second.id)
      await c.waitId('inspector.clip.speed.curve')
      const graph = await c.box('inspector.clip.speed.curve')
      const seen = []
      for (const lang of ['en', 'tr']) {
        await c.run((l) => window.__store.getState().setUiLang(l), lang)
        await c.sleep(150)
        for (const p of ['ease-in', 'ease-out', 'slow-middle', 'fast-middle', 'pulse']) {
          const id = `inspector.clip.speed.curve.preset.${p}`
          await intoView(c, id)
          const v = await cut(c, id)
          if (v) seen.push(`${p} (${lang}) ${v}`)
        }
      }
      await c.run(() => window.__store.getState().setUiLang('en'))
      await c.sleep(100)
      console.log(`     G11: graph ${graph?.h} px; shapes cut: ${seen.length ? seen.join(', ') : 'none'}`)
      assert.ok(graph && graph.h >= 160, `the graph is at least 160 px (${graph?.h})`)
      assert.deepEqual(seen, [], 'every shape readable')
    })

    // ---- 14: the point's focus ring and its arrows ----------------------------------------
    await step('14-point', async () => {
      await c.st((s, id) => s.setClipSpeedCurve(id, { points: [{ u: 0, v: 0.5 }, { u: 0.5, v: 3 }, { u: 1, v: 0.5 }] }), second.id)
      await c.st((s, id) => s.selectClips([id]), second.id)
      const pointId = 'inspector.clip.speed.curve.point.1'
      await c.waitId(pointId)
      await intoView(c, pointId, 'center')
      await c.click(pointId)
      const look = (id) => c.run((id) => { const el = document.querySelector(`[data-testid="${id}"]`); const cs = getComputedStyle(el); return { stroke: cs.stroke, width: cs.strokeWidth, fv: el.matches(':focus-visible'), focused: document.activeElement === el } }, id)
      const mouseLook = await look(pointId)
      await c.run(() => { document.querySelector('[data-testid="inspector.clip.speed.curve.point.0"]').focus(); return true })
      await c.key('Tab')
      const keyLook = await look(pointId)
      console.log(`     14: a clicked point ${JSON.stringify(mouseLook)}; reached by Tab ${JSON.stringify(keyLook)}`)
      const before = await c.st((s, id) => JSON.stringify(s.project.clips[id].speedCurve), second.id)
      const tBefore = await c.st((s) => s.currentTime)
      await c.key('ArrowRight')
      const nudged = await c.st((s, id) => JSON.stringify(s.project.clips[id].speedCurve), second.id)
      const tAfter = await c.st((s) => s.currentTime)
      console.log(`     14: → on a point: curve ${nudged === before ? 'same' : 'changed'}, time ${tBefore} → ${tAfter}`)
      assert.equal(keyLook.focused, true, 'Tab reaches the next point')
      assert.ok(keyLook.stroke !== mouseLook.stroke || keyLook.width !== mouseLook.width, 'the keyboard focus looks other than the selection')
      assert.notEqual(nudged, before, '→ moves the point')
      assert.equal(tAfter, tBefore, '→ on a point does not move the playhead')
    })
    await step('14-badge', async () => {
      await c.st((s, id) => s.setClipSpeedCurve(id, { points: [{ u: 0, v: 1 }, { u: 1, v: 1 }] }), second.id)
      await c.sleep(150)
      const badge = await c.run((id) => document.querySelector(`[data-testid="timeline.clip.${id}.curve-badge"]`)?.textContent ?? null, second.id)
      console.log(`     14: a flat curve's badge: ${badge}`)
      assert.equal(badge, null, 'no badge on a flat curve')
    })
  } finally {
    await c.send('Emulation.setDeviceMetricsOverride', BIG)
    await c.run(() => window.__store.getState().setUiLang('en')).catch(() => undefined)
  }
  assert.deepEqual(failed, [], 'every part')
}
