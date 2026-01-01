// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Choices (SnippStudio phase 3a.2; TASARIM.md "Aç/kapat", "Parçalı seçim",
// "Sekmeler"): the switch for a setting that is on or off, the checkbox for
// picking several in a list, the segmented control (one of a few), the tabs.
import { useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { rovingIndex } from './logic'

const cx = (...c: (string | false | undefined)[]): string => c.filter(Boolean).join(' ')

// ---- switch -----------------------------------------------------------------------
export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Shown beside it; without it, name it with ariaLabel or a Field. */
  label?: string
  ariaLabel?: string
  disabled?: boolean
  id?: string
  testid?: string
}

/** A switch (34 × 20): role="switch", Space or Enter turns it. */
export function Toggle({ checked, onChange, label, ariaLabel, disabled, id, testid }: ToggleProps): JSX.Element {
  const sw = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
      className={cx('ui-switch', checked && 'is-on')}
      data-testid={testid}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch-knob" />
    </button>
  )
  if (!label) return sw
  return (
    <label className={cx('ui-switch-row', disabled && 'is-disabled')}>
      <span className="ui-switch-text">{label}</span>
      {sw}
    </label>
  )
}

// ---- checkbox -----------------------------------------------------------------------
export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  ariaLabel?: string
  /** Some but not all (a list's "all" box). */
  indeterminate?: boolean
  disabled?: boolean
  id?: string
  testid?: string
}

/** A checkbox (16): the system's own input (its keyboard and screen reader
 *  behaviour) under a drawn box and the check icon. */
export function Checkbox({ checked, onChange, label, ariaLabel, indeterminate, disabled, id, testid }: CheckboxProps): JSX.Element {
  return (
    <label className={cx('ui-check', disabled && 'is-disabled')}>
      <span className={cx('ui-check-box', checked && 'is-on', indeterminate && 'is-mixed')}>
        <input
          id={id}
          type="checkbox"
          className="ui-check-input"
          checked={checked}
          disabled={disabled}
          aria-label={label ? undefined : ariaLabel}
          ref={(el) => {
            if (el) el.indeterminate = !!indeterminate
          }}
          data-testid={testid}
          onChange={(e) => onChange(e.target.checked)}
        />
        <Icon name={indeterminate ? 'minus' : 'check'} size={12} className="ui-check-mark" />
      </span>
      {label && <span className="ui-check-text">{label}</span>}
    </label>
  )
}

/** The arrows choose only while the keyboard brought the focus to the group
 *  (the interface audit's E3): after a click the focus stays on the part, and
 *  an arrow then is the app's (a frame step), not a new choice — "Curve" →
 *  "One speed" threw a drawn speed curve away. A press marks the group; the
 *  focus leaving it clears the mark. */
function usePointerFocus(): { pointer: () => boolean; onPointerDown: () => void; onBlur: (e: FocusEvent<HTMLElement>) => void } {
  const by = useRef(false)
  return {
    pointer: () => by.current,
    onPointerDown: () => {
      by.current = true
    },
    onBlur: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) by.current = false
    }
  }
}

// ---- one of a few ---------------------------------------------------------------------
export interface SegmentOption<V extends string> {
  value: V
  label: string
  icon?: IconName
  disabled?: boolean
  /** Its tip on hover (why it is closed, what it means). */
  hint?: string
}

export interface SegmentedProps<V extends string> {
  value: V
  options: readonly SegmentOption<V>[]
  onChange: (value: V) => void
  /** The group's name. */
  label: string
  disabled?: boolean
  /** data-testid of the group; each part is <testid>.<value>. */
  testid?: string
}

/** One of a few, in a sunken strip; the chosen part raised. A radio group:
 *  Tab reaches the chosen part, the arrows choose. */
export function Segmented<V extends string>({ value, options, onChange, label, disabled, testid }: SegmentedProps<V>): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = options.findIndex((o) => o.value === value)
  const focus = usePointerFocus()
  const onKey = (e: KeyboardEvent): void => {
    if (focus.pointer()) return
    const i = rovingIndex(Math.max(0, at), e.key, options.length, (k) => !!options[k].disabled || !!disabled)
    if (i === null) return
    e.preventDefault()
    onChange(options[i].value)
    refs.current[i]?.focus()
  }
  return (
    <div className={cx('ui-seg', disabled && 'is-disabled')} role="radiogroup" aria-label={label} data-testid={testid} onKeyDown={onKey} onPointerDown={focus.onPointerDown} onBlur={focus.onBlur}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (at < 0 && i === 0) ? 0 : -1}
            disabled={disabled || o.disabled}
            className={cx('ui-seg-part', on && 'is-on')}
            data-testid={testid ? `${testid}.${o.value}` : undefined}
            title={o.hint}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <Icon name={o.icon} size={14} />}
            <span className="ui-seg-label">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ---- tabs -------------------------------------------------------------------------------
export interface TabItem<V extends string> {
  value: V
  label: string
  /** The agent's own tab: its line is amber. */
  agent?: boolean
  /** A count or a dot after the word. */
  badge?: ReactNode
  /** Its tip on hover (what is behind it). */
  hint?: string
  disabled?: boolean
}

export interface TabsProps<V extends string> {
  value: V
  tabs: readonly TabItem<V>[]
  onChange: (value: V) => void
  /** The tab list's name. */
  label: string
  /** Prefix of the panels' ids: tab <value> controls `<idBase>-<value>`. */
  idBase?: string
  /** data-testid of the list; each tab is <testid>.<value>. */
  testid?: string
  /** Arayüz v4: 'sm' is a card's own small tabs (a card's parts). */
  size?: 'md' | 'sm'
}

/** Words, a 2 px line under the chosen one (turquoise; amber for the agent's
 *  tab). The arrows, Home and End move and choose. */
export function Tabs<V extends string>({ value, tabs, onChange, label, idBase, testid, size = 'md' }: TabsProps<V>): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = tabs.findIndex((x) => x.value === value)
  const focus = usePointerFocus()
  const onKey = (e: KeyboardEvent): void => {
    if (focus.pointer()) return
    const i = rovingIndex(Math.max(0, at), e.key, tabs.length, (k) => !!tabs[k].disabled)
    if (i === null) return
    e.preventDefault()
    onChange(tabs[i].value)
    refs.current[i]?.focus()
  }
  return (
    <div className={size === 'sm' ? 'ui-tabs is-sm' : 'ui-tabs'} role="tablist" aria-label={label} data-testid={testid} onKeyDown={onKey} onPointerDown={focus.onPointerDown} onBlur={focus.onBlur}>
      {tabs.map((x, i) => {
        const on = x.value === value
        return (
          <button
            key={x.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={idBase ? `${idBase}-tab-${x.value}` : undefined}
            aria-selected={on}
            aria-controls={idBase ? `${idBase}-${x.value}` : undefined}
            tabIndex={on ? 0 : -1}
            disabled={x.disabled}
            className={cx('ui-tab', on && 'is-on', x.agent && 'is-agent')}
            data-testid={testid ? `${testid}.${x.value}` : undefined}
            title={x.hint}
            onClick={() => onChange(x.value)}
          >
            <span>{x.label}</span>
            {x.badge != null && <span className="ui-tab-badge">{x.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
