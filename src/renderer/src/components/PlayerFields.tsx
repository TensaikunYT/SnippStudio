// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The video player template's events: pause, play, skip, back, speed,
// captions and quality — each at its time — and the two that change the
// picture underneath for real: a pause freezes it, a skip jumps it forward.

import { useStore } from '../state/store'
import { findTemplate } from '../templates/model'
import { pauseLength, PLAYER_ACTS, playerEvents, QUALITIES, SPEEDS, type PlayerAct } from '../templates/player-plan'
import { projectDuration, uid, type Clip, type Project, type TemplateBlock } from '../types'
import { Button, IconButton, Select, Tooltip, notify, useT } from '../ui'
import { UndoNumber } from './inspector/sliders'

function edit(fn: (p: Project) => void, key?: string): void {
  useStore.getState().editTemplates(fn, true, key)
}

/** The top video clip on screen at project time t. */
function videoAt(p: Project, t: number): Clip | undefined {
  for (const tr of p.tracks) {
    if (tr.kind !== 'video' || tr.hidden) continue
    for (const id of tr.clipIds) {
      const c = p.clips[id]
      const a = c && p.assets.find((x) => x.id === c.assetId)
      if (c && a?.kind === 'video' && t > c.start + 0.05 && t < c.start + c.duration - 0.05) return c
    }
  }
  return undefined
}

export function PlayerFields({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const now = useStore((s) => s.currentTime)
  const events = playerEvents(b)
  const set = (id: string, patch: { title?: string; value?: number; note?: string | undefined }, key?: string): void =>
    edit((p) => {
      const it = findTemplate(p, b.id)?.items.find((x) => x.id === id)
      if (!it) return
      Object.assign(it, patch)
      if (it.note === undefined) delete it.note
    }, key)
  const add = (act: PlayerAct): void =>
    edit((p) => {
      const tp = findTemplate(p, b.id)
      if (!tp || tp.items.length >= 12) return
      const local = now - tp.start
      const at = local > 0.3 && local < tp.duration - 0.3 ? local : Math.min(tp.duration - 0.5, (events[events.length - 1]?.t ?? 0.5) + 1.5)
      tp.items.push({ id: uid(), title: act, value: Math.round(at * 10) / 10, ...(act === 'speed' ? { note: '2' } : act === 'quality' ? { note: '144p' } : act === 'skip' || act === 'back' ? { note: '10' } : {}) })
    })
  const freeze = (i: number, at: number): void => {
    const st = useStore.getState()
    const when = b.start + at
    const clip = videoAt(st.project, when)
    if (!clip) {
      notify({ text: t('tpl.player.noVideoPause'), kind: 'error' })
      return
    }
    st.setTime(when)
    st.selectClip(clip.id)
    st.insertFreezeFrame(pauseLength(b, i))
    notify({ text: t('tpl.player.frozen') })
  }
  const skip = (at: number, sec: number): void => {
    const st = useStore.getState()
    const when = b.start + at
    const clip = videoAt(st.project, when)
    if (!clip) {
      notify({ text: t('tpl.player.noVideoSkip'), kind: 'error' })
      return
    }
    st.skipAhead(clip.id, when, sec)
    notify({ text: t('tpl.player.jumped', { n: sec }) })
  }
  const fmtT = (s: number): string => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const r = Math.floor(s % 60)
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
  }
  const project = useStore((s) => s.project)
  const realTotal = projectDuration(project)
  const setClock = (patch: { start?: number | null; total?: number | null }): void =>
    edit((p) => {
      const tp = findTemplate(p, b.id)
      if (!tp) return
      const ck = { ...(tp.clock ?? {}) }
      if (patch.start !== undefined) {
        if (patch.start === null) delete ck.start
        else ck.start = Math.max(0, patch.start)
      }
      if (patch.total !== undefined) {
        if (patch.total === null) delete ck.total
        else ck.total = Math.max(1, patch.total)
      }
      if (ck.start !== undefined || ck.total !== undefined) tp.clock = ck
      else delete tp.clock
    })
  const actName = (a: PlayerAct): string => t(`tpl.player.act.${a}`)
  return (
    <>
      <div className="insp-move-row">
        <Tooltip content={t('tpl.player.clock.hint')}>
          <span className="insp-move-name">{t('tpl.player.clock')}</span>
        </Tooltip>
        {/* Each of these edits is its own undo step (the store's editTemplates). */}
        <UndoNumber undo={false} name={t('tpl.player.clock.start')} value={b.clock?.start ?? b.start} step={1} digits={0} suffix="s" onChange={(v) => setClock({ start: v })} />
        <span>/</span>
        <UndoNumber undo={false} name={t('tpl.player.clock.total')} value={b.clock?.total ?? realTotal} step={1} digits={0} suffix="s" onChange={(v) => setClock({ total: v })} />
        {b.clock ? (
          <IconButton icon="rotate-ccw" size="sm" label={t('tpl.player.clock.real')} onClick={() => setClock({ start: null, total: null })} />
        ) : (
          <em className="insp-kf-time is-auto">{fmtT(b.start)} / {fmtT(realTotal)}</em>
        )}
      </div>
      <div className="insp-kf-list">
        {b.items.map((it) => {
          const act = (PLAYER_ACTS as string[]).includes(it.title) ? (it.title as PlayerAct) : 'pause'
          const e = events.find((q) => q.i === b.items.indexOf(it))
          return (
            <div key={it.id} className="insp-event">
              <div className="insp-move-row">
                <Select size="sm" label={t('tpl.player.event')} value={act} options={PLAYER_ACTS.map((a) => ({ value: a, label: actName(a) }))} onChange={(v) => set(it.id, { title: v })} />
                <UndoNumber undo={false} name={t('tpl.player.when')} value={e?.t ?? it.value ?? 0} step={0.1} digits={1} suffix="s" onChange={(v) => set(it.id, { value: v })} />
                {act === 'speed' && (
                  <Select size="sm" label={t('insp.speed')} value={it.note ?? '2'} options={SPEEDS.map((sp) => ({ value: sp, label: sp === 'Normal' ? t('tpl.player.normal') : `${sp}×` }))} onChange={(v) => set(it.id, { note: v })} />
                )}
                {act === 'quality' && (
                  <Select size="sm" label={t('tpl.player.act.quality')} value={it.note ?? '144p'} options={QUALITIES.map((q) => ({ value: q, label: q }))} onChange={(v) => set(it.id, { note: v })} />
                )}
                {(act === 'skip' || act === 'back') && (
                  <UndoNumber undo={false} name={t('tpl.player.seconds')} value={Number(it.note) || 10} step={5} digits={0} suffix="s" onChange={(v) => set(it.id, { note: String(Math.max(1, Math.round(v))) })} />
                )}
                <IconButton icon="x" size="sm" variant="danger" label={t('insp.remove')} onClick={() => edit((p) => { const tp = findTemplate(p, b.id); if (tp && tp.items.length > 1) tp.items = tp.items.filter((x) => x.id !== it.id) })} />
              </div>
              {act === 'pause' && e && (
                <Tooltip content={t('tpl.player.freeze.hint')}>
                  <Button size="sm" variant="ghost" icon="snowflake" onClick={() => freeze(e.i, e.t)}>{t('tpl.player.freeze')}</Button>
                </Tooltip>
              )}
              {act === 'skip' && e && (
                <Tooltip content={t('tpl.player.jump.hint')}>
                  <Button size="sm" variant="ghost" icon="skip-forward" onClick={() => skip(e.t, Number(e.arg) || 10)}>{t('tpl.player.jump')}</Button>
                </Tooltip>
              )}
            </div>
          )
        })}
      </div>
      <div className="insp-grid">
        {PLAYER_ACTS.map((a) => (
          <Tooltip key={a} content={t('tpl.player.add.hint')}>
            <Button size="sm" icon="plus" onClick={() => add(a)}>{actName(a)}</Button>
          </Tooltip>
        ))}
      </div>
      <div className="hint">{t('tpl.player.help')}</div>
    </>
  )
}
