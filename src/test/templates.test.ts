// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addTemplateItem,
  createTemplate,
  deleteTemplate,
  moveTemplateItem,
  removeTemplateItem,
  rippleTemplates,
  sanitizeTemplates,
  TEMPLATE_INFO,
  TEMPLATE_KINDS,
  templateSlots,
  updateTemplate,
  updateTemplateItem, galleryLayout, galleryTimes } from '../renderer/src/templates/model'
import { defaultProject } from '../renderer/src/types'

test('every template starts filled in, at the playhead, with its own default length', () => {
  const p = defaultProject()
  for (const kind of TEMPLATE_KINDS) createTemplate(p, kind, 3)
  assert.equal(p.templates!.length, TEMPLATE_KINDS.length)
  for (const t of p.templates!) {
    assert.equal(t.start, 3)
    assert.equal(t.duration, TEMPLATE_INFO[t.kind].duration)
    assert.ok(t.items.length >= (t.kind === 'versus' ? 2 : 1))
    assert.ok(t.items.every((it) => it.id && typeof it.title === 'string'))
  }
})

test('the items share the block evenly, so its length is its pace', () => {
  const p = defaultProject()
  const id = createTemplate(p, 'steps', 0)
  const t = p.templates!.find((x) => x.id === id)!
  const slow = templateSlots(t)
  updateTemplate(p, id, { duration: t.duration * 2 })
  const fast = templateSlots(p.templates![0])
  assert.equal(slow.count, 4)
  assert.ok(fast.len > slow.len * 1.9)
  for (let i = 1; i < slow.count; i++) assert.ok(Math.abs(slow.at(i) - slow.at(i - 1) - slow.len) < 1e-9)
  // Versus times its stat rows, not its two sides.
  const v = createTemplate(p, 'versus', 0)
  assert.equal(templateSlots(p.templates!.find((x) => x.id === v)!).count, 3)
})

test('versus keeps its two sides: they cannot be removed or reordered', () => {
  const p = defaultProject()
  const id = createTemplate(p, 'versus', 0)
  const t = () => p.templates!.find((x) => x.id === id)!
  const [a, b, s1] = t().items
  removeTemplateItem(p, id, a.id)
  moveTemplateItem(p, id, s1.id, -1)
  assert.equal(t().items[0].id, a.id)
  assert.equal(t().items[1].id, b.id)
  assert.equal(t().items[2].id, s1.id)
  removeTemplateItem(p, id, s1.id)
  assert.ok(!t().items.some((x) => x.id === s1.id))
})

test('switching to versus leaves it two sides to draw', () => {
  const p = defaultProject()
  const id = createTemplate(p, 'stat', 0)
  const t = p.templates!.find((x) => x.id === id)!
  t.items = t.items.slice(0, 1)
  updateTemplate(p, id, { kind: 'versus' })
  assert.equal(p.templates!.find((x) => x.id === id)!.items.length, 2)
})

test('item edits clamp and drop what is unset', () => {
  const p = defaultProject()
  const id = createTemplate(p, 'ranking', 0)
  const item = p.templates![0].items[0]
  updateTemplateItem(p, id, item.id, { title: 'x'.repeat(200), value: Number.NaN, note: undefined })
  const got = p.templates![0].items[0]
  assert.equal(got.title.length, 80)
  assert.ok(!('value' in got))
  assert.ok(!('note' in got))
})

test('adding stops at the template limit', () => {
  const p = defaultProject()
  const id = createTemplate(p, 'stat', 0)
  let added = 0
  while (addTemplateItem(p, id)) added++
  assert.equal(p.templates![0].items.length, TEMPLATE_INFO.stat.max)
  assert.ok(added >= 1)
})

test('a whole-timeline cut moves graphics with the footage and drops ones cut out whole', () => {
  const p = defaultProject()
  createTemplate(p, 'steps', 1)
  createTemplate(p, 'stat', 20)
  createTemplate(p, 'timeline', 40)
  p.templates![0].duration = 8 // 1..9, loses 5..9 → ends at 5
  p.templates![1].duration = 6 // 20..26, inside the cut
  rippleTemplates(p, 5, 30)
  const got = p.templates!.map((t) => [t.kind, t.start, t.duration])
  assert.deepEqual(got, [
    ['steps', 1, 4],
    ['timeline', 15, 12]
  ])
})

test('deleting the last graphic removes the list', () => {
  const p = defaultProject()
  const id = createTemplate(p, 'steps', 0)
  deleteTemplate(p, id)
  assert.ok(!('templates' in p))
})

test('loading repairs bad template data', () => {
  const p = defaultProject()
  ;(p as unknown as { templates: unknown }).templates = [
    { id: 'a', kind: 'versus', start: -4, duration: 999, title: 7, items: [{ id: 'i1', title: 'Only one', value: 'x' }], style: { accent: 'javascript:alert(1)', backdrop: 'laser', hand: 'yes' }, seed: 'z' },
    { id: 'b', kind: 'hologram', items: [] },
    null
  ]
  assert.equal(sanitizeTemplates(p), 2)
  const t = p.templates![0]
  assert.equal(t.start, 0)
  assert.equal(t.duration, 120)
  assert.equal(t.title, '')
  assert.equal(t.items.length, 2, 'versus gets its second side back')
  assert.ok(!('value' in t.items[0]))
  assert.match(t.style.accent, /^#[0-9a-f]{6}$/i)
  assert.equal(t.style.backdrop, 'paper')
  assert.equal(t.style.hand, true)
})

test('a gallery lays its photos out inside its panel, and opens them one after another', () => {
  const b = { kind: 'gallery' as const, duration: 12, items: Array.from({ length: 6 }, (_, i) => ({ id: String(i), title: `P${i}` })) }
  const L = galleryLayout(b, 0, 1920, 1080)
  assert.equal(L.thumbs.length, 6)
  for (const r of [...L.thumbs, L.viewer]) {
    assert.ok(r.x >= L.panel.x && r.y >= L.panel.y && r.x + r.w <= L.panel.x + L.panel.w + 1e-6 && r.y + r.h <= L.panel.y + L.panel.h + 1e-6)
  }
  let prevClose = 0
  for (let i = 0; i < 6; i++) {
    const t = galleryTimes(b, i)
    assert.ok(t.tap < t.open && t.open < t.close && t.open >= prevClose, `photo ${i}`)
    prevClose = t.close
  }
  assert.ok(prevClose < 12)
})
