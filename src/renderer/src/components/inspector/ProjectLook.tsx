// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The project look (phase 5f, decision 3): an accent colour and a font,
// empty by default. The code templates use it when it is set (else their own);
// a code page may read it (window.__snippLook); the agent's frames context
// says it as a fact only when it is set. Taken on Enter or when a field is
// left (every code page that read it is opened again with it).
import { useEffect, useState } from 'react'
import { coerceParam } from '../../media/codefilm-params'
import { useStore } from '../../state/store'
import { Field, TextField, useT } from '../../ui'

function LookField({ label, value, color, onSet, testid }: { label: string; value: string; color?: boolean; onSet: (v: string) => void; testid: string }): JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const bad = !!color && draft.trim() !== '' && coerceParam('color', draft.trim()) === null
  const take = (): void => {
    const v = draft.trim()
    if (v !== value && !bad) onSet(v)
  }
  return (
    <Field label={label}>
      <TextField value={draft} onChange={setDraft} onCommit={take} onBlur={take} invalid={bad} mono={color} placeholder={t('look.none')} testid={testid} />
    </Field>
  )
}

export function ProjectLook(): JSX.Element {
  const t = useT()
  const look = useStore((s) => s.project.look)
  const set = (patch: { accent?: string | null; font?: string | null }): void => useStore.getState().setProjectLook(patch)
  return (
    <div className="project-look" data-testid="project.look">
      <LookField label={t('look.accent')} value={look?.accent ?? ''} color onSet={(v) => set({ accent: v || null })} testid="project.look.accent" />
      <LookField label={t('look.font')} value={look?.font ?? ''} onSet={(v) => set({ font: v || null })} testid="project.look.font" />
      <div className="ui-field-hint">{t('look.hint')}</div>
    </div>
  )
}
