// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Small rows the Inspector's panels share (SnippStudio phase 3c.3), made of
// the building blocks.
import type { ReactNode } from 'react'
import { Field, Segmented, Toggle, Tooltip, type SegmentOption } from '../../ui'

/** An id as a key's last part: 'ramp-right' → 'rampRight' (keys carry no hyphens). */
export const camel = (id: string): string => id.replace(/[-_ ]+(\w)/g, (_, c: string) => c.toUpperCase())

/** A colour picker in a field row (the system's own colour input), with room
 *  for a button or two after it. */
export function ColourField({ label, value, onChange, testid, children }: { label: string; value: string; onChange: (v: string) => void; testid?: string; children?: ReactNode }): JSX.Element {
  return (
    <Field label={label}>
      <span className="insp-colour-row">
        <input type="color" className="insp-colour" value={value} aria-label={label} data-testid={testid} onChange={(e) => onChange(e.target.value)} />
        {children}
      </span>
    </Field>
  )
}

/** A label and a read-only value on one row. */
export function Readout({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="insp-readout">
      <span className="insp-readout-label">{label}</span>
      <span className="insp-readout-value">{children}</span>
    </div>
  )
}

/** A choice among a few (a Segmented) under its label: beside it, or under it
 *  when the options need the whole width; `hint` is the row's tip. */
export function Choice<V extends string>({ label, hint, value, options, onChange, stack, testid }: { label: string; hint?: string; value: V; options: readonly SegmentOption<V>[]; onChange: (v: V) => void; stack?: boolean; testid?: string }): JSX.Element {
  const seg = <Segmented value={value} label={label} options={options} onChange={onChange} testid={testid} />
  const row = stack ? (
    <div className="insp-stack">
      <span className="insp-stack-label">{label}</span>
      {seg}
    </div>
  ) : (
    <Field label={label}>{seg}</Field>
  )
  return hint ? (
    <Tooltip content={hint}>
      <div>{row}</div>
    </Tooltip>
  ) : (
    row
  )
}

/** An on/off setting with a tip. */
export function Switch({ label, hint, checked, onChange, testid }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void; testid?: string }): JSX.Element {
  const toggle = <Toggle label={label} checked={checked} onChange={onChange} testid={testid} />
  return hint ? (
    <Tooltip content={hint}>
      <div>{toggle}</div>
    </Tooltip>
  ) : (
    toggle
  )
}
