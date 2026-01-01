// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, L2 (the user's machine has Windows' "Animation effects" off:
// nothing in the program moved, and a test that expected "no motion" passed
// there). Both states of the system are emulated here, never taken from the
// machine, and for each the three choices of Settings → General → Animations:
//   - system: the interface follows the system (and its choice says "off
//     now" when the system asks for less motion);
//   - on: the interface moves whatever the system says;
//   - off: it stands still whatever the system says.
// "Moves" is read from the sheets (the class on <html>, the durations, the
// agent's light at the preview's edge and its pulsing dot). And in all six
// combinations the pictures a user points at to SEE something play do play:
// a transition's card, a text animation's, a clip animation's.
// L6 too: the one-time move of the lane height to small.
import { scene } from '../d22-d-scene.mjs'
export const name = 'd22-d-motion'
export const timeoutMs = 240_000

export async function run(ctx) {
  const { c, lib } = ctx
  const { assert } = lib
  await scene(ctx)
  const look = () => c.run(() => {
    const root = getComputedStyle(document.documentElement)
    const glow = document.querySelector('[data-testid="agent.pv.glow"]')
    // (The working agent's dot: since D22 worker C it is the one dot of the agent's bar and chip.)
    const dot = document.querySelector('.agent-dot.is-live')
    const btn = document.querySelector('.ui-btn')
    return {
      off: document.documentElement.classList.contains('motion-off'),
      fast: root.getPropertyValue('--dur-fast').trim(),
      glow: glow ? getComputedStyle(glow).animationName : null,
      dot: dot ? getComputedStyle(dot, '::after').animationName : null,
      fade: parseFloat(getComputedStyle(btn).transitionDuration) || 0
    }
  })
  /** The picture of a tile changes while the pointer is on it. */
  const plays = async (tid, what) => {
    const sel = `[data-testid="${tid}"]`
    await c.run((s) => { document.querySelector(s).scrollIntoView({ block: 'center' }); return true }, sel)
    await c.sleep(120)
    const pic = () => c.run((s) => { const cv = document.querySelector(s + ' canvas'); return cv ? cv.toDataURL().length + ':' + cv.toDataURL().slice(-120) : null }, sel)
    await c.mouse('mouseMoved', 5, 5)
    await c.sleep(120)
    const rest = await pic()
    assert.ok(rest, `${what}: the tile has a picture`)
    const b = await c.box(tid)
    await c.mouse('mouseMoved', b.cx, b.cy)
    const seen = new Set([rest])
    for (let i = 0; i < 8 && seen.size < 3; i++) {
      await c.sleep(140)
      seen.add(await pic())
    }
    await c.mouse('mouseMoved', 5, 5)
    assert.ok(seen.size >= 3, `${what}: it plays when pointed at (${seen.size} different pictures)`)
  }
  const choose = async (pref) => {
    await c.click('topbar.settings')
    await c.waitId('settings.general.motion')
    await c.click(`settings.general.motion.${pref}`)
    const label = await c.run(() => document.querySelector('[data-testid="settings.general.motion.system"]').textContent.trim())
    await c.key('Escape')
    await c.waitGone('settings.nav')
    return label
  }

  // The agent at work (the store's event, as the host records one): the light and the dot are there.
  await c.run(() => window.__agent.store.getState().callStarted({ id: 'd22d', session: 's', tool: 'analyze', client: 'test', defsChars: 0, kind: 'silences' }))
  await c.waitId('agent.pv.glow')
  await c.waitId('agent.activity')
  try {
    for (const system of ['reduce', 'no-preference']) {
      for (const pref of ['system', 'on', 'off']) {
        await lib.systemMotion(c, system)
        const label = await choose(pref)
        await lib.systemMotion(c, system)
        const still = pref === 'off' || (pref === 'system' && system === 'reduce')
        const tag = `the system says ${system}, Animations: ${pref}`
        const s = await look()
        console.log(`     ${tag}: ${JSON.stringify(s)}; the system's choice reads "${label}"`)
        assert.equal(s.off, still, `${tag}: html.motion-off`)
        assert.equal(s.fast, still ? '0ms' : '120ms', `${tag}: --dur-fast`)
        assert.equal(s.glow, still ? 'none' : 'agent-breathe', `${tag}: the light at the preview's edge`)
        assert.equal(s.dot === 'none' || s.dot === null, still, `${tag}: the agent's dot pulses (${s.dot})`)
        assert.equal(s.fade > 0, !still, `${tag}: a button fades its colours`)
        // The choice says why nothing moves.
        assert.equal(/off now|şu anda kapalı/.test(label), system === 'reduce', `${tag}: the system's choice says whether it is off now ("${label}")`)
        
        // Content plays either way.
        await lib.dockPage(c, 'transitions')
        await plays('effects.trans.kind.iris', `${tag}: a transition's card`)
        await lib.textPage(c, 'anims')
        await plays('dock.text.anim.in.slide', `${tag}: a text animation's card`)
        await lib.dockPage(c, 'media')
        await c.click('timeline.clip.v2', { fx: 0.5, fy: 0.7 })
        await c.click('inspector.tab.clip')
        await c.run(() => { for (const h of document.querySelectorAll('.inspector [aria-expanded="false"]')) h.click(); return true })
        await c.waitId('inspector.clip.motion.tile.spin')
        await plays('inspector.clip.motion.tile.spin', `${tag}: a clip animation's card`)
      }
    }
    // Kept with the profile: after a reload the choice (off) still holds, with a system that allows motion.
    assert.equal(await c.ev(`localStorage.getItem('snipp-motion')`), 'off')
    await c.run(() => { window.__store.getState().setDirty(false); return true })
    await c.send('Page.reload', { ignoreCache: false })
    await lib.ready(c)
    assert.equal((await look()).off, true, 'off is remembered over a reload')
    // System again: nothing stored (the default).
    await choose('system')
    assert.equal(await c.ev(`localStorage.getItem('snipp-motion')`), null, 'following the system stores nothing')
    assert.equal((await look()).off, false, 'system + a system that allows motion: it moves')

    // ---- L6: the one-time move of the lane height to small -----------------------
    const reloadWith = async (scale, moved) => {
      await c.run((scale, moved) => {
        if (scale === null) localStorage.removeItem('snipp-track-scale'); else localStorage.setItem('snipp-track-scale', scale)
        if (moved) localStorage.setItem('snipp-track-scale-s22', '1'); else localStorage.removeItem('snipp-track-scale-s22')
        localStorage.setItem('snipp-tour-seen', '1')
        window.__store.getState().setDirty(false)
        return true
      }, scale, moved)
      await c.send('Page.reload', { ignoreCache: false })
      await lib.ready(c)
      return c.run(() => ({ stored: localStorage.getItem('snipp-track-scale'), moved: localStorage.getItem('snipp-track-scale-s22') }))
    }
    assert.deepEqual(await reloadWith(null, false), { stored: 'small', moved: '1' }, 'a used profile that never chose a height: small')
    assert.deepEqual(await reloadWith('medium', false), { stored: 'small', moved: '1' }, 'the medium an earlier version wrote: small, once')
    assert.deepEqual(await reloadWith('large', false), { stored: 'large', moved: '1' }, 'large stays')
    assert.deepEqual(await reloadWith('medium', true), { stored: 'medium', moved: '1' }, 'a medium chosen after the move stays')
  } finally {
    await c.send('Emulation.setEmulatedMedia', { features: [] })
    await c.run(() => { try { localStorage.removeItem('snipp-motion'); window.__agent?.store.getState().callFinished('d22d', {}) } catch { /* reloaded */ } return true }).catch(() => undefined)
  }
}
