// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where the agent is and where it has been (D22, worker C; YOL-HARITASI.md
// 1.2; the mock-up's first screen), from the calls the app records and
// nothing else (agent/activity.ts):
//   - the flag, on the ruler, at the start of the stretch the agent touched
//     last: the program's first name and what it does there (a book: it
//     reads; an eye: it looks at frames; a pencil: it writes). It stands
//     still while nothing moves, and slides to its next place when motion
//     is on (it jumps when motion is off);
//   - the trail, a thin line under the ruler: faint where the job read,
//     solid where it wrote; over a stretch, what the agent did there. It
//     grows through the job and stays until the next one;
//   - on the ruler, the pins of a draft's markers and graphics; at the
//     trail's start, the badges of what a draft changes for the whole film.
import { memo, useMemo, type CSSProperties } from 'react'
import { activityPlace, activityWords } from '../../agent/activity-words'
import { flagOf, trailOf, type Doing, type Job, type TrailPart } from '../../agent/activity'
import { flagWidth, lastByWorker, placeFlags, type FlagMore, type FlagOut } from '../../agent/crew'
import { form } from '../../agent/count'
import { agentDisplayName } from '../../agent/holder'
import { wordsText } from '../../agent/said'
import { useAgentStore, type ToolEvent } from '../../agent/store'
import { useStore } from '../../state/store'
import { projectDuration, TIMELINE_HEADER_W } from '../../types'
import { BareButton, Icon, Tooltip, t as tt, useT, type IconName } from '../../ui'
import { changeText } from './draft-text'
import { useDraftMarks } from './DraftMarks'
import { useAgentJob, type JobNow } from './useJob'
import { useCrew, type Crew } from './useCrew'
import { useRegions } from './useRegions'

const ICON: Record<Doing, IconName> = { read: 'book-open', look: 'eye', write: 'pencil' }

/** One call, as the trail's tip says it. */
function stepWords(e: ToolEvent, draft: boolean): string {
  const what = wordsText(activityWords(e, draft))
  const place = activityPlace(e)
  return place ? tt('d22c.bar.at', { what, place }) : what
}

/** What the agent did over a stretch of the trail: its last calls there. */
export function trailTip(p: TrailPart, draft: boolean): string {
  const last = p.events.slice(-4).map((e) => stepWords(e, draft))
  const more = p.events.length - last.length
  return (more > 0 ? [tt(`d22c.trail.more.${form(more)}`, { n: more }), ...last] : last).join(' · ')
}

/** One worker's flag (EKIP-PLAN.md): where it touched last, what it did. */
interface TeamFlag extends FlagOut {
  as: string
  at: number
  doing: Doing
}

/** The team's flags (EKIP-PLAN.md): one per worker at its last place, laid
 *  out in two rows at most (agent/crew.ts placeFlags); null: no team. The
 *  ruler draws the first row, the trail the second and the "+N". */
export function useTeamFlags(j: JobNow, pxPerSec: number): { crew: Crew; placed: TeamFlag[]; more: FlagMore[] } | null {
  const crew = useCrew(j)
  const on = !!j.job && !j.closed && j.phase.phase !== 'none' && !!j.client && crew.workers.length > 0
  return useMemo(() => {
    if (!on || !j.job) return null
    const flags: { key: string; x: number; w: number; at: number; doing: Doing }[] = []
    for (const [as, events] of lastByWorker(j.job.events)) {
      const f = flagOf({ ...(j.job as Job), events })
      if (!f) continue
      flags.push({ key: as, x: TIMELINE_HEADER_W + Math.max(0, f.at) * pxPerSec, w: flagWidth(crew.name(as)), at: f.at, doing: f.doing })
    }
    const by = new Map(flags.map((f) => [f.key, f]))
    const { placed, more } = placeFlags(flags)
    return { crew, placed: placed.map((p) => ({ ...p, as: p.key, at: by.get(p.key)!.at, doing: by.get(p.key)!.doing })), more }
  }, [on, j.job, pxPerSec, crew])
}

/** A worker's flag, in its colour (its line down too). */
function WorkerFlag({ f, crew, live, program }: { f: TeamFlag; crew: Crew; live: boolean; program: string }): JSX.Element {
  const t = useT()
  const colour = crew.colour(f.as || undefined)
  const style = { left: f.x, ...(f.as ? { '--agent': colour } : {}) } as CSSProperties
  return (
    <span className={`agent-flag is-${f.doing} is-worker${f.row ? ' is-row2' : ''}${live ? ' is-live' : ''}`} style={style} data-testid="agent.flag" data-worker={f.as} data-row={f.row} data-doing={f.doing} data-at={f.at} aria-label={t('ekip.flag.label', { name: crew.name(f.as || undefined), program })}>
      <Icon name={ICON[f.doing]} size={12} />
      <span className="agent-flag-name">{crew.name(f.as || undefined)}</span>
    </span>
  )
}

/** In the ruler: the agent's flag and the pins of a draft. */
export const AgentRulerMarks = memo(function AgentRulerMarks({ pxPerSec }: { pxPerSec: number }): JSX.Element | null {
  const t = useT()
  const j = useAgentJob()
  const { marks, focus } = useDraftMarks()
  const items = useAgentStore((s) => s.draft?.items)
  const team = useTeamFlags(j, pxPerSec)
  const flag = !team && j.job && !j.closed && j.phase.phase !== 'none' && j.client ? flagOf(j.job) : null
  const pins = marks.filter((m) => m.shape === 'pin')
  if (!flag && !team && !pins.length) return null
  const x = (s: number): number => TIMELINE_HEADER_W + Math.max(0, s) * pxPerSec
  const name = agentDisplayName(j.client ?? '').split(' ')[0]
  return (
    <>
      {flag && (
        <span className={`agent-flag is-${flag.doing}${j.phase.phase === 'working' ? ' is-live' : ''}`} style={{ left: x(flag.at) }} data-testid="agent.flag" data-doing={flag.doing} data-at={flag.at} aria-label={t('d22c.flag.label', { name: agentDisplayName(j.client ?? '') })}>
          <Icon name={ICON[flag.doing]} size={12} />
          <span className="agent-flag-name">{name}</span>
        </span>
      )}
      {team?.placed.filter((f) => f.row === 0).map((f) => <WorkerFlag key={f.as} f={f} crew={team.crew} live={j.phase.phase === 'working'} program={agentDisplayName(j.client ?? '')} />)}
      {pins.map((m, i) => (
        <Tooltip key={`${m.item}.${i}`} content={changeText(m.change)}>
          <BareButton
            className={`agent-pin is-${m.variant}${m.item === focus ? ' is-focus' : ''}`}
            style={{ left: x(m.start ?? 0) }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              const key = items?.[m.item]?.key
              if (key) useAgentStore.getState().setFocusItem(key)
            }}
            data-testid="agent.mark"
            data-kind={m.kind}
            data-variant={m.variant}
            data-item={m.item}
            data-shape="pin"
            aria-label={changeText(m.change)}
          />
        </Tooltip>
      ))}
    </>
  )
})

/** Under the ruler: the trail of the agent's job, and what a draft changes
 *  for the whole film. A row of its own, only while there is something. */
export const AgentTrail = memo(function AgentTrail({ pxPerSec }: { pxPerSec: number }): JSX.Element | null {
  const t = useT()
  const j = useAgentJob()
  const mode = useAgentStore((s) => s.mode)
  const hasDraft = useAgentStore((s) => !!s.draft)
  const items = useAgentStore((s) => s.draft?.items)
  const { marks, focus } = useDraftMarks()
  const length = useStore((s) => projectDuration(s.project))
  const parts = j.job ? trailOf(j.job, length) : []
  const film = marks.filter((m) => m.shape === 'film')
  const team = useTeamFlags(j, pxPerSec)
  const row2 = team ? team.placed.filter((f) => f.row === 1) : []
  const more = team?.more ?? []
  // (The team mode, step 3: the stretches the workers took, a thin line each.)
  const regions = useRegions()
  if (!parts.length && !hasDraft && !regions.length) return null
  const x = (s: number): number => TIMELINE_HEADER_W + Math.max(0, s) * pxPerSec
  const tall = row2.length > 0 || more.length > 0
  return (
    <div className={`agent-trail${film.length ? ' has-film' : ''}${tall ? ' has-row2' : ''}${regions.length ? ' has-regions' : ''}`} data-testid="agent.trail">
      <div className="agent-trail-head" />
      {regions.length > 0 && (
        <span className="agent-zones" role="list" aria-label={t('ekip3.lines.label')}>
          {regions.map((r) => {
            const tip = r.tracks ? t('ekip3.region.tip.tracks', { name: r.as, range: r.range, tracks: r.tracks }) : t('ekip3.region.tip', { name: r.as, range: r.range })
            return (
              <Tooltip key={`${r.client}.${r.as}`} content={tip}>
                <span className="agent-zone" role="listitem" tabIndex={0} style={{ left: x(r.start) + 1, width: Math.max(4, (r.end - r.start) * pxPerSec - 2), '--agent': r.colour } as CSSProperties} data-testid="agent.region" data-worker={r.as} data-from={r.start} data-to={r.end} aria-label={tip} />
              </Tooltip>
            )
          })}
        </span>
      )}
      {team && row2.map((f) => <WorkerFlag key={f.as} f={f} crew={team.crew} live={j.phase.phase === 'working'} program={agentDisplayName(j.client ?? '')} />)}
      {team &&
        more.map((m) => (
          <Tooltip key={m.x} content={t('ekip.flag.more.hint', { names: m.keys.map((k) => team.crew.name(k || undefined)).join(', ') })}>
            <span className="agent-flag-more" style={{ left: m.x }} tabIndex={0} data-testid="agent.flag.more" data-workers={m.keys.join(',')}>
              {t('ekip.flag.more', { n: m.keys.length })}
            </span>
          </Tooltip>
        ))}
      {parts.map((p, i) => (
        <Tooltip key={`${p.wrote ? 'w' : 'r'}${i}`} content={trailTip(p, mode === 'draft')}>
          <span className={`agent-trail-part${p.wrote ? ' is-wrote' : ''}`} style={{ left: x(p.from), width: Math.max(3, (p.to - p.from) * pxPerSec) }} data-testid="agent.trail.part" data-wrote={p.wrote ? 'yes' : 'no'} data-from={p.from} data-to={p.to} tabIndex={0} />
        </Tooltip>
      ))}
      {film.length > 0 && (
        <span className="agent-trail-film">
          {film.map((m, i) => (
            <Tooltip key={i} content={changeText(m.change)}>
              <BareButton
                className={`agent-mark-badge is-film${m.item === focus ? ' is-focus' : ''}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  const key = items?.[m.item]?.key
                  if (key) useAgentStore.getState().setFocusItem(key)
                }}
                data-testid="agent.mark"
                data-kind={m.kind}
                data-variant={m.variant}
                data-item={m.item}
                data-shape="film"
              >
                <span className="agent-mark-badge-text">{m.badge ? wordsText(m.badge) : ''}</span>
              </BareButton>
            </Tooltip>
          ))}
        </span>
      )}
    </div>
  )
})
