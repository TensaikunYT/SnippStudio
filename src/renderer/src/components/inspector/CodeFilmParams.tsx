// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A code clip's Parameters section (phase 5f, decision 2): shown ONLY when
// its page says what can be set (window.__params), closed until opened. The
// values the user sets are kept in the project (Asset.code.params) and given
// to the page when it opens (its code is not changed); the page is opened
// again with them. Text and colours are taken on Enter or when the field is
// left, so typing does not reload the page at every key.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { codeValues } from '../codevalues/state'
import { codeFilms } from '../../media/codefilm'
import { coerceParam, fittedValues, type ParamDef } from '../../media/codefilm-params'
import { useStore } from '../../state/store'
import type { Asset } from '../../types'
import { Button, Field, NumberField, TextField, Tooltip, useT } from '../../ui'

function TextParam({ def, value, onSet, testid }: { def: ParamDef; value: string; onSet: (v: string) => void; testid: string }): JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const bad = def.type === 'color' && coerceParam('color', draft) === null
  const take = (): void => {
    if (draft !== value && !bad) onSet(draft)
  }
  return (
    <TextField value={draft} onChange={setDraft} onCommit={take} onBlur={take} invalid={bad} mono={def.type === 'color'} placeholder={def.type === 'color' ? t('codeFilm.paramColor') : undefined} testid={testid} />
  )
}

/** Cila K: the one button of "code values" in the Inspector. The values
 *  themselves are edited in a side panel of their own (components/codevalues),
 *  for every page, whether it says parameters or not. */
function CodeValuesButton({ asset }: { asset: Asset }): JSX.Element {
  const t = useT()
  const open = useSyncExternalStore(codeValues.subscribe, codeValues.current)
  const n = asset.code?.edits?.length ?? 0
  return (
    <div className="codefilm-values">
      <Tooltip content={t('codeval.open.hint')}>
        <Button size="sm" icon="sliders-horizontal" pressed={open === asset.id} onClick={() => codeValues.toggle(asset.id)} testid="codeval.open">
          {n > 0 ? t('codeval.open.count', { n }) : t('codeval.open')}
        </Button>
      </Tooltip>
    </div>
  )
}

export function CodeFilmParams({ asset }: { asset: Asset }): JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [, setTick] = useState(0)
  useEffect(() => codeFilms.subscribe(() => setTick((n) => n + 1)), [])
  const look = useStore((s) => s.project.look)
  const defs = codeFilms.status(asset.id)?.params
  if (!defs || !defs.length) return <CodeValuesButton asset={asset} />
  const values = asset.code?.params ?? {}
  // (Audit O2: what the page gets — texts cut to fit its address — is what
  // is shown, and the cut ones are named.)
  const fit = fittedValues(values, look)
  const set = (key: string, v: string | number | null): void => useStore.getState().setCodeParams(asset.id, { [key]: v })
  const changed = defs.some((d) => d.key in values)
  return (
    <>
    <CodeValuesButton asset={asset} />
    <div className="codefilm-params" data-testid="codefilm.params" data-count={defs.length}>
      <Button variant="ghost" size="sm" icon={open ? 'chevron-down' : 'chevron-right'} onClick={() => setOpen(!open)} aria-expanded={open} testid="codefilm.params.toggle">
        {t('codeFilm.params', { n: defs.length })}
      </Button>
      {open && (
        <div className="codefilm-params-body">
          {defs.map((d) => {
            const v = d.key in fit.v ? fit.v[d.key] : d.value
            const id = `codefilm.param.${d.key}`
            return (
              <Field key={d.key} label={d.label}>
                {d.type === 'number' ? (
                  <NumberField value={typeof v === 'number' ? v : Number(v) || 0} min={d.min} max={d.max} step={d.step} onChange={(n) => set(d.key, n)} testid={id} />
                ) : (
                  <TextParam def={d} value={String(v)} onSet={(s) => set(d.key, s)} testid={id} />
                )}
              </Field>
            )
          })}
          {fit.cut.length > 0 && (
            <div className="hint is-state" data-testid="codefilm.params.cut">
              {t('codeFilm.paramsCut', { names: defs.filter((d) => fit.cut.includes(d.key)).map((d) => d.label).join(', ') })}
            </div>
          )}
          <Button size="sm" variant="ghost" icon="rotate-ccw" disabled={!changed} onClick={() => useStore.getState().setCodeParams(asset.id, Object.fromEntries(defs.map((d) => [d.key, null])))} testid="codefilm.params.reset">
            {t('codeFilm.paramsReset')}
          </Button>
        </div>
      )}
    </div>
    </>
  )
}
