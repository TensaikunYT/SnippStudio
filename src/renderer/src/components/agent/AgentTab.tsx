// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Agent tab (SnippStudio phase 4B.3, ANA-PLAN.md §3; TERMINAL-YOK-PLAN.md
// 10): the connection and its switch ("Connected · from outside", or where to
// connect one: Settings → Agent connection), which agent works on the
// project, the list of
// steps (every tool call: what, how long, its estimated tokens; "back to
// here"), "back to before the agent" (asks first), the token meter (with
// "the agent's own thinking is not included") and the apply setting. The
// agent works from its own chat: nothing of it runs in the app. What the user
// sends it from here (notes, a job, an answer on the draft) waits in its
// inbox: the tab says whether the agent's wait call is open now, and lists
// what went recently (GONDER-PLAN.md).
import { useEffect, useState } from 'react'
import { Button, Chip, Dialog, Icon, IconButton, Segmented, notify, useT } from '../../ui'
import { clock } from '../../agent/command'
import { restoreTo } from '../../agent/restore'
import { canGoBack, backTo } from '../../agent/steps'
import { refreshSession, useSession } from '../../agent/session'
import { AGENT_FRAME_WIDTHS, sessionTokens, useAgentStore, type ToolEvent } from '../../agent/store'
import { textTokens, imageTokens } from '../../agent/tokens'
import { AgentSwitch } from './AgentTop'
import { AgentsCard } from './AgentsCard'
import { openSettings } from '../settings/open'
import { useInbox, type Delivered } from '../../agent/inbox'
import { agentDisplayName } from '../../agent/holder'
import { workerColour } from './crew-colour'
import { useRegions } from './useRegions'
import { useStore } from '../../state/store'
import { t as tt, type StringKey } from '../../ui'
import { form } from '../../agent/count'
import { tokensText, whole } from './TokenCard'

/** One step's words. */
export function stepText(e: ToolEvent): string {
  const kind = e.kind ?? ''
  // (The team mode, step 3: a claim that was refused is said as that; whose
  // stretch it is stands under it.)
  if (e.tool === 'edit' && refusedBy(e) !== undefined) return tt('ekip3.step.refused.what')
  const what = (() => {
    switch (e.tool) {
      case 'project':
        return tt('agent.tool.project')
      case 'transcript':
        return tt('agent.tool.transcript')
      case 'frames':
        return tt('agent.tool.frames', { count: e.at?.length ?? 0 })
      case 'changes':
        return tt('agent.tool.changes')
      case 'analyze':
        return e.found ? tt('agent.tool.found', { count: e.found.length, kind }) : tt('agent.tool.analyze', { kind })
      case 'edit':
        // (The team mode, step 3: a call that only took or gave back a region.)
        if (!e.error && (e.kind === 'region.claim' || e.kind === 'region.release')) return tt(e.kind === 'region.claim' ? 'ekip3.step.claimed' : 'ekip3.step.released')
        // (D22, A13: what it changed in the user's words, not "clip.move".)
        return e.nothing ? tt('d22a.step.nothing') : tt('agent.tool.edit', { kind: e.said ?? kind })
      case 'notes':
        return tt('agent.tool.notes')
      case 'job':
        return tt('agent.tool.job', { kind })
      case 'wait':
        return e.kind === 'plan' ? tt('token.plan.noted') : tt('agent.tool.wait')
      default:
        return tt('agent.tool.other', { tool: e.tool })
    }
  })()
  const range = e.range ? ` · ${clock(e.range[0] * 1000)}–${clock(e.range[1] * 1000)}` : ''
  return e.error ? tt('agent.tool.failed', { what: what + range }) : what + range
}

function Connection(): JSX.Element {
  const t = useT()
  const status = useSession((s) => s.status)
  useEffect(() => void refreshSession(), [])
  const serverOn = !!status?.server?.running
  const line = (): { key: StringKey; params?: Record<string, string>; tone?: string } => {
    if (!status) return { key: 'agent.state.off' }
    if (status.server?.enabled && !serverOn && status.server.error) return { key: 'agent.state.error', params: { error: status.server.error }, tone: 'is-danger' }
    if (!serverOn) return { key: 'agent.state.off' }
    // (An agent from outside: a Claude Code or Codex that has the app added.)
    if (status.external) return { key: 'agent.state.external', params: { client: agentDisplayName(status.external.client) } }
    return { key: 'agent.state.notConnected', tone: 'is-warn' }
  }
  const l = line()
  return (
    <div className="agent-card" data-testid="agent.connection" data-state={status?.external && serverOn ? 'external' : serverOn ? 'server' : 'off'}>
      <div className="agent-row">
        <Icon name="bot" />
        <AgentSwitch testid="agent.tab.switch" />
      </div>
      <div className={`agent-line ${l.tone ?? ''}`} data-testid="agent.status">{l.params ? t(l.key, l.params) : t(l.key)}</div>
      {!status?.external && (
        <div className="agent-row">
          <Button size="sm" variant="secondary" icon="settings" onClick={() => openSettings('agent')} testid="agent.openSettings">
            {t('agent.openSettings')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** One item sent recently, in the user's words. */
function sentText(d: Delivered, nums: Map<string, number>): string {
  if (d.kind === 'notes') return tt('agent.inbox.notes', { nums: d.notes.map((id) => `#${nums.get(id) ?? '?'}`).join(', ') })
  if (d.kind === 'task') return tt('agent.inbox.task', { text: d.text.length > 80 ? d.text.slice(0, 79) + '…' : d.text })
  if (d.kind === 'handover') return tt('d22c.inbox.handover')
  return tt(d.outcome === 'rejected' ? 'agent.inbox.rejected' : d.outcome === 'partial' ? 'agent.inbox.partial' : 'agent.inbox.accepted')
}

const hhmm = (ms: number): string => new Date(ms).toTimeString().slice(0, 5)

/** Whether the agent waits for what the user sends, what is in line, and
 *  what went recently. */
function Inbox(): JSX.Element | null {
  const t = useT()
  const on = useSession((s) => !!s.status?.server?.running)
  const waiting = useInbox((s) => s.waiting)
  const queued = useInbox((s) => s.queued)
  const recent = useInbox((s) => s.recent)
  const notes = useStore((s) => s.project.notes)
  // (Its own name when an agent from outside is connected: "Claude Code".)
  const agentName = useSession((s) => s.status?.external?.client)
  if (!on && !recent.length) return null
  const nums = new Map((notes ?? []).map((n) => [n.id, n.num]))
  return (
    <div className="agent-card" data-testid="agent.inbox">
      <div className={`agent-line${waiting ? '' : ' is-warn'}`} data-testid="agent.wait" data-state={waiting ? 'waiting' : 'not-waiting'}>
        {waiting ? t('agent.wait.on') : t('agent.wait.off')}
      </div>
      {queued > 0 && <div className="agent-line" data-testid="agent.inbox.queued">{t('agent.wait.queued', { n: queued })}</div>}
      {!waiting && <div className="agent-line agent-hint" data-testid="agent.inbox.hint">{t('den2t.inbox.hint', { agent: agentName ? agentDisplayName(agentName) : t('den2t.agent.generic') })}</div>}
      {recent.length > 0 && (
        <>
          <div className="agent-card-title">{t('agent.inbox.title')}</div>
          <div className="agent-steps">
            {recent.map((d) => (
              <div className="agent-step" key={`${d.id}-${d.deliveredAt}`} data-testid={`agent.inbox.sent.${d.id}`}>
                <Icon name="send" size={14} />
                <span className="agent-step-text">{sentText(d, nums)}</span>
                <span className="agent-mono">{t('agent.inbox.to', { client: agentDisplayName(d.to), time: hhmm(d.deliveredAt) })}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Settings(): JSX.Element {
  const t = useT()
  const mode = useAgentStore((s) => s.mode)
  const width = useAgentStore((s) => s.frameWidth)
  return (
    <div className="agent-card" data-testid="agent.settings">
      <div className="agent-card-title">{t('agent.settings.title')}</div>
      <div className="agent-line">{t('agent.mode.label')}</div>
      <Segmented<'draft' | 'direct'>
        value={mode}
        options={[{ value: 'draft', label: t('agent.mode.draft') }, { value: 'direct', label: t('agent.mode.direct') }]}
        onChange={(m) => useAgentStore.getState().setMode(m)}
        label={t('agent.mode.label')}
        testid="agent.mode"
      />
      <div className="agent-line">{t('agent.settings.frameWidth')}</div>
      <Segmented
        value={width}
        options={AGENT_FRAME_WIDTHS.map((value) => ({ value, label: t('agent.settings.pixels', { value }) }))}
        onChange={(value) => useAgentStore.getState().setFrameWidth(value)}
        label={t('agent.settings.frameWidth')}
        testid="agent.frame.width"
      />
    </div>
  )
}

/** A claim that was refused: the worker that has that stretch (the answer
 *  names it), or undefined. */
const refusedBy = (e: ToolEvent): string | undefined => (e.error ? /is taken: worker "([^"]+)"/.exec(e.error)?.[1] : undefined)

/** The team mode, step 3: the stretches the workers took. Nothing when none. */
function Regions(): JSX.Element | null {
  const t = useT()
  const regions = useRegions()
  if (!regions.length) return null
  return (
    <div className="agent-card" data-testid="agent.regions">
      <div className="agent-card-title">{t('ekip3.regions.title')}</div>
      <div className="agent-zone-list" role="list">
        {regions.map((r) => (
          <div className="agent-zone-row" role="listitem" key={`${r.client}.${r.as}`} data-testid="agent.regions.row" data-worker={r.as}>
            <span className="agent-crew-dot" style={{ background: r.colour }} aria-hidden="true" />
            <span className="agent-zone-name">{r.as}</span>
            <span className="agent-zone-where">{r.tracks ? t('ekip3.region.row.tracks', { range: r.range, tracks: r.tracks }) : t('ekip3.region.row', { range: r.range })}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Steps(): JSX.Element {
  const t = useT()
  const events = useAgentStore((s) => s.events)
  const crews = useAgentStore((s) => s.crew)
  const sessions = useAgentStore((s) => s.sessions)
  const [asking, setAsking] = useState<{ id: string; n: number } | null>(null)
  // The team mode (EKIP-PLAN.md): each step says its worker; chips pick one.
  const [only, setOnly] = useState<string | null>(null)
  const last = events.slice(-40)
  const clientOf = (e: ToolEvent): string => e.client ?? sessions[e.session]?.client ?? ''
  const team = last.some((e) => e.as)
  const workers = team ? [...new Set(last.map((e) => e.as ?? ''))] : []
  const keyOf = (e: ToolEvent): string => `${e.as ?? ''}`
  const shown = team && only !== null ? last.filter((e) => keyOf(e) === only) : last
  const colourOf = (e: ToolEvent): string => workerColour(crews[clientOf(e)] ?? [], e.as)
  const nameOf = (as: string, client: string): string => as || agentDisplayName(client).split(' ')[0]
  return (
    <div className="agent-card" data-testid="agent.steps">
      <div className="agent-card-title">{t('agent.steps.title')}</div>
      {shown.length === 0 && <div className="agent-line">{t('agent.steps.none')}</div>}
      {team && (
        <div className="agent-crew-filter" role="group" aria-label={t('ekip.steps.filter')} data-testid="agent.steps.crew">
          <Chip onClick={() => setOnly(null)} pressed={only === null} testid="agent.steps.crew.all">{t('ekip.steps.all')}</Chip>
          {workers.map((w) => {
            const e = last.find((x) => keyOf(x) === w)!
            return (
              <Chip key={w} onClick={() => setOnly(only === w ? null : w)} pressed={only === w} testid={`agent.steps.crew.${w || 'main'}`}>
                <span className="agent-crew-dot" style={{ background: colourOf(e) }} aria-hidden="true" />
                <span>{nameOf(w, clientOf(e))}</span>
              </Chip>
            )
          })}
        </div>
      )}
      <div className="agent-steps">
        {shown.map((e, i) => {
          const n = events.length - last.length + last.indexOf(e) + 1
          return (
            <div className={`agent-step${!e.done ? ' is-running' : e.error ? ' is-error' : e.nothing ? ' is-nothing' : ''}`} key={e.id} data-testid={`agent.step.${n}`} data-nothing={e.nothing ? 'yes' : undefined}>
              <Icon name={!e.done ? 'loader-circle' : e.error ? 'circle-x' : e.nothing ? 'minus' : 'check'} size={14} />
              {team ? (
                // (A team: the worker on its own line above what it did, and
                // after whose change an op of it dropped under it.)
                <span className="agent-step-main">
                  <span className="agent-step-worker" data-testid={`agent.step.worker.${n}`} data-worker={e.as ?? ''}>
                    <span className="agent-crew-dot" style={{ background: colourOf(e) }} aria-hidden="true" />
                    <span>{nameOf(e.as ?? '', clientOf(e))}</span>
                  </span>
                  <span className="agent-step-text">{stepText(e)}</span>
                  {refusedBy(e) !== undefined && (
                    <span className="agent-step-after" data-testid={`agent.step.region.${n}`} data-refused={refusedBy(e)}>
                      {t('ekip3.step.refused', { name: refusedBy(e)! })}
                    </span>
                  )}
                  {e.region !== undefined && (
                    <span className="agent-step-after" data-testid={`agent.step.region.${n}`} data-region={e.region}>
                      {t('ekip3.step.region', { name: e.region })}
                    </span>
                  )}
                  {e.after !== undefined && (
                    <span className="agent-step-after" data-testid={`agent.step.after.${n}`} data-after={e.after}>
                      {t('ekip.drop.after', { name: nameOf(e.after, clientOf(e)) })}
                    </span>
                  )}
                </span>
              ) : (
                <span className="agent-step-text">{stepText(e)}</span>
              )}
              {e.done && <span className="agent-mono">{t('agent.steps.time', { ms: e.ms ?? 0 })}</span>}
              {e.done && <span className="agent-mono">{t('agent.steps.tokens', { n: Math.round(e.tokens ?? 0) })}</span>}
              <IconButton icon="undo-2" size="sm" variant="ghost" label={t('agent.steps.back')} disabled={!e.done || !canGoBack(e.id)} onClick={() => setAsking({ id: e.id, n })} testid={`agent.step.back.${n}`} />
            </div>
          )
        })}
      </div>
      <Dialog
        open={!!asking}
        title={t('agent.steps.backTitle')}
        onClose={() => setAsking(null)}
        width="sm"
        testid="agent.steps.ask"
        actions={
          <>
            <Button variant="ghost" onClick={() => setAsking(null)}>{t('agent.cancel')}</Button>
            <Button
              variant="primary"
              testid="agent.steps.ask.ok"
              onClick={() => {
                if (asking && backTo(asking.id)) notify({ text: t('agent.steps.backDone', { n: asking.n }) })
                setAsking(null)
              }}
            >
              {t('agent.confirm')}
            </Button>
          </>
        }
      >
        <div className="agent-line">{t('agent.steps.backAsk')}</div>
      </Dialog>
    </div>
  )
}

/** The finished jobs (TOKEN-PLAN.md, the job's summary): the same line as
 *  the agent bar's "Done" — when, how long, the changes, the tokens and,
 *  when it was measured, the saving against raw. The profile keeps 20. */
function Jobs(): JSX.Element {
  const t = useT()
  const jobs = useAgentStore((s) => s.jobs)
  const shown = jobs.slice(-5).reverse()
  const at = (ms: number): string => {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const kindKey = (k: string): StringKey => (['notes', 'task', 'draft', 'handover'].includes(k) ? `token.kind.${k}` : 'token.kind.free') as StringKey
  return (
    <div className="agent-card" data-testid="agent.jobs">
      <div className="agent-card-title">{t('token.jobs.title')}</div>
      {shown.length === 0 && <div className="agent-line">{t('token.jobs.none')}</div>}
      {shown.map((r) => {
        const saved = r.raw !== undefined && r.raw > r.tokens ? Math.round((1 - r.tokens / r.raw) * 100) : 0
        const bits = [at(r.start), clock(r.ms), t(`token.jobs.changes.${form(r.changed)}`, { n: r.changed }), tokensText(r.tokens, t), ...(saved >= 1 ? [t('token.bar.saved', { n: saved })] : [])]
        return (
          <div className="agent-job" key={`${r.client}:${r.start}`} data-testid="agent.job">
            <span className="agent-job-kind">{agentDisplayName(r.client)} · {t(kindKey(r.kind))}</span>
            {/* (Each number whole on its line: a narrow tab wraps between them, never inside one.) */}
            <span className="agent-mono agent-job-bits">
              {bits.map((b, i) => (
                <span className="agent-job-bit" key={i}>
                  {i < bits.length - 1 ? `${b} · ` : b}
                </span>
              ))}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Restore(): JSX.Element {
  const t = useT()
  const [asking, setAsking] = useState(false)
  return (
    <>
      <Button variant="secondary" size="sm" icon="rotate-ccw" onClick={() => setAsking(true)} testid="agent.restore">
        {t('agent.restore.button')}
      </Button>
      <Dialog
        open={asking}
        title={t('agent.restore.title')}
        onClose={() => setAsking(false)}
        width="sm"
        testid="agent.restore.ask"
        actions={
          <>
            <Button variant="ghost" onClick={() => setAsking(false)}>{t('agent.cancel')}</Button>
            <Button
              variant="primary"
              testid="agent.restore.ok"
              onClick={() => {
                setAsking(false)
                restoreTo().then(
                  () => notify({ text: t('agent.restored') }),
                  (e) => notify({ text: t('agent.restore.failed', { error: e instanceof Error ? e.message : String(e) }), kind: 'error' })
                )
              }}
            >
              {t('agent.confirm')}
            </Button>
          </>
        }
      >
        <div className="agent-line">{t('agent.restore.ask')}</div>
      </Dialog>
    </>
  )
}

function Meter(): JSX.Element | null {
  const t = useT()
  const sessions = useAgentStore((s) => s.sessions)
  const events = useAgentStore((s) => s.events)
  const last = Object.values(sessions).sort((a, b) => b.lastCall - a.lastCall)[0]
  if (!last) return null
  const mine = events.filter((e) => e.session === last.id && e.done)
  const frames = mine.reduce((n, e) => n + (e.images ?? []).reduce((m, i) => m + imageTokens(i.width, i.height), 0), 0)
  const text = mine.reduce((n, e) => n + textTokens(e.chars ?? 0), 0)
  const total = sessionTokens(last)
  const pct = (x: number): number => (total > 0 ? Math.round((x / total) * 100) : 0)
  return (
    <div className="agent-card" data-testid="agent.meter">
      <div className="agent-row">
        <span className="agent-line">{t('agent.meter.title')}</span>
        <span className="agent-mono" data-testid="agent.meter.value">{t('agent.meter.value', { n: whole(total) })}</span>
      </div>
      <div className="agent-meter-bar" aria-hidden="true">
        <span className="is-text" style={{ width: `${pct(text)}%` }} />
        <span className="is-frames" style={{ width: `${pct(frames)}%` }} />
        <span className="is-defs" style={{ width: `${pct(last.defsTokens)}%` }} />
      </div>
      <div className="agent-line">{t('agent.meter.split', { text: pct(text), frames: pct(frames), defs: pct(last.defsTokens) })}</div>
      <div className="agent-line">{t('agent.tokensNote')}</div>
    </div>
  )
}

export function AgentTab(): JSX.Element {
  return (
    <div className="agent-tab" data-testid="agent.tab">
      <Connection />
      <AgentsCard />
      <Inbox />
      <Regions />
      <Steps />
      <Jobs />
      <div className="agent-row">
        <Restore />
      </div>
      <Meter />
      <Settings />
    </div>
  )
}
