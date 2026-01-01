// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's second try-out, worker T (DENEME-2-PLAN-T.md):
//   item 1: every kind of block on the timeline in one language (video,
//     picture, sound, code clip, adjustment layer, look layer, subtitle, a
//     text and a shape, a template block, a transition): pictures of all of
//     them at rest, selected and one being dragged (tasarim\ekranlar\deneme2);
//     the text chip and the template block take the clips' marks (corner,
//     name pill, gold selection and edges, lift);
//   item 5: a code clip says LIVE on its block, its media card and the
//     Inspector's head;
//   item 3: the notes lane and the Notes tab only with agent access on (the
//     notes are kept);
//   items 4 and 8: while a call of the agent runs, the dot beside the switch
//     pulses and the preview's edge glows; waiting for the user is calm.
import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { SHOTS } from './den2-t-agent-move.mjs'
export const name = 'den2-t-blocks'
export const timeoutMs = 150_000

const build = (ids) => {
  const S = window.__store
  const p = structuredClone(S.getState().project)
  const W = p.settings.width
  const H = p.settings.height
  const T = { x: W / 2, y: H / 2, scale: 1, rotation: 0 }
  p.tracks = [
    { id: 'V4', kind: 'video', name: 'V4', clipIds: ['adj', 'look'] },
    { id: 'V3', kind: 'video', name: 'V3', clipIds: ['code'] },
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['pic'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v1', 'v2'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['snd'] }
  ]
  p.clips = {
    adj: { id: 'adj', assetId: '', trackId: 'V4', start: 0.5, inPoint: 0, duration: 3, transform: T, volume: 1, adjustment: true },
    look: { id: 'look', assetId: '', trackId: 'V4', start: 5, inPoint: 0, duration: 4, transform: T, volume: 1, adjustment: true, cameraLook: { grain: 0.4 } },
    code: { id: 'code', assetId: ids.code, trackId: 'V3', start: 0, inPoint: 0, duration: 4, transform: T, volume: 1 },
    pic: { id: 'pic', assetId: ids.pic, trackId: 'V2', start: 4.5, inPoint: 0, duration: 4, transform: { ...T, scale: 0.4 }, volume: 1 },
    v1: { id: 'v1', assetId: ids.talk, trackId: 'V1', start: 0, inPoint: 0, duration: 6, transform: T, volume: 1, linkId: 'L', audioExtracted: true },
    v2: { id: 'v2', assetId: ids.other, trackId: 'V1', start: 6, inPoint: 0, duration: 6, transform: T, volume: 1 },
    snd: { id: 'snd', assetId: ids.talk, trackId: 'A1', start: 0, inPoint: 0, duration: 6, transform: T, volume: 1, linkId: 'L' }
  }
  p.captions = [
    { id: 'sub1', start: 0.3, end: 2.6, text: 'Hello and welcome', layer: 0 },
    { id: 'sub2', start: 3, end: 5.5, text: 'to the second line', layer: 0 }
  ]
  S.getState().setPlaying(false)
  S.getState().loadProject(p)
  S.setState({ selectedClipIds: [], selectedCaptionIds: [], pxPerSec: 90 })
  S.getState().runBatch([
    { name: 'text.add', params: { time: 1, text: 'Title text' } },
    { name: 'shape.add', params: { time: 7, kind: 'rect' } },
    { name: 'clip.setTransition', params: { clipId: 'v1', transition: { type: 'mix', duration: 1 } } }
  ])
}

export async function run({ c, app, media, lib, work }) {
  const { assert } = lib
  const failed = []
  const part = async (what, body) => {
    try {
      await body()
    } catch (e) {
      failed.push(`${what}: ${e.message.split(/\r?\n/)[0]}`)
    }
  }
  // A code film, through the Code page (the folder dialog answered).
  const film = join(work, 'film-blocks')
  cpSync(media.film, film, { recursive: true })
  lib.answer(app, { kind: 'open', paths: [film] })
  await lib.dockPage(c, 'code')
  await c.click('media.code-film')
  const code = await c.waitFor('the film in the project', () => c.st((s) => s.project.assets.find((a) => a.kind === 'code') ?? null), 15000)
  const [talk, other, pic] = await lib.seedAssets(app, c, [media.talk, media.other, media.broll[0]])
  await c.run(build, { code: code.id, talk: talk.id, other: other.id, pic: pic.id })
  await c.waitId('timeline.clip.code')
  // A template block, through the app's own control.
  await lib.templatesPage(c)
  await c.click('templates.insert.steps')
  await c.waitFor('a template block', () => c.st((s) => (s.project.templates?.length ?? 0) > 0))
  await lib.dockPage(c, 'media')
  await c.run(() => {
    window.__store.getState().setTime(9.5)
    window.__store.setState({ selectedClipIds: [], selectedCaptionIds: [], templateSel: null })
  })
  await c.sleep(300)
  const tl = async (file) => {
    const b = await c.box('timeline.ruler')
    await c.sleep(150)
    const r = await c.capture({ format: 'png', clip: { x: 0, y: Math.max(0, b.y - 50), width: 1400, height: 560, scale: 1 } })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(SHOTS, file), Buffer.from(r.data, 'base64'))
  }

  await part('1 blocks', async () => {
    await tl('bloklar-dinlenik.png')
    // The text chip and the template block in the clips' language.
    const look = await c.run(() => {
      const cs = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const s = getComputedStyle(el)
        return { radius: s.borderTopLeftRadius, shadow: s.boxShadow, outline: s.outlineStyle }
      }
      const clip = cs('.tl-clip.video')
      return { clip, text: cs('.tl-caption-chip.manual'), sub: cs('.tl-caption-chip:not(.manual)'), tpl: cs('.tl-tpl-block'), pill: getComputedStyle(document.querySelector('.tl-caption-chip .chip-text')).borderTopLeftRadius }
    })
    console.log('     look:', JSON.stringify(look))
    for (const k of ['text', 'sub', 'tpl']) {
      assert.equal(look[k].radius, look.clip.radius, `${k}: the clip's corner`)
      assert.match(look[k].shadow, /inset/, `${k}: its kind's edge is an inset ring`)
    }
    assert.notEqual(look.pill, '0px', 'the words in a pill')
    // Everything selected at once: the gold frame and underlay on each.
    const textId = await c.st((s) => s.project.captions.find((k) => k.manual && !k.shape)?.id)
    await c.run((tid) => {
      const S = window.__store
      S.setState({ selectedClipIds: Object.keys(S.getState().project.clips), selectedCaptionIds: S.getState().project.captions.map((k) => k.id), templateSel: S.getState().project.templates[0].id })
      return tid
    }, textId)
    await c.sleep(200)
    const sel = await c.run(() => {
      const o = (sel) => getComputedStyle(document.querySelector(sel)).outlineColor
      return { clip: o('.tl-clip.selected'), chip: o('.tl-caption-chip.selected'), tpl: o('.tl-tpl-block.selected') }
    })
    assert.equal(sel.chip, sel.clip, 'a selected text: the clips\' gold')
    assert.equal(sel.tpl, sel.clip, 'a selected template: the clips\' gold')
    await tl('bloklar-secili.png')
    await c.run(() => window.__store.setState({ selectedClipIds: [], selectedCaptionIds: [], templateSel: null }))
    // A text chip being dragged: lifted (the shot is taken mid-drag).
    const b = await c.box(`timeline.caption.${textId}`)
    await c.mouse('mouseMoved', b.cx, b.cy)
    await c.mouse('mousePressed', b.cx, b.cy)
    for (let i = 1; i <= 6; i++) {
      await c.mouse('mouseMoved', b.cx + i * 12, b.cy, { down: true })
      await c.sleep(16)
    }
    const lifted = await c.run((id) => getComputedStyle(document.querySelector(`[data-testid="timeline.caption.${id}"]`)).boxShadow, textId)
    await tl('bloklar-surukle.png')
    await c.mouse('mouseReleased', b.cx + 72, b.cy)
    assert.match(lifted, /rgba?\(0, 0, 0/, `lifted while dragged: ${lifted}`)
  })

  await part('5 live', async () => {
    assert.ok(await c.has('timeline.clip.code.live'), 'LIVE on the code clip\'s block')
    assert.match(await c.ev(`document.querySelector('[data-testid="timeline.clip.code.live"]').textContent`), /^(LIVE|CANLI)$/)
    if (code.folder && !(await c.has(`media.item.${code.id}`))) await c.click(`media.folder.${code.folder}`, { double: true })
    await c.waitId(`media.live.${code.id}`)
    await c.click('timeline.clip.code', { fx: 0.7 })
    await c.click('inspector.tab.clip')
    await c.waitId('inspector.clip.live')
  })

  await part('3 notes only with agent access', async () => {
    await c.run(() => window.__store.getState().runBatch([{ name: 'note.add', params: { start: 1, end: 2, kind: 'fix', text: 'A note' } }]))
    assert.ok(await c.ev(`!!document.querySelector('.tl-note-lane')`), 'on: the lane')
    assert.ok(await c.has('inspector.tab.notes'), 'on: the tab')
    await lib.topBarSwitch(c)
    await c.waitFor('agent access off', () => c.ev(`!document.querySelector('.tl-note-lane')`))
    assert.ok(!(await c.has('inspector.tab.notes')), 'off: no Notes tab')
    assert.equal(await c.st((s) => (s.project.notes ?? []).length), 1, 'the notes are kept')
    await tl('notlar-kapali.png')
    await lib.topBarSwitch(c)
    await c.waitFor('agent access on again', () => c.ev(`!!document.querySelector('.tl-note-lane')`), 15000)
    assert.ok(await c.has('inspector.tab.notes'))
  })

  await part('4/8 the agent at work', async () => {
    // A call in flight (the store's event, as the host records one).
    await c.run(() => window.__agent.store.getState().callStarted({ id: 'x1', session: 's', tool: 'analyze', client: 'test', defsChars: 0, kind: 'silences' }))
    await c.waitId('agent.activity')
    assert.equal(await c.attr('agent.activity', 'data-state'), 'working')
    assert.ok(await c.has('agent.pv.glow'), 'the preview glows')
    // (22 November, L2: both states of the system emulated, never the
    // machine's own: this passed on a machine where nothing moved.)
    const glow = () => c.ev(`getComputedStyle(document.querySelector('[data-testid="agent.pv.glow"]')).animationName`)
    try {
      await lib.systemMotion(c, 'reduce')
      assert.equal(await glow(), 'none', 'a still edge when the system asks for less motion')
      await lib.systemMotion(c, 'no-preference')
      assert.equal(await glow(), 'agent-breathe', 'the edge breathes')
    } finally {
      await lib.systemMotion(c, null)
    }
    await c.shot(join(SHOTS, 'ajan-calisiyor.png'))
    await c.run(() => window.__agent.store.getState().callFinished('x1', {}))
  })

  if (failed.length) throw new Error(`${failed.length} part(s) failed:\n  ${failed.join('\n  ')}`)
}
