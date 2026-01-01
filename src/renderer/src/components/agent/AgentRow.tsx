// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent's line under the timeline's toolbar (D22, worker C;
// YOL-HARITASI.md 1.1 and part 4; the mock-up's first two screens). One
// place, one line:
//   - a draft waits: the review strip (ReviewStrip.tsx);
//   - else, while an agent works or its last job was not closed: the agent
//     bar — the program's name in its colour, the sentence of its last call
//     (agent/activity-words.ts), the time since the job began, its steps,
//     the tokens the app sent it (an estimate; the agent's own thinking is
//     not in it), Stop. Done stays until the user closes it or new work
//     comes ("Done · 5 changes");
//   - no agent: nothing, and no room taken.
// Everything is read off the calls the app records; the agent is not asked.
import { useEffect } from 'react'
import { Button, Chip, IconButton, Tooltip, getLang, useT } from '../../ui'
import { mmss, span } from '../../agent/draft-words'
import { useStore } from '../../state/store'
import { isJump } from './AgentLayers'
import { activityPlace, activityWords } from '../../agent/activity-words'
import { clock } from '../../agent/command'
import { form, trOf } from '../../agent/count'
import { agentDisplayName } from '../../agent/holder'
import { stopAgent } from '../../agent/host'
import { wordsText } from '../../agent/said'
import { useAgentStore } from '../../agent/store'
import { ReviewStrip } from './ReviewStrip'
import { useAgentJob, useTick, type JobNow } from './useJob'
import { jobKindOf, notesProgressOf, planOf, savedPercent, similarMs } from '../../agent/activity'
import { TokenButton } from './TokenCard'
import { SendLine } from './SendLine'
import { JobDone } from './JobSummary'
import { useCrew, type Crew } from './useCrew'
import { tokensByWorker } from '../../agent/crew'

/** The team (EKIP-PLAN.md): one chip per worker, its colour and its name;
 *  the tip says what the worker did last. */
function Workers({ crew, j }: { crew: Crew; j: JobNow }): JSX.Element {
  const t = useT()
  const mode = useAgentStore((s) => s.mode)
  const last = (as: string): string => {
    const e = [...(j.job?.events ?? [])].reverse().find((x) => x.as === as)
    if (!e) return t('ekip.bar.worker.idle')
    const what = wordsText(activityWords(e, mode === 'draft'))
    const place = activityPlace(e)
    return place ? t('d22c.bar.at', { what, place }) : what
  }
  return (
    <span className="agent-crew" role="list" aria-label={t('ekip.bar.workers')} data-testid="agent.bar.crew">
      {crew.workers.map((w) => (
        <Tooltip key={w} content={t('ekip.bar.worker.hint', { name: w, what: last(w) })}>
          <span className="agent-crew-item" role="listitem" tabIndex={0} data-testid="agent.bar.worker" data-worker={w}>
            <Chip>
              <span className="agent-crew-dot" style={{ background: crew.colour(w) }} aria-hidden="true" />
              <span className="agent-crew-name">{w}</span>
            </Chip>
          </span>
        </Tooltip>
      ))}
    </span>
  )
}

export { tokensText } from './TokenCard'

/** How far the job is (TOKEN-PLAN.md; YOL-HARITASI.md 1.4), from one of
 *  three honest sources: the agent's own plan, the notes the job came with,
 *  how long similar jobs took. None of them: nothing (the time is there). */
function Progress({ j }: { j: JobNow }): JSX.Element | null {
  const t = useT()
  const notes = useStore((s) => s.project.notes)
  const jobs = useAgentStore((s) => s.jobs)
  const plan = planOf(j.job)
  const said = ((): { text: string; hint: string; from: string } | null => {
    if (plan) return { text: t('token.plan', { step: plan.step, of: plan.of, name: plan.name }), hint: t('token.plan.hint'), from: 'plan' }
    const n = notesProgressOf(j.job, (id) => notes?.find((x) => x.id === id)?.status)
    if (n) return { text: t(`token.notes.${form(n.of)}`, { done: getLang() === 'tr' ? trOf(n.done) : n.done, of: n.of }), hint: t('token.notes.hint'), from: 'notes' }
    const ms = j.job && j.client ? similarMs(jobs, j.client, jobKindOf(j.job), j.job.start) : null
    if (ms !== null) return { text: t('token.similar', { d: ms < 60_000 ? t('token.underMin') : t('token.min', { n: Math.round(ms / 60_000) }) }), hint: t('token.similar.hint'), from: 'similar' }
    return null
  })()
  if (!said) return null
  return (
    <>
      <span className="agent-rev-sep" aria-hidden="true" />
      <Tooltip content={said.hint}>
        <span className="agent-bar-progress" data-testid="agent.bar.progress" data-from={said.from} tabIndex={0}>{said.text}</span>
      </Tooltip>
    </>
  )
}

const BAR_PHASE = { working: 'gonder2.phase.working', quiet: 'gonder2.bar.quiet', waiting: 'gonder2.phase.waiting', reply: 'gonder2.bar.reply' } as const

function AgentBar({ j }: { j: JobNow }): JSX.Element {
  const t = useT()
  const mode = useAgentStore((s) => s.mode)
  const outcome = useAgentStore((s) => s.outcome)
  const { job, phase, totals } = j
  const crew = useCrew(j)
  const team = crew.workers.length > 0
  const done = phase.phase === 'done' || j.stopped
  const now = useTick(!done)
  const e = phase.current
  // The agent's last change made straight on the timeline: said HERE and
  // nowhere else (no toast, no label on the lanes), with its Undo while the
  // project still stands where that change left it.
  const lastDirect = useAgentStore((s) => s.lastDirect)
  const flash = useAgentStore((s) => s.flash)
  const version = useStore((s) => s.projectVersion)
  const mine = !!lastDirect && !!job && lastDirect.at >= job.start
  const canUndo = mine && lastDirect!.version === version && lastDirect!.undone !== version
  // (Taken back with the bar's Undo, and the project still stands there: a
  // redo, or any edit after it, and the bar says again what the job did.)
  const undone = mine && lastDirect!.undone === version
  const jumped = canUndo && !!flash && flash.at >= (job?.start ?? 0) && isJump(flash.lengths.before, flash.lengths.after)
  const sentence = ((): string => {
    if (j.stopped) return t('d22c.bar.stopped')
    if (undone) return t('d22c.bar.undone')
    if (phase.phase === 'done') {
      const o = outcome && job && outcome.at >= job.start ? outcome.kind : null
      if (o === 'accepted') return t('d22c.bar.done.accepted')
      if (o === 'rejected') return t('d22c.bar.done.rejected')
      if (o === 'partial') return t('d22c.bar.done.partial')
      return totals && totals.changed > 0 ? t(`d22c.bar.doneChanged.${form(totals.changed)}`, { n: totals.changed }) : t('d22c.bar.done')
    }
    if (e?.tool === 'wait' && e.kind === 'plan') return t('token.plan.noted')
    if (!e || e.tool === 'wait') return t('agent.tool.wait')
    const what = wordsText(activityWords(e, mode === 'draft'))
    const place = activityPlace(e)
    const said = place ? t('d22c.bar.at', { what, place }) : what
    return phase.phase === 'quiet' ? t('d22c.bar.quiet', { what: said, time: clock(Math.max(0, now - phase.lastEnd)) }) : said
  })()
  // GONDER2-PLAN.md: the phase in the chip's words, before the sentence.
  const barPhase: keyof typeof BAR_PHASE | null = j.stopped ? null : phase.phase === 'working' ? 'working' : phase.phase === 'quiet' ? 'quiet' : j.waiting ? 'waiting' : j.alive ? 'reply' : null
  const ms = done ? (totals?.ms ?? 0) : Math.max(0, now - (job?.start ?? now))
  const saved = j.parts ? savedPercent(j.parts) : null
  return (
    <div className={`agent-bar${done ? ' is-done' : ''}`} role="status" data-testid="agent.bar" data-phase={j.stopped ? 'stopped' : phase.phase} data-tool={e?.tool ?? ''}>
      <span className={`agent-dot${phase.phase === 'working' && !j.stopped ? ' is-live' : ''}`} aria-hidden="true" />
      <span className="agent-bar-who" data-testid="agent.bar.who">{team ? t(`ekip.bar.team.${form(crew.workers.length)}`, { name: agentDisplayName(j.client ?? ''), n: crew.workers.length }) : agentDisplayName(j.client ?? '')}</span>
      {barPhase && (
        <span className={`agent-bar-phase is-${barPhase}`} data-testid="agent.bar.phase" data-state={barPhase}>
          {t(BAR_PHASE[barPhase])}
        </span>
      )}
      {team && <Workers crew={crew} j={j} />}
      {team && !done && e && e.tool !== 'wait' ? (
        // (The sentence is the last caller's: its name first, in its colour.)
        <Tooltip content={t('ekip.bar.worker.hint', { name: crew.name(e.as), what: sentence })}>
          <span className="agent-bar-what" data-testid="agent.bar.what" data-worker={e.as ?? ''} tabIndex={0}>
            <span className="agent-bar-worker" style={{ color: crew.colour(e.as) }} data-testid="agent.bar.what.worker">{crew.name(e.as)}</span>
            <span className="agent-bar-said">{sentence}</span>
          </span>
        </Tooltip>
      ) : done ? <JobDone j={j} sentence={sentence} /> : (
        <Tooltip content={sentence}>
          <span className="agent-bar-what" data-testid="agent.bar.what" tabIndex={0}>{sentence}</span>
        </Tooltip>
      )}
      <span className="agent-bar-num" data-testid="agent.bar.time">{clock(ms)}</span>
      <span className="agent-rev-sep" aria-hidden="true" />
      <span className="agent-bar-num" data-testid="agent.bar.steps">{t(`d22c.bar.steps.${form(totals?.steps ?? 0)}`, { n: totals?.steps ?? 0 })}</span>
      <span className="agent-rev-sep" aria-hidden="true" />
      <TokenButton parts={j.parts} total={totals?.tokens ?? 0} {...(team ? { workers: tokensByWorker(job?.events ?? []).map((w) => ({ ...w, name: crew.name(w.as || undefined), colour: crew.colour(w.as || undefined) })) } : {})} />
      {done && saved !== null && (
        <Tooltip content={t('token.bar.saved.hint')}>
          <span className="agent-bar-num" data-testid="agent.bar.saved" tabIndex={0}>{t('token.bar.saved', { n: saved })}</span>
        </Tooltip>
      )}
      {!done && <Progress j={j} />}
      {jumped && flash && (
        <Tooltip content={t('den2t.draft.jump', { d: span(flash.lengths.after - flash.lengths.before), way: t(flash.lengths.after > flash.lengths.before ? 'den2t.draft.jump.longer' : 'den2t.draft.jump.shorter'), from: mmss(flash.lengths.before), to: mmss(flash.lengths.after) })}>
          <span className="agent-rev-note is-warn" tabIndex={0} data-testid="agent.bar.jump">
            {t(flash.lengths.after > flash.lengths.before ? 'd22c.draft.jump.longer' : 'd22c.draft.jump.shorter', { d: span(flash.lengths.after - flash.lengths.before) })}
          </span>
        </Tooltip>
      )}
      {canUndo && (
        <Tooltip content={t('d22c.bar.undo.hint')}>
          <Button
            size="sm"
            variant="ghost"
            icon="undo-2"
            onClick={() => {
              useStore.getState().undo()
              useAgentStore.getState().setLastDirect({ ...lastDirect!, undone: useStore.getState().projectVersion })
            }}
            testid="agent.bar.undo"
          >
            {t('d22c.bar.undo')}
          </Button>
        </Tooltip>
      )}
      {barPhase === 'reply' && <SendLine from={['box', 'notes', 'band']} testid="agent.bar.sendLine" onlyQueued />}
      {done ? (
        <IconButton icon="x" size="sm" variant="ghost" label={t('d22c.bar.close')} onClick={() => useAgentStore.getState().closeBar(job?.start ?? null)} testid="agent.bar.close" />
      ) : (
        <Tooltip content={t('d22c.bar.stop.hint')}>
          <Button size="sm" variant="ghost" icon="square" onClick={() => stopAgent(j.client)} testid="agent.bar.stop">
            {t('d22c.bar.stop')}
          </Button>
        </Tooltip>
      )}
    </div>
  )
}

export function AgentRow(): JSX.Element | null {
  const draft = useAgentStore((s) => !!s.draft)
  const j = useAgentJob()
  // The agent's line has its place on screen (the timeline is): what the
  // agent changes is said here once, not in a toast and a label besides.
  useEffect(() => {
    useAgentStore.getState().setBarShown(true)
    return () => useAgentStore.getState().setBarShown(false)
  }, [])
  if (draft)
    return (
      <div className="agent-over">
        <ReviewStrip working={j.phase.phase === 'working'} />
      </div>
    )
  if (!j.job || j.client === null || j.phase.phase === 'none' || j.closed) return null
  return (
    <div className="agent-over">
      <AgentBar j={j} />
    </div>
  )
}
