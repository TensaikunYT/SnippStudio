// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { boxesLayout, boxesTimes, cardsTimes, createTemplate, defaultTemplateStyle, isDarkStyle, ownVariant, palettesFor, sanitizeTemplates, setBoxTime, templateSlots } from '../renderer/src/templates/model'
import { defaultProject } from '../renderer/src/types'

test('box to box: the main box lights first, the rest in turn — or each at the time you give it', () => {
  const p = defaultProject()
  const id = createTemplate(p, 'boxes', 3)
  const b = p.templates!.find((t) => t.id === id)!
  const T = boxesTimes(b)
  assert.equal(T.light.length, b.items.length)
  for (let i = 1; i < T.light.length; i++) assert.ok(T.light[i] > T.light[i - 1], 'in turn')
  assert.ok(T.light[1] - T.travel >= T.light[0] - 1e-9, 'the light leaves after the main box lit')
  assert.ok(T.light[T.light.length - 1] < b.duration)
  // Timed by hand; the lane's marks are the glows.
  setBoxTime(p, id, 2, 1.5)
  assert.equal(boxesTimes(b).light[2], 1.5)
  assert.equal(templateSlots(b).at(2), 1.5)
  setBoxTime(p, id, 2, 99)
  assert.equal(b.items[2].at, b.duration - 0.1)
  setBoxTime(p, id, 2, undefined)
  assert.equal(b.items[2].at, undefined)
  // Kept on load.
  setBoxTime(p, id, 1, 2.25)
  sanitizeTemplates(p)
  assert.equal(p.templates![0].items[1].at, 2.25)
  // Every design lays out every box inside the frame, a line to each other box.
  for (const design of [undefined, 'flow', 'chain'] as const) {
    b.design = design
    for (const [W, H] of [[1920, 1080], [608, 1080]]) {
      const L = boxesLayout(b, 0, W, H)
      assert.equal(L.boxes.length, b.items.length)
      assert.equal(L.links.length, b.items.length - 1)
      for (const r of L.boxes) assert.ok(r.x >= -1 && r.y >= -1 && r.x + r.w <= W + 1 && r.y + r.h <= H + 1, `${design} ${W}: inside`)
    }
  }
})

test('card deck: dealt face down or up; one can be picked at the end and brought close', () => {
  const p = defaultProject()
  const id = createTemplate(p, 'cards', 4)
  const b = p.templates!.find((t) => t.id === id)!
  assert.equal(cardsTimes(b).pick, null)
  b.deal = { pick: 2 }
  const T = cardsTimes(b)
  assert.ok(T.pick && T.pick[0] > T.flip[T.flip.length - 1] && T.pick[1] < b.duration, `${T.pick}`)
  // Face up: no turning over.
  b.deal = { up: true, pick: 0 }
  const U = cardsTimes(b)
  assert.ok(U.flip.every((f, i) => f < U.deal[i][0]))
  // Kept on load; rubbish dropped.
  sanitizeTemplates(p)
  assert.deepEqual(p.templates!.find((t) => t.id === id)!.deal, { up: true, pick: 0 })
  ;(p.templates!.find((t) => t.id === id) as unknown as { deal: unknown }).deal = { up: 'yes', pick: -2 }
  sanitizeTemplates(p)
  assert.equal(p.templates!.find((t) => t.id === id)!.deal, undefined)
})

test('box to box offers its own palettes: its own first, the deep glass ones, then the frosted ones', () => {
  const pals = palettesFor('boxes')
  const own = defaultTemplateStyle('boxes')
  assert.deepEqual([pals[0].accent, pals[0].ink, pals[0].card], [own.accent, own.ink, own.card])
  assert.ok(pals.length >= 10)
  // No two the same, and none of the shared sticker palettes (white cards, black ink).
  assert.equal(new Set(pals.map((p) => p.accent + p.ink + p.card)).size, pals.length)
  assert.ok(!pals.some((p) => p.card === '#ffffff' && p.ink === '#0b0b0d'))
  const firstLight = pals.findIndex((p) => !isDarkStyle(p))
  assert.ok(firstLight > 1)
  assert.ok(pals.slice(0, firstLight).every((p) => isDarkStyle(p)))
  assert.ok(pals.slice(firstLight).every((p) => !isDarkStyle(p)))
  // The light theme of it is one of its own frosted palettes.
  const light = ownVariant('boxes')
  assert.ok(!isDarkStyle(light))
  assert.ok(pals.some((p) => p.accent === light.accent && p.card === light.card))
  // Other templates keep the shared palettes.
  assert.ok(palettesFor('steps').some((p) => p.name === 'Tomato'))
})
