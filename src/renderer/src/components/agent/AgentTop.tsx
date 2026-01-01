// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent in the top bar (SnippStudio phase 4B; D22, worker C): the switch
// "Agent access", and ONE small chip — the agent program's name and a dot
// that says how it stands (working: it pulses; quiet: still; waiting for the
// user: a ring; a draft waits: full). A press opens the Agent tab. The bar
// used to say two things that could contradict each other ("working · 01:06"
// for 120 s after the last call, beside "waiting for you" and "Draft waits";
// the audit's A7, L5): what the agent does now is said in one place, the
// line over the timeline (AgentRow.tsx). A call that failed is not a red
// chip any more: the line says the step did not go through.
// The chip also sets the page's `data-agent-program` (agent/program.ts): the
// agent's colour is its program's.
import { useEffect } from 'react'
import { BareButton, Toggle, Tooltip, useT } from '../../ui'
import { form } from '../../agent/count'
import { useCrew } from './useCrew'
import { agentDisplayName } from '../../agent/holder'
import { programOf } from '../../agent/program'
import { LOCAL_CLIENT } from '../../agent/ready'
import { connectAgent, listenSession, useSession } from '../../agent/session'
import { useAgentStore } from '../../agent/store'
import { useAgentJob } from './useJob'

/** Agent access (the agent server): on opens the port, off closes it. The
 *  agents themselves are connected in Settings → Agent connection. */
export function AgentSwitch({ testid }: { testid: string }): JSX.Element {
  const t = useT()
  const status = useSession((s) => s.status)
  const busy = useSession((s) => s.busy)
  useEffect(() => listenSession(), [])
  return <Toggle checked={!!status?.server?.running} onChange={(on) => void connectAgent(on)} label={t('agent.switch')} disabled={busy || !status} testid={testid} />
}

export type ChipState = 'draft' | 'working' | 'quiet' | 'waiting' | 'reply' | 'done' | 'idle'

/** How the one chip stands (pure). GONDER2-PLAN.md: "done" is said two ways —
 *  the agent's wait is open ("waiting for you": what you send reaches it at
 *  once), or its session is there without a wait ("awaits your reply": it
 *  ended its turn, what you send waits in line, the chat is where to write);
 *  "done" alone once its session is gone. */
export function chipState(s: { draft: boolean; phase: 'none' | 'working' | 'quiet' | 'done'; waiting: boolean; closed: boolean; alive?: boolean }): ChipState {
  if (s.phase === 'working') return 'working'
  if (s.draft) return 'draft'
  if (s.phase === 'quiet') return 'quiet'
  if (s.waiting) return 'waiting'
  if (s.phase === 'done') return s.alive ? 'reply' : s.closed ? 'idle' : 'done'
  return 'idle'
}

/** The program's small mark beside its name (GONDER2-PLAN.md): one colour,
 *  the program's; drawn here, nothing downloaded. Only a program whose mark
 *  is sure has one (Claude Code's spark); any other: a plain dot. It only
 *  says which program is connected; the name is always beside it. */
function ProgramMark({ program, name }: { program: string; name: string }): JSX.Element {
  if (program === 'claude') {
    const rays = Array.from({ length: 12 }, (_, i) => i * 30)
    return (
      <svg className="agent-pill-mark" viewBox="0 0 16 16" aria-hidden="true" data-mark="claude">
        {rays.map((r, i) => (
          <rect key={r} x="7.1" y={i % 2 ? 1.6 : 0.6} width="1.8" height={i % 2 ? 6 : 7} rx="0.9" transform={`rotate(${r} 8 8)`} />
        ))}
      </svg>
    )
  }
  if (program === 'codex') {
    // (son, item C) A terminal prompt in a rounded frame: the CLI's own sign.
    return (
      <svg className="agent-pill-mark is-line" viewBox="0 0 16 16" aria-hidden="true" data-mark="codex">
        <rect x="1" y="1.5" width="14" height="13" rx="3.5" />
        <path d="M4.6 5.6 7.2 8l-2.6 2.4M8.6 10.6h3" />
      </svg>
    )
  }
  // (son, item C) Opencode, Antigravity and any other program: a small round
  // badge in the program's colour with its initial (no neutral dot).
  const initial = (name.trim()[0] ?? '').toUpperCase()
  return (
    <svg className="agent-pill-mark is-badge" viewBox="0 0 16 16" aria-hidden="true" data-mark={program}>
      <circle cx="8" cy="8" r="7.5" />
      <text x="8" y="8.4" textAnchor="middle" dominantBaseline="central">{initial}</text>
    </svg>
  )
}

export function AgentChip(): JSX.Element | null {
  const t = useT()
  const j = useAgentJob()
  const draft = useAgentStore((s) => s.draft)
  const crew = useCrew(j)
  // The agent's colour: its program's (none: the app's own orange).
  const client = draft ? (draft.client === LOCAL_CLIENT ? null : draft.client) : j.client
  const program = client ? programOf(client) : null
  useEffect(() => {
    const root = document.documentElement
    if (program) root.dataset.agentProgram = program
    else delete root.dataset.agentProgram
  }, [program])
  const shown = !!draft || j.alive || (!!j.job && j.phase.phase !== 'none' && !j.closed)
  if (!shown) return null
  const state = chipState({ draft: !!draft, phase: j.phase.phase, waiting: j.waiting, closed: j.closed, alive: j.alive })
  const name = client ? agentDisplayName(client) : t('agent.name.local')
  const who = crew.workers.length ? t(`ekip.bar.team.${form(crew.workers.length)}`, { name, n: crew.workers.length }) : name
  return (
    <Tooltip content={state === 'reply' ? t('gonder2.chip.reply', { name }) : t(`d22c.chip.${state}`, { name })}>
      <BareButton className={`agent-pill is-${state}`} onClick={() => useAgentStore.getState().requestTab()} testid="agent.chip" data-state={state} data-program={program ?? ''}>
        <span className="agent-chip" data-testid="agent.activity" data-state={state} data-program={program ?? ''}>
          <span className={`agent-pill-ring${state === 'working' ? ' is-live' : ''}`} aria-hidden="true" />
          <ProgramMark program={program ?? 'other'} name={name} />
          <span className="agent-pill-text">
            <span className="agent-pill-name" data-testid="agent.chip.name">{who}</span>
            <span className="agent-pill-state" data-testid="agent.chip.state">{t(`gonder2.phase.${state}`)}</span>
          </span>
        </span>
      </BareButton>
    </Tooltip>
  )
}
