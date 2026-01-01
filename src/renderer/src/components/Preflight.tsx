// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export window's check (DENEME-4, worker W): one calm line — "21
// warnings · 18 sudden loud peaks · 3 other" — that opens a list grouped by
// kind: the loud peaks as times, each a way there; the other findings as a
// row each with its Go. Nothing here stops an export: what does (an empty
// timeline, a refused encoder) is the window's own red line above.
import { useEffect, useMemo, useState } from 'react'
import { carriesAudio, clipLoudnessDb } from '../audio/silence'
import { loudPeaks, preflight, type PreflightIssue, type PreflightKind } from '../export/preflight'
import { groupIssues, shownAsTimes, summaryOf } from '../export/preflight-groups'
import { codeFilms } from '../media/codefilm'
import { useStore } from '../state/store'
import { BareButton, Button, Icon, Tooltip, getLang, t as tr, useT, type IconName, type StringKey } from '../ui'
import { fmtTime } from '../ui/format'
import { preflightText } from '../export/preflight-say'
import { fontMissingHere } from '../fonts'

const WIN = 0.05
// The one time form (ui/format.ts, audit G6).
const fmt = (t: number): string => fmtTime(t, 1)

/** Each kind of finding: its icon, its name, its name for many. */
const KINDS: Record<PreflightKind, { icon: IconName; one: StringKey; many: StringKey }> = {
  missing: { icon: 'triangle-exclamation-point', one: 'w4.pre.kind.missing', many: 'w4.pre.kind.missing.many' },
  gap: { icon: 'eye-off', one: 'w4.pre.kind.gap', many: 'w4.pre.kind.gap.many' },
  still: { icon: 'pause', one: 'w4.pre.kind.still', many: 'w4.pre.kind.still.many' },
  repeat: { icon: 'copy', one: 'w4.pre.kind.repeat', many: 'w4.pre.kind.repeat.many' },
  loud: { icon: 'volume-2', one: 'w4.pre.kind.loud', many: 'w4.pre.kind.loud.many' }
}

/** The findings, the loud peaks listened for once when the window opens. */
function useFindings(): { all: PreflightIssue[]; listening: boolean } {
  const project = useStore((s) => s.project)
  const seen = useMemo(() => preflight(project, { fontMissing: fontMissingHere, codeFilmError: (id) => (codeFilms.status(id)?.state === 'error' ? codeFilms.status(id)!.error ?? tr('pre.f9y.pageFailed') : null) }), [project])
  const [loud, setLoud] = useState<PreflightIssue[] | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      const p = useStore.getState().project
      const found: PreflightIssue[] = []
      for (const track of p.tracks) {
        if (track.muted) continue
        for (const id of track.clipIds) {
          const c = p.clips[id]
          if (!c || c.muted || !carriesAudio(p, c)) continue
          const dbs = await clipLoudnessDb(p, c, WIN).catch(() => null)
          if (!live) return
          if (!dbs) continue
          for (const at of loudPeaks(dbs, WIN, c.start)) found.push({ kind: 'loud', at, clipId: c.id, text: tr('win.pre.loudAt', { at: fmt(at) }) })
        }
      }
      if (live) setLoud(found.sort((a, b) => a.at - b.at).slice(0, 20))
    })()
    return () => {
      live = false
    }
  }, [])
  return { all: [...seen, ...(loud ?? [])].sort((a, b) => a.at - b.at), listening: !loud }
}

export function PreflightList({ onGo }: { onGo: () => void }): JSX.Element {
  const t = useT()
  const { all, listening } = useFindings()
  const [open, setOpen] = useState(false)
  const groups = groupIssues(all)
  const sum = summaryOf(groups)
  const lower = (s: string): string => s.toLocaleLowerCase(getLang() === 'tr' ? 'tr' : 'en')
  const go = (it: PreflightIssue): void => {
    const st = useStore.getState()
    st.setTime(it.at)
    if (it.clipId) st.selectClip(it.clipId)
    onGo()
  }
  if (sum.total === 0)
    return (
      <div className="xw-pre is-clear" data-testid="export.pre">
        <span className="xw-pre-line" data-testid="export.pre.summary">
          {listening ? <Icon name="loader-circle" size={14} className="xw-pre-spin" /> : <Icon name="check" size={14} />}
          {listening ? t('win.pre.listening') : t('win.pre.clear')}
        </span>
      </div>
    )
  const parts = [
    sum.total === 1 ? t('w4.pre.summary.one') : t('w4.pre.summary', { n: sum.total }),
    sum.top ? t('w4.pre.part', { n: sum.top.n, kind: sum.top.n === 1 ? lower(t(KINDS[sum.top.kind].one)) : t(KINDS[sum.top.kind].many) }) : '',
    sum.other > 0 ? t('w4.pre.other', { n: sum.other }) : ''
  ].filter(Boolean)
  return (
    <div className={open ? 'xw-pre is-open' : 'xw-pre'} data-testid="export.pre">
      <Tooltip content={open ? t('w4.pre.hide') : t('w4.pre.show')}>
        <BareButton className="xw-pre-line" aria-expanded={open} testid="export.pre.summary" onClick={() => setOpen(!open)}>
          <Icon name="triangle-exclamation-point" size={14} className="xw-pre-mark" />
          <span className="xw-pre-text">{parts.join(' · ')}</span>
          {listening && <Icon name="loader-circle" size={14} className="xw-pre-spin" />}
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </BareButton>
      </Tooltip>
      {open && (
        <div className="xw-pre-list" data-testid="export.pre.list">
          {groups.map((g) => (
            <div key={g.kind} className="xw-pre-group" data-testid={`export.pre.group.${g.kind}`}>
              <div className="xw-pre-head">
                <Icon name={KINDS[g.kind].icon} size={14} />
                <span>{t('w4.pre.group', { kind: t(KINDS[g.kind].one), n: g.items.length })}</span>
              </div>
              {shownAsTimes(g.kind) ? (
                <div className="xw-pre-times">
                  {g.items.map((it, i) => (
                    <Tooltip key={i} content={t(it.clipId ? 'win.pre.goSelect' : 'win.pre.goTo', { at: fmt(it.at) })}>
                      <BareButton className="xw-pre-time" testid={`export.pre.go.${g.kind}.${i}`} onClick={() => go(it)}>
                        {fmt(it.at)}
                      </BareButton>
                    </Tooltip>
                  ))}
                </div>
              ) : (
                g.items.map((it, i) => (
                  <div key={i} className="xw-pre-item">
                    <Tooltip content={preflightText(it)}>
                      <span className="xw-pre-item-text">{preflightText(it)}</span>
                    </Tooltip>
                    <Tooltip content={t(it.clipId ? 'win.pre.goSelect' : 'win.pre.goTo', { at: fmt(it.at) })}>
                      <Button size="sm" variant="ghost" iconEnd="arrow-right" testid={`export.pre.go.${g.kind}.${i}`} onClick={() => go(it)}>
                        {t('win.pre.go')}
                      </Button>
                    </Tooltip>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
