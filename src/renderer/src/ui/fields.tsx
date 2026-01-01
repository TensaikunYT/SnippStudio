// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Fields (SnippStudio phase 3a.2; TASARIM.md "Alan"): a text field, a number
// field you can type into (with its unit, in the monospaced face, right
// aligned), a select, and Field: a label and its control on one row.
import { Children, cloneElement, forwardRef, isValidElement, useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactElement, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Icon } from './Icon'
import { Tooltip } from './Tooltip'
import { decimalsOf, formatFree, formatNumber, freeKeyValue, freeValue, keyValue, parseNumber, snap, type NumRange } from './logic'
import type { ControlSize } from './Button'

const cx = (...c: (string | false | undefined)[]): string => c.filter(Boolean).join(' ')

// ---- text ---------------------------------------------------------------------
export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> {
  value: string
  onChange: (value: string) => void
  /** Its name when no Field label names it. */
  label?: string
  /** Enter pressed (the value as it is). */
  onCommit?: (value: string) => void
  invalid?: boolean
  size?: ControlSize
  mono?: boolean
  testid?: string
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { value, onChange, label, onCommit, invalid, size = 'md', mono, testid, className, onKeyDown, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type="text"
      className={cx('ui-input', `ui-size-${size}`, mono && 'is-mono', invalid && 'is-invalid', className)}
      value={value}
      aria-label={label}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      data-testid={testid}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.key === 'Enter' && onCommit) onCommit(e.currentTarget.value)
      }}
      {...rest}
    />
  )
})

// ---- text, several lines (phase 4B: the command box) ---------------------------
export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value' | 'onSubmit'> {
  value: string
  onChange: (value: string) => void
  /** Its name when no Field label names it. */
  label?: string
  /** Ctrl+Enter (or Cmd+Enter) pressed: the value as it is. */
  onSubmit?: (value: string) => void
  testid?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ value, onChange, label, onSubmit, testid, className, onKeyDown, rows = 3, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx('ui-input', 'ui-textarea', className)}
      value={value}
      rows={rows}
      aria-label={label}
      spellCheck={false}
      data-testid={testid}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) {
          e.preventDefault()
          onSubmit(e.currentTarget.value)
        }
      }}
      {...rest}
    />
  )
})

// ---- number -------------------------------------------------------------------
export interface NumberFieldProps extends NumRange {
  value: number
  onChange: (value: number) => void
  /** Its name when no Field label names it. */
  label?: string
  /** Shown after the number ("%", "dB", "s"); also accepted when typed. */
  unit?: string
  /** Decimals shown (default: what the step needs). */
  decimals?: number
  /** Free (phase 3c.3, the fields that replaced the old number box): what is
   *  typed is only kept in range, not put on the step grid; an arrow adds one
   *  step to the value as it is; at most `decimals` decimals are shown, with
   *  no trailing zeros. */
  free?: boolean
  disabled?: boolean
  size?: ControlSize
  id?: string
  testid?: string
  className?: string
}

/** A number you can type: Enter or leaving the field takes it (snapped to the
 *  step, kept in range), Escape gives the old one back, the arrows step it
 *  (Shift: ten steps), PageUp/PageDown, Home/End the ends. */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { value, onChange, label, unit, decimals, free, min, max, step = 1, disabled, size = 'md', id, testid, className },
  ref
) {
  const dec = decimals ?? decimalsOf(step)
  const shown = free ? formatFree(value, decimals ?? 2, unit) : formatNumber(value, dec, unit)
  const [draft, setDraft] = useState<string | null>(null)
  const range = { min, max, step }
  const commit = (text: string): void => {
    const n = parseNumber(text, unit)
    setDraft(null)
    if (n === null) return
    const v = free ? freeValue(n, range) : snap(n, range)
    if (v !== value) onChange(v)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(e.currentTarget.value)
      return
    }
    if (e.key === 'Escape') {
      if (draft !== null) {
        e.preventDefault()
        e.stopPropagation()
        setDraft(null)
      }
      return
    }
    // Home/End belong to the caret while typing.
    if ((e.key === 'Home' || e.key === 'End') && draft !== null) return
    const base = draft !== null ? parseNumber(draft, unit) ?? value : value
    const v = free ? freeKeyValue(e.key, e.shiftKey, base, range) : keyValue(e.key, e.shiftKey, base, range)
    if (v === null) return
    e.preventDefault()
    setDraft(null)
    if (v !== value) onChange(v)
  }
  return (
    <input
      ref={ref}
      id={id}
      type="text"
      inputMode="decimal"
      role="spinbutton"
      className={cx('ui-input', 'ui-number', `ui-size-${size}`, className)}
      value={draft ?? shown}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={shown}
      disabled={disabled}
      spellCheck={false}
      data-testid={testid}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        if (draft !== null) commit(e.currentTarget.value)
      }}
      onKeyDown={onKey}
    />
  )
})

// ---- select -------------------------------------------------------------------
export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** Its tip on hover (why it is closed, what it means). */
  hint?: string
  /** A named group: neighbours with the same group sit under its name (phase 3c.3: the font picker). */
  group?: string
  /** The face the option is drawn in (a font shown in itself). */
  fontFamily?: string
}

/** The options as the select draws them: runs of one group under an <optgroup>. */
export function groupOptions(options: readonly SelectOption[]): { group?: string; items: SelectOption[] }[] {
  const out: { group?: string; items: SelectOption[] }[] = []
  for (const o of options) {
    const last = out[out.length - 1]
    if (last && last.group === o.group) last.items.push(o)
    else out.push({ group: o.group, items: [o] })
  }
  return out
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'size'> {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  /** Its name when no Field label names it. */
  label?: string
  size?: ControlSize
  testid?: string
}

/** The system's own select (its keyboard and screen reader behaviour), drawn
 *  in the field's look with a chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { value, options, onChange, label, size = 'md', testid, className, ...rest },
  ref
) {
  return (
    <span className={cx('ui-select', `ui-size-${size}`, rest.disabled && 'is-disabled', className)}>
      <select ref={ref} className="ui-select-el" value={value} aria-label={label} data-testid={testid} onChange={(e) => onChange(e.target.value)} {...rest}>
        {groupOptions(options).map((g, i) => {
          const items = g.items.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled} title={o.hint} style={o.fontFamily ? { fontFamily: o.fontFamily } : undefined}>
              {o.label}
            </option>
          ))
          return g.group ? (
            <optgroup key={`${g.group}-${i}`} label={g.group}>
              {items}
            </optgroup>
          ) : (
            items
          )
        })}
      </select>
      <Icon name="chevron-down" size={14} className="ui-select-arrow" />
    </span>
  )
})

// ---- a labelled row -------------------------------------------------------------
export interface FieldProps {
  label: string
  /** One control; it gets the label's id unless it has its own. */
  children: ReactElement
  /** A short line under the row. */
  hint?: string
  /** The longer explanation (cila3, 4): in the tooltip of an info mark
   *  beside the label while explanations are short (the default), under the
   *  hint with File → Long explanations; a screen reader reads it in place
   *  either way (the sections' rule, kit.css "A section's help"). */
  more?: string
  testid?: string
}

/** The info mark of a longer explanation: its words in a tooltip. */
export function InfoMark({ text, testid }: { text: string; testid?: string }): JSX.Element {
  return (
    <Tooltip content={text} describe={false}>
      <span className="ui-section-info ui-info-mark" role="note" tabIndex={0} aria-label={text} data-testid={testid}>
        <Icon name="info" size={14} />
      </span>
    </Tooltip>
  )
}

export function Field({ label, children, hint, more, testid }: FieldProps): JSX.Element {
  const auto = useId()
  const only = Children.only(children)
  const own = isValidElement(only) ? (only.props as { id?: string }).id : undefined
  const id = own ?? auto
  const hintId = hint || more ? `${id}-hint` : undefined
  return (
    <div className="ui-field" data-testid={testid}>
      <div className="ui-field-row">
        {more ? (
          <span className="ui-field-label ui-field-label-more">
            <label htmlFor={id}>{label}</label>
            <InfoMark text={more} testid={testid ? `${testid}.more` : undefined} />
          </span>
        ) : (
          <label className="ui-field-label" htmlFor={id}>
            {label}
          </label>
        )}
        <div className="ui-field-control">{cloneElement(only, { id, 'aria-describedby': hintId })}</div>
      </div>
      {(hint || more) && (
        <div className="ui-field-hint" id={hintId}>
          {more ? (
            <>
              {/* (The short line is the long one said briefly: a screen reader reads the long one only.) */}
              {hint && <span className="ui-field-short" aria-hidden="true">{hint}</span>}
              <span className="ui-field-more">{more}</span>
            </>
          ) : (
            hint
          )}
        </div>
      )}
    </div>
  )
}
