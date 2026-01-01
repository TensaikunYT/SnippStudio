// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agents on this project (DENEME-4, item 9; DENEME-2-PLAN-T.md; D22,
// worker C): "Working on this project: [Claude Code ▾]" — the connected
// agent programs, each with since when, and the user's pick of the one that
// works here (agent/holder.ts chooseAgent: the user's sends go to it, and
// only it may change the project). Under it: which one changes the project
// now, which ones asked and were told to wait, and the one click that hands
// it over. A draft the working agent left waits for Accept or Reject first;
// the old session is told politely, the new one is told the project is its
// (the audit's A11). Every program is called by its name ("Claude Code",
// never "claude-code"; a second chat of the same program is counted: A12).
// In the Agent tab, and with every connected session in Settings → Agent
// connection.
import { useState } from 'react'
import { Button, Dialog, Select, notify, useT, type SelectOption } from '../../ui'
import { agentDisplayName, chooseAgent, handTo, useHolder, workingAgent } from '../../agent/holder'
import { sendToInbox } from '../../agent/inbox'
import { LOCAL_CLIENT } from '../../agent/ready'
import { useAgentStore, type SessionInfo } from '../../agent/store'
import { acceptWholeDraft, rejectWholeDraft } from './draft-text'

const hhmm = (ms: number): string => new Date(ms).toTimeString().slice(0, 5)

export interface ProgramRow {
  client: string
  /** Its connected chats, and since when the first of them. */
  chats: number
  since: number | null
  /** It asked to change the project and was told to wait. */
  asked: boolean
}

/** The agent programs the selector lists: every connected one, the one that
 *  holds the project, the user's pick and those that asked (pure). */
export function programRows(sessions: Readonly<Record<string, SessionInfo>>, holder: string | null, chosen: string | null, asked: readonly string[]): ProgramRow[] {
  const rows = new Map<string, ProgramRow>()
  const row = (client: string): ProgramRow => {
    let r = rows.get(client)
    if (!r) rows.set(client, (r = { client, chats: 0, since: null, asked: false }))
    return r
  }
  for (const s of Object.values(sessions)) {
    const r = row(s.client)
    r.chats++
    r.since = r.since === null ? s.started : Math.min(r.since, s.started)
  }
  if (holder) row(holder)
  if (chosen) row(chosen)
  for (const a of asked) row(a).asked = true
  return [...rows.values()].sort((a, b) => agentDisplayName(a.client).localeCompare(agentDisplayName(b.client)))
}

export function AgentsCard({ sessions = false, testid = 'agent.agents' }: { sessions?: boolean; testid?: string }): JSX.Element | null {
  const t = useT()
  const holder = useHolder((s) => s.holder)
  const chosen = useHolder((s) => s.chosen)
  const asked = useHolder((s) => s.asked)
  const all = useAgentStore((s) => s.sessions)
  const draft = useAgentStore((s) => s.draft)
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pickedRef, setPicked] = useState(false)
  const list = Object.entries(all)
  const working = workingAgent({ holder, chosen })
  const rows = programRows(all, holder?.client ?? null, chosen, asked.map((a) => a.client))
  const owner = draft && draft.client !== LOCAL_CLIENT ? draft.client : null
  if (!rows.length && !owner && !(sessions && list.length)) return null
  /** The project goes to that program. Picked in the selector: it is the
   *  user's pick from now (its newest chat holds the project). The one
   *  click on a program that asked: handed over, no pick made. */
  const give = (client: string, picked = pickedRef): void => {
    const was = workingAgent()
    const newest = Object.values(all).filter((s) => s.client === client).sort((a, b) => b.lastCall - a.lastCall)[0]
    if (picked || !handTo(client)) chooseAgent(client, newest?.id)
    if (was !== client) {
      // (The new agent hears it on its next wait: the audit's A11.)
      sendToInbox({ kind: 'handover', to: client })
      notify({ text: t('den2t.agents.handed', { name: agentDisplayName(client) }) })
    }
    setAsking(null)
  }
  const switchTo = (client: string, picked: boolean): void => {
    setPicked(picked)
    // The working agent's draft is accepted or rejected first.
    if (owner && owner !== client) setAsking(client)
    else give(client, picked)
  }
  const label = (r: ProgramRow): string => {
    const name = agentDisplayName(r.client)
    if (r.chats === 0) return t(r.asked ? 'd22c.agents.option.asked' : 'd22c.agents.option.away', { name })
    return r.chats === 1 ? t('d22c.agents.option', { name, time: hhmm(r.since ?? 0) }) : t('d22c.agents.option.chats', { name, time: hhmm(r.since ?? 0), n: r.chats })
  }
  const options: SelectOption[] = [...(holder ? [] : [{ value: '', label: t('d22c.agents.option.none') }]), ...rows.map((r) => ({ value: r.client, label: label(r) }))]
  return (
    <div className={sessions ? 'settings-group' : 'agent-card'} data-testid={testid}>
      <div className={sessions ? 'settings-label' : 'agent-card-title'}>{t('den2t.agents.title')}</div>
      {rows.length > 0 && (
        <div className="agent-working">
          <span className="agent-line">{t('d22c.agents.working')}</span>
          <Select value={working ?? ''} options={options} size="sm" label={t('d22c.agents.working')} onChange={(v) => (v === '' ? chooseAgent(null) : v !== working ? switchTo(v, true) : undefined)} testid={`${testid}.working`} />
        </div>
      )}
      {holder ? (
        <div className="agent-line" data-testid={`${testid}.holder`}>{t('den2t.agents.holder', { name: agentDisplayName(holder.client) })}</div>
      ) : owner ? (
        <div className="agent-line" data-testid={`${testid}.holder`}>{t('d22c.agents.draftOf', { name: agentDisplayName(owner) })}</div>
      ) : chosen ? (
        <div className="agent-line" data-testid={`${testid}.holder`}>{t('d22c.agents.chosen', { name: agentDisplayName(chosen) })}</div>
      ) : (
        <div className="agent-line">{t('den2t.agents.none')}</div>
      )}
      {asked.map((a) => (
        <div className="agent-row" key={a.client} data-testid={`${testid}.asked.${a.client}`}>
          <span className="agent-line is-warn">{t('den2t.agents.asked', { name: agentDisplayName(a.client), time: hhmm(a.at) })}</span>
          <Button size="sm" variant="secondary" icon="arrow-right" onClick={() => switchTo(a.client, false)} testid={`${testid}.switch.${a.client}`}>
            {t('den2t.agents.switch', { name: agentDisplayName(a.client) })}
          </Button>
        </div>
      ))}
      {sessions &&
        list.map(([id, s], i) => {
          // (A second chat of the same program is told apart by its number.)
          const nth = list.slice(0, i + 1).filter(([, x]) => x.client === s.client).length
          const many = list.filter(([, x]) => x.client === s.client).length > 1
          const name = many ? t('d22c.agents.chat', { n: nth, name: agentDisplayName(s.client) }) : agentDisplayName(s.client)
          return (
            <div className="agent-line" key={id} data-testid={`${testid}.session.${s.client}`}>
              {t(holder?.session === id ? 'den2t.agents.session.working' : 'den2t.agents.session', { name, time: hhmm(s.lastCall ?? s.started) })}
            </div>
          )
        })}
      <Dialog
        open={!!asking}
        title={t('den2t.agents.draftFirst.title', { name: agentDisplayName(owner ?? '') })}
        onClose={() => setAsking(null)}
        width="sm"
        testid="agent.handover.ask"
        actions={
          <>
            <Button variant="ghost" onClick={() => setAsking(null)} testid="agent.handover.cancel">{t('agent.cancel')}</Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (draft) rejectWholeDraft(draft)
                if (asking) give(asking)
              }}
              testid="agent.handover.reject"
            >
              {t('d22c.review.rejectAll')}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                if (!draft || !asking) return
                const to = asking
                setBusy(true)
                void acceptWholeDraft(draft)
                  .then((ok) => ok && give(to))
                  .finally(() => setBusy(false))
              }}
              testid="agent.handover.accept"
            >
              {t('d22c.review.acceptAll')}
            </Button>
          </>
        }
      >
        <div className="agent-line">{t('den2t.agents.draftFirst', { name: agentDisplayName(owner ?? ''), to: agentDisplayName(asking ?? '') })}</div>
      </Dialog>
    </div>
  )
}
