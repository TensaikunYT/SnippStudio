// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The building blocks (SnippStudio phase 3a.2). Their decisions are plain
// functions (ui/logic.ts), tested here; each block is drawn with
// react-dom/server and its roles, names, states and test names checked. The
// keyboard and focus in a real window: scripts/e2e/scenarios/21-ui-kit.mjs.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as ui from '../renderer/src/ui'
import { Button, IconButton } from '../renderer/src/ui/Button'
import { Chip } from '../renderer/src/ui/Chip'
import { Checkbox, Segmented, Tabs, Toggle } from '../renderer/src/ui/choice'
import { Dialog } from '../renderer/src/ui/Dialog'
import { Field, NumberField, Select, TextField } from '../renderer/src/ui/fields'
import {
  ariaShortcut, decimalsOf, formatNumber, keyValue, parseNumber, placeMenu, placeTooltip, rovingIndex, shortcutLabel, snap, toastTimeout, toastsAfter, trapIndex, typeahead, TOAST_MAX, type ToastItem
} from '../renderer/src/ui/logic'
import { Menu, MenuTrigger, type MenuItem } from '../renderer/src/ui/Menu'
import { Slider, fillPercent } from '../renderer/src/ui/Slider'
import { setLang } from '../renderer/src/ui/strings'
import { ToastView, notify, dismissToast, clearToasts, currentToasts } from '../renderer/src/ui/Toasts'
import { Tooltip, TooltipBubble, TOOLTIP_DELAY } from '../renderer/src/ui/Tooltip'

const html = (el: ReactElement): string => renderToStaticMarkup(el)
const noop = (): void => undefined
const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')

// ---- decisions -------------------------------------------------------------------
test('numbers: steps, snapping, keys (Shift ten steps, PageUp/Down, Home/End)', () => {
  assert.deepEqual([decimalsOf(1), decimalsOf(0.1), decimalsOf(0.25), decimalsOf(0.5), decimalsOf(1e-7)], [0, 1, 2, 1, 7])
  const r = { min: 0, max: 200, step: 1 }
  assert.equal(snap(120.4, r), 120)
  assert.equal(snap(250, r), 200)
  assert.equal(snap(-3, r), 0)
  assert.equal(snap(0.30000000000000004, { step: 0.1 }), 0.3)
  assert.equal(snap(-6.26, { min: -60, max: 12, step: 0.5 }), -6.5)
  assert.equal(keyValue('ArrowUp', false, 120, r), 121)
  assert.equal(keyValue('ArrowRight', false, 120, r), 121)
  assert.equal(keyValue('ArrowDown', true, 120, r), 110)
  assert.equal(keyValue('PageUp', false, 120, r), 130)
  assert.equal(keyValue('PageDown', false, 5, r), 0)
  assert.equal(keyValue('Home', false, 120, r), 0)
  assert.equal(keyValue('End', false, 120, r), 200)
  assert.equal(keyValue('End', false, 1, {}), null, 'no end without a max')
  assert.equal(keyValue('a', false, 120, r), null)
  assert.equal(keyValue('ArrowUp', false, 0.2, { step: 0.1 }), 0.3)
})

test('numbers: typed with comma, Unicode minus and the unit; shown with decimals and unit', () => {
  assert.equal(parseNumber('120'), 120)
  assert.equal(parseNumber(' 120 % ', '%'), 120)
  assert.equal(parseNumber('−6,5 dB', 'dB'), -6.5)
  assert.equal(parseNumber('-6.5db', 'dB'), -6.5)
  assert.equal(parseNumber('.5'), 0.5)
  assert.equal(parseNumber('4.5 s', 's'), 4.5)
  for (const bad of ['', 'abc', '1.2.3', '12 px', '--1', 'Infinity']) assert.equal(parseNumber(bad, 's'), null, bad)
  assert.equal(formatNumber(120, 0, '%'), '120 %')
  assert.equal(formatNumber(-6, 1, 'dB'), '-6.0 dB')
  assert.equal(formatNumber(-0, 0), '0')
  assert.equal(fillPercent(120, 0, 200), 60)
  assert.equal(fillPercent(500, 0, 200), 100)
  assert.equal(fillPercent(5, 5, 5), 0)
})

test('shortcuts: as the eye reads them and as aria-keyshortcuts wants them', () => {
  assert.equal(shortcutLabel('ctrl+d'), 'Ctrl D')
  assert.equal(shortcutLabel('s'), 'S')
  assert.equal(shortcutLabel('del'), 'Del')
  assert.equal(shortcutLabel('ctrl+shift+z'), 'Ctrl Shift Z')
  assert.equal(ariaShortcut('ctrl+d'), 'Control+D')
  assert.equal(ariaShortcut('del'), 'Delete')
})

test('moving through a row: arrows wrap, disabled items are skipped, Home/End, vertical rows', () => {
  const off = (i: number): boolean => i === 2
  assert.equal(rovingIndex(1, 'ArrowRight', 4, off), 3)
  assert.equal(rovingIndex(3, 'ArrowRight', 4, off), 0, 'wraps')
  assert.equal(rovingIndex(0, 'ArrowLeft', 4, off), 3)
  assert.equal(rovingIndex(3, 'ArrowLeft', 4, off), 1)
  assert.equal(rovingIndex(1, 'Home', 4, (i) => i === 0), 1)
  assert.equal(rovingIndex(1, 'End', 4, (i) => i === 3), 2)
  assert.equal(rovingIndex(0, 'ArrowDown', 4), null, 'a horizontal row ignores ArrowDown')
  assert.equal(rovingIndex(0, 'ArrowDown', 4, off, 'vertical'), 1)
  assert.equal(rovingIndex(0, 'ArrowRight', 0), null)
  assert.equal(rovingIndex(0, 'ArrowRight', 3, () => true), null, 'nothing to go to')
  assert.equal(typeahead(['Split', 'Duplicate', 'Paste', 'Delete'], 0, 'd'), 1)
  assert.equal(typeahead(['Split', 'Duplicate', 'Paste', 'Delete'], 1, 'd'), 3)
  assert.equal(typeahead(['Split', 'Duplicate', 'Paste', 'Delete'], 0, 'p', (i) => i === 2), null)
  assert.equal(typeahead(['a'], 0, ' '), null)
})

test('popovers: a menu under its button (above when no room, inside the window), a tooltip centred above', () => {
  const view = { w: 1000, h: 600 }
  assert.deepEqual(placeMenu({ x: 100, y: 100, w: 80, h: 28 }, { w: 200, h: 150 }, view), { x: 100, y: 132, side: 'below' })
  const up = placeMenu({ x: 100, y: 540, w: 80, h: 28 }, { w: 200, h: 150 }, view)
  assert.equal(up.side, 'above')
  assert.equal(up.y, 540 - 4 - 150)
  assert.equal(placeMenu({ x: 950, y: 100, w: 40, h: 28 }, { w: 200, h: 150 }, view).x, 1000 - 8 - 200, 'kept inside on the right')
  const tip = placeTooltip({ x: 100, y: 100, w: 28, h: 28 }, { w: 60, h: 24 }, view)
  assert.deepEqual(tip, { x: 84, y: 70, side: 'above' })
  assert.equal(placeTooltip({ x: 100, y: 10, w: 28, h: 28 }, { w: 60, h: 24 }, view).side, 'below')
  assert.equal(placeTooltip({ x: 0, y: 100, w: 28, h: 28 }, { w: 60, h: 24 }, view).x, 8)
})

test('a dialog keeps Tab inside: it wraps both ways', () => {
  assert.equal(trapIndex(2, 3, false), 0)
  assert.equal(trapIndex(0, 3, true), 2)
  assert.equal(trapIndex(-1, 3, false), 0)
  assert.equal(trapIndex(-1, 3, true), 2)
  assert.equal(trapIndex(0, 0, false), -1)
})

test('toasts: stacked newest last, at most four, dismissed by id, timed by what they hold', () => {
  const mk = (id: number): ToastItem => ({ id, text: `t${id}`, kind: 'info', timeout: 5000 })
  let list: ToastItem[] = []
  for (let i = 1; i <= 6; i++) list = toastsAfter(list, { type: 'push', toast: mk(i) })
  assert.equal(TOAST_MAX, 4)
  assert.deepEqual(list.map((x) => x.id), [3, 4, 5, 6])
  list = toastsAfter(list, { type: 'dismiss', id: 4 })
  assert.deepEqual(list.map((x) => x.id), [3, 5, 6])
  assert.deepEqual(toastsAfter(list, { type: 'clear' }), [])
  assert.equal(toastTimeout({}), 5000)
  assert.equal(toastTimeout({ action: {} }), 8000)
  assert.equal(toastTimeout({ kind: 'error' }), 8000)
  // The module's own stack.
  clearToasts()
  const id = notify({ text: 'Saved' })
  notify({ text: 'Cuts', action: { label: 'Undo', run: noop } })
  assert.equal(currentToasts().length, 2)
  assert.equal(currentToasts()[1].timeout, 8000)
  dismissToast(id)
  assert.deepEqual(currentToasts().map((x) => x.text), ['Cuts'])
  clearToasts()
})

// ---- drawn ---------------------------------------------------------------------------
test('Button: four kinds, two heights, type=button, disabled, pressed, test name, icons', () => {
  for (const v of ['primary', 'secondary', 'ghost', 'danger'] as const) {
    const s = html(h(Button, { variant: v, testid: `b.${v}` }, 'Go'))
    assert.match(s, new RegExp(`^<button type="button" class="ui-btn ui-btn-${v} ui-size-md"`))
    assert.match(s, new RegExp(`data-testid="b.${v}"`))
    assert.match(s, /<span class="ui-btn-label">Go<\/span>/)
  }
  assert.match(html(h(Button, { size: 'sm' }, 'x')), /ui-size-sm/)
  assert.match(html(h(Button, { disabled: true }, 'x')), / disabled=""/)
  const on = html(h(Button, { pressed: true, icon: 'magnet', iconEnd: 'chevron-down' }, 'Snap'))
  assert.match(on, /is-on/)
  assert.match(on, /aria-pressed="true"/)
  assert.equal((on.match(/<svg/g) ?? []).length, 2)
  assert.equal(/aria-pressed/.test(html(h(Button, {}, 'x'))), false, 'not a toggle unless pressed is given')
})

test('IconButton: square, named, its shortcut for the keyboard and the tooltip', () => {
  const s = html(h(IconButton, { icon: 'scissors', label: 'Split', shortcut: 'ctrl+b', testid: 'b.split' }))
  assert.match(s, /class="ui-btn ui-btn-ghost ui-size-md is-icon-only"/)
  assert.match(s, /aria-label="Split"/)
  assert.match(s, /aria-keyshortcuts="Control\+B"/)
  assert.match(s, /data-testid="b.split"/)
  assert.equal(/role="tooltip"/.test(s), false, 'the tooltip waits for the pointer')
})

test('fields: text, number (spinbutton, unit), select (chevron), Field (label for the control)', () => {
  const tf = html(h(TextField, { value: 'Rough cut', onChange: noop, label: 'Name', placeholder: 'Search', invalid: true, testid: 'f.name' }))
  assert.match(tf, /class="ui-input ui-size-md is-invalid"/)
  assert.match(tf, /value="Rough cut"/)
  assert.match(tf, /aria-label="Name"/)
  assert.match(tf, /aria-invalid="true"/)
  assert.match(tf, /placeholder="Search"/)
  const nf = html(h(NumberField, { value: 120, onChange: noop, min: 0, max: 200, unit: '%', label: 'Scale value', testid: 'f.n' }))
  assert.match(nf, /role="spinbutton"/)
  assert.match(nf, /value="120 %"/)
  assert.match(nf, /aria-valuenow="120"/)
  assert.match(nf, /aria-valuemin="0"/)
  assert.match(nf, /aria-valuemax="200"/)
  assert.match(nf, /inputMode="decimal"|inputmode="decimal"/)
  assert.match(html(h(NumberField, { value: 4.5, onChange: noop, step: 0.1, unit: 's' })), /value="4.5 s"/)
  const sel = html(h(Select, { value: 'b', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C', disabled: true }], onChange: noop, label: 'Rate', testid: 'f.sel' }))
  assert.match(sel, /<option value="b" selected="">B<\/option>/)
  assert.match(sel, /<option value="c" disabled="">C<\/option>/)
  assert.match(sel, /aria-label="Rate"/)
  assert.match(sel, /ui-select-arrow/)
  const field = html(h(Field, { label: 'Frame rate', hint: 'Per second', children: h(TextField, { value: '', onChange: noop }) }))
  const forId = /<label class="ui-field-label" for="([^"]+)">Frame rate<\/label>/.exec(field)
  assert.ok(forId, 'a label for the control')
  assert.match(field, new RegExp(`<input[^>]* id="${forId![1]}"`))
  assert.match(field, new RegExp(`aria-describedby="${forId![1]}-hint"`))
})

test('Slider: one row — label for the track, the track, a typable number with its unit', () => {
  const s = html(h(Slider, { label: 'Scale', value: 120, min: 0, max: 200, unit: '%', onChange: noop, testid: 's.scale' }))
  const id = /<label class="ui-slider-label" for="([^"]+)">Scale<\/label>/.exec(s)
  assert.ok(id)
  assert.match(s, new RegExp(`<input id="${id![1]}" class="ui-range" type="range" min="0" max="200" step="1"`))
  assert.match(s, /style="--fill:60%"/)
  assert.match(s, /data-testid="s.scale.range"/)
  assert.match(s, /data-testid="s.scale.value"/)
  assert.match(s, /aria-label="Scale value"/)
  assert.match(s, /value="120 %"/)
  assert.match(html(h(Slider, { label: 'Blur', value: 1, min: 0, max: 2, onChange: noop, disabled: true })), /ui-slider is-disabled/)
})

test('Toggle and Checkbox: a switch with role and state, the system checkbox under a drawn box', () => {
  const on = html(h(Toggle, { checked: true, onChange: noop, label: 'Agent access', testid: 't.agent' }))
  assert.match(on, /role="switch"/)
  assert.match(on, /aria-checked="true"/)
  assert.match(on, /<span class="ui-switch-text">Agent access<\/span>/)
  assert.match(html(h(Toggle, { checked: false, onChange: noop, ariaLabel: 'Snap' })), /aria-checked="false"[^>]*aria-label="Snap"/)
  const cb = html(h(Checkbox, { checked: true, onChange: noop, label: 'Snap to edges', testid: 'c.edges' }))
  assert.match(cb, /<input type="checkbox" class="ui-check-input"[^>]*checked=""/)
  assert.match(cb, /data-testid="c.edges"/)
  assert.match(cb, /Snap to edges/)
  assert.match(html(h(Checkbox, { checked: false, onChange: noop, label: 'x', disabled: true })), /disabled=""/)
  assert.match(html(h(Checkbox, { checked: false, indeterminate: true, onChange: noop, label: 'x' })), /data-icon="minus"/)
})

test('Segmented and Tabs: one chosen, only it in the Tab order, named, the agent tab amber', () => {
  const seg = html(h(Segmented, { value: 'fill', options: [{ value: 'fit', label: 'Fit' }, { value: 'fill', label: 'Fill' }, { value: 'stretch', label: 'Stretch' }], onChange: noop, label: 'Picture', testid: 'seg' }))
  assert.match(seg, /role="radiogroup" aria-label="Picture"/)
  assert.equal((seg.match(/role="radio"/g) ?? []).length, 3)
  assert.equal((seg.match(/tabindex="0"/g) ?? []).length, 1)
  assert.match(seg, /aria-checked="true" tabindex="0"[^>]*data-testid="seg.fill"/)
  const tabs = html(h(Tabs, { value: 'clip', tabs: [{ value: 'clip', label: 'Clip' }, { value: 'agent', label: 'Agent', agent: true, badge: 2 }], onChange: noop, label: 'Properties', idBase: 'insp', testid: 'tabs' }))
  assert.match(tabs, /role="tablist" aria-label="Properties"/)
  assert.match(tabs, /role="tab" id="insp-tab-clip" aria-selected="true" aria-controls="insp-clip" tabindex="0"/)
  assert.match(tabs, /aria-selected="false"[^>]*tabindex="-1" class="ui-tab is-agent"/)
  assert.match(tabs, /ui-tab-badge">2</)
})

const items: MenuItem[] = [
  { id: 'split', label: 'Split', icon: 'scissors', shortcut: 's', testid: 'm.split' },
  { id: 'paste', label: 'Paste', disabled: true },
  { id: 'link', label: 'Link', checked: true },
  { id: 'delete', label: 'Delete', danger: true, shortcut: 'del', separatorBefore: true }
]

test('Menu: one surface of rows, shortcuts on the right, disabled and checked items, a separator', () => {
  const s = html(h(Menu, { items, label: 'Clip', focus: 'none', testid: 'menu' }))
  assert.match(s, /^<div class="ui-menu" role="menu" aria-label="Clip"/)
  assert.equal((s.match(/role="menuitem"/g) ?? []).length, 3)
  assert.match(s, /role="menuitemcheckbox" aria-checked="true"/)
  assert.match(s, /aria-disabled="true"/)
  assert.match(s, /role="separator"/)
  assert.match(s, /class="ui-menu-item is-danger"/)
  assert.match(s, /<kbd class="ui-kbd">S<\/kbd>/)
  assert.match(s, /<kbd class="ui-kbd">Del<\/kbd>/)
  assert.equal((s.match(/tabindex="0"/g) ?? []).length, 1, 'one row in the Tab order')
  assert.match(s, /data-testid="m.split"/)
  const trig = html(h(MenuTrigger, { label: 'Clip menu', items, testid: 'mt' }))
  assert.match(trig, /aria-haspopup="menu"/)
  assert.match(trig, /aria-expanded="false"/)
  assert.match(trig, /data-testid="mt"/)
  assert.match(trig, /data-icon="chevron-down"/)
  assert.match(html(h(MenuTrigger, { icon: 'ellipsis', iconLabel: 'More', items })), /aria-label="More"/)
})

test('Dialog: a named dialog with its close button and actions; nothing when closed', () => {
  setLang('en')
  const s = html(h(Dialog, { open: true, inline: true, title: 'Export', onClose: noop, actions: h(Button, { variant: 'primary' }, 'Export'), testid: 'dlg' }, 'Body'))
  const id = /<h2 id="([^"]+)" class="ui-dialog-title">Export<\/h2>/.exec(s)
  assert.ok(id)
  assert.match(s, new RegExp(`role="dialog" aria-labelledby="${id![1]}"`))
  assert.match(s, /aria-label="Close"/)
  assert.match(s, /data-testid="dlg.close"/)
  assert.match(s, /class="ui-dialog-actions"/)
  assert.equal(html(h(Dialog, { open: false, title: 'x', onClose: noop })), '')
  // The building blocks' own words follow the language.
  setLang('tr')
  assert.match(html(h(Dialog, { open: true, inline: true, title: 'x', onClose: noop })), /aria-label="Kapat"/)
  setLang('en')
})

test('Tooltip: 400 ms, a light bubble with the shortcut; the child is drawn as it is until then', () => {
  assert.equal(TOOLTIP_DELAY, 400)
  const b = html(h(TooltipBubble, { content: 'Split the clip', shortcut: 's' }))
  assert.match(b, /^<div class="ui-tooltip" role="tooltip">/)
  assert.match(b, /<kbd class="ui-kbd">S<\/kbd>/)
  const s = html(h(Tooltip, { content: 'Split', children: h('button', { type: 'button' }, 'x') }))
  assert.equal(s, '<button type="button">x</button>')
})

test('Toast: status (alert when it went wrong), its action, a close button', () => {
  const s = html(h(ToastView, { toast: { text: '14 cuts applied', kind: 'info', action: { label: 'Undo', run: noop } }, testid: 'toast.1' }))
  assert.match(s, /class="ui-toast" role="status"/)
  assert.match(s, /14 cuts applied/)
  assert.match(s, /data-testid="toast.1.action"/)
  assert.match(s, /Undo/)
  assert.match(s, /aria-label="Dismiss"/)
  assert.match(html(h(ToastView, { toast: { text: 'Failed', kind: 'error' } })), /class="ui-toast is-error" role="alert"/)
})

test('Chip: tones, a pressable filter, a named remove button', () => {
  assert.match(html(h(Chip, { tone: 'agent', pulse: true, children: 'Agent writing' })), /class="ui-chip ui-chip-agent"[\s\S]*ui-chip-pulse/)
  const f = html(h(Chip, { onClick: noop, pressed: true, testid: 'c.f', children: 'Video' }))
  assert.match(f, /ui-chip-neutral is-on is-button/)
  assert.match(f, /aria-pressed="true"/)
  const r = html(h(Chip, { onRemove: noop, testid: 'c.r', children: '1 clip' }))
  assert.match(r, /aria-label="Remove 1 clip"/)
  assert.match(r, /data-testid="c.r.remove"/)
})

// ---- the set as a whole -------------------------------------------------------------------
const BLOCKS = ['Button', 'IconButton', 'Icon', 'Slider', 'NumberField', 'TextField', 'Select', 'Toggle', 'Checkbox', 'Segmented', 'Tabs', 'Menu', 'Dialog', 'Tooltip', 'ToastStack', 'Field', 'Chip']

test('all seventeen building blocks are exported from ui/ and shown on the building blocks page', () => {
  const exported = ui as unknown as Record<string, unknown>
  // A component (forwardRef ones are objects).
  for (const b of BLOCKS) assert.ok(exported[b] !== null && ['function', 'object'].includes(typeof exported[b]), `${b} is exported`)
  assert.equal(typeof exported.MenuTrigger, 'function')
  assert.equal(typeof exported.notify, 'function')
  assert.equal(typeof exported.t, 'function')
  const kit = readFileSync(join(SRC, 'ui', 'kit', 'KitPage.tsx'), 'utf8')
  for (const b of BLOCKS.filter((x) => x !== 'Tooltip' && x !== 'ToastStack')) assert.ok(kit.includes(`<${b}`), `${b} on the page`)
  assert.ok(kit.includes('<TooltipBubble') && kit.includes('shortcut="s"'), 'a tooltip on the page')
  assert.ok(kit.includes('<ToastStack') && kit.includes('<ToastView'), 'the toasts on the page')
})

test('the old controls are gone: one button, slider, segmented choice, menu and section (phase 3c.4b)', () => {
  for (const f of ['components/controls.tsx', 'components/Menu.tsx', 'components/Section.tsx', 'styles.css']) assert.equal(existsSync(join(SRC, f)), false, `${f} is gone`)
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  const files = walk(SRC).filter((x) => /\.tsx?$/.test(x))
  // (An import of a deleted control would not compile.) No file outside ui/
  // writes a <button> of its own: a surface that is a button is a BareButton.
  const bad = files.filter((f) => !/[\\/]ui[\\/]/.test(f) && f.endsWith('.tsx') && /<button\b/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(bad, [])
})

test('the building blocks page opens only in a build that is not packaged', () => {
  const main = readFileSync(join(SRC, 'main.tsx'), 'utf8')
  assert.match(main, /location\.hash === '#ui-kit'/)
  assert.match(main, /api\?\.testUiKit\?\.\(\)/)
  assert.match(main, /if \(allowed !== true\) return startEditor\(\)/)
  const ipc = readFileSync(join(SRC, '..', '..', 'main', 'ipc', 'media-ipc.ts'), 'utf8')
  assert.match(ipc, /if \(!app\.isPackaged\) ipcMain\.handle\('test:ui-kit', \(\) => true\)/)
})
