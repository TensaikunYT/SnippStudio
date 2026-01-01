// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The interface audit's patch, worker A (tarifler\YAMA-ARAYUZ.md), the code
// values panel and a code film without sound:
//   - G13: a film folder with no audio/mix.wav comes in without a warning (a
//     silent film is normal);
//   - G12 / E7: "Edit values" opens its panel with the focus in it (one Tab
//     to its first control) and a passage from the button to it that leads
//     the eye; Escape closes it and the focus goes back to the button. The
//     keyboard opens it the same way.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'yama-a-code-values'
export const freshWindow = true

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:640px;height:360px;background:#102030;overflow:hidden}
#b{position:absolute;left:40px;top:160px;height:40px;width:100px;background:#ff3366}
</style></head><body><div id="b"></div><script>
var t0 = performance.now();
(function loop(){ document.getElementById('b').style.width = Math.round(100 + ((performance.now() - t0) / 1000 % 4) * 80) + 'px'; requestAnimationFrame(loop) })();
</script></body></html>
`

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  const projDir = join(work, 'yama-a-project')
  const dir = join(projDir, 'anim', 'sessiz')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), PAGE)
  const file = join(projDir, 'yama-a.snipp')
  lib.answer(app, { kind: 'save', path: file })
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('s', ['ctrl'])
  await c.waitFor('saved', async () => existsSync(file), 10000)

  // ---- G13: no warning for a film without sound --------------------------------
  const r = await c.run(async (dir) => {
    const [, imp] = await window.__codeFilm()
    const info = await window.api.codeFilm.register(dir)
    const out = await imp.codeFilmImport(info)
    const a0 = out.assets.find((a) => a.kind === 'code')
    const [a] = window.__store.getState().addAssets([a0])
    return { id: (a ?? a0).id, errors: out.errors }
  }, dir)
  console.log(`     G13: a film with no sound: errors ${JSON.stringify(r.errors)}`)
  // (Said at the end: the panel's part still runs.)
  const silentWarned = r.errors.length > 0
  const before = await c.st((s) => Object.keys(s.project.clips))
  await c.st((s, id) => s.addToTimeline(id), r.id)
  const clipId = await c.waitFor('the clip placed', async () => c.st((s, b) => Object.keys(s.project.clips).find((k) => !b.includes(k)) ?? null, before), 5000)
  await c.st((s, id) => s.selectClips([id]), clipId)
  await c.click('inspector.tab.clip')
  await c.waitId('codeval.open')

  // ---- G12 / E7: opened by a click ----------------------------------------------
  await c.run(() => {
    window.__flySeen = false
    const mo = new MutationObserver(() => {
      if (document.querySelector('[data-testid="codeval.fly"]')) window.__flySeen = true
    })
    mo.observe(document.body, { childList: true, subtree: true })
    window.__flyMo = mo
    return true
  })
  // (Motion allowed for this part, whatever the system says: with "less
  // motion" nothing flies, checked below.)
  const reduced = await c.ev(`matchMedia('(prefers-reduced-motion: reduce)').matches`)
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await c.click('codeval.open')
  await c.waitId('codeval.panel')
  await c.sleep(400)
  await c.send('Emulation.setEmulatedMedia', { features: [] })
  const inPanel = () => c.run(() => !!document.activeElement?.closest('[data-testid="codeval.panel"]'))
  const where = await c.run(() => document.activeElement?.closest('[data-testid]')?.dataset.testid ?? document.activeElement?.tagName)
  console.log(`     G12/E7: open → the focus on ${where}; the passage drawn ${await c.ev('window.__flySeen')}`)
  assert.equal(await inPanel(), true, 'the focus is in the panel')
  assert.equal(await c.ev('window.__flySeen'), true, 'a passage from the button to the panel')
  await c.key('Tab')
  assert.equal(await inPanel(), true, 'one Tab: a control of the panel')
  await c.key('Escape')
  await c.waitGone('codeval.panel')
  assert.equal(await lib.focused(c), 'codeval.open', 'closed: the focus back on its button')

  // ---- the keyboard opens it the same way (with "less motion": nothing flies) ----------
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await c.run(() => { window.__flySeen = false; return true })
  await c.key('Enter')
  await c.waitId('codeval.panel')
  await c.sleep(300)
  await c.send('Emulation.setEmulatedMedia', { features: [] })
  console.log(`     G12/E7: by Enter with less motion: the focus in the panel ${await inPanel()}, the passage drawn ${await c.ev('window.__flySeen')} (the system's own setting: ${reduced ? 'less motion' : 'motion'})`)
  assert.equal(await inPanel(), true, 'opened by Enter: the focus is in the panel')
  assert.equal(await c.ev('window.__flySeen'), false, 'less motion: no passage')
  await c.click('codeval.close')
  await c.waitGone('codeval.panel')
  assert.equal(await lib.focused(c), 'codeval.open', 'closed by its X: the focus back on its button')
  await c.run(() => { window.__flyMo?.disconnect(); return true })
  assert.equal(silentWarned, false, 'no warning for a silent film')
}
