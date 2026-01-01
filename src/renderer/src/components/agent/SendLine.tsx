// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The one line under a send button (GONDER2-PLAN.md): the agent took it, or
// it is in line with a Copy beside it; and the always-there "Copy the text"
// button. Words and rules: agent/send-line.ts.
import { useEffect, useRef } from 'react'
import { Button, IconButton, useT } from '../../ui'
import { revealIn } from '../../ui/reveal'
import { useInbox } from '../../agent/inbox'
import { copySent, copyWhat, lineState, lineText, useSendLine, type SendFrom } from '../../agent/send-line'
import type { PasteWhat } from '../../agent/paste'

/** Where the last send from `from` stands; nothing when it was not from there. */
export function SendLine({ from, testid, onlyQueued = false }: { from: SendFrom | readonly SendFrom[]; testid: string; onlyQueued?: boolean }): JSX.Element | null {
  const t = useT()
  const last = useSendLine((s) => s.last)
  const copied = useSendLine((s) => s.copied)
  const queuedIds = useInbox((s) => s.queuedIds)
  // (The agent's name in "it has it" comes from the recent list.)
  useInbox((s) => s.recent)
  const mine = !!last && (typeof from === 'string' ? last.from === from : from.includes(last.from))
  const ref = useRef<HTMLDivElement>(null)
  const state = last ? lineState(last.inbox, queuedIds, copied) : null
  // (Brought into view when it changes: under a button at the foot of a
  // panel that scrolls, the line would be out of sight.)
  useEffect(() => {
    if (mine && state) revealIn(ref.current, 'nearest')
  }, [mine, state, last?.inbox])
  if (!last || !mine || !state) return null
  if (onlyQueued && state !== 'queued') return null
  return (
    <div ref={ref} className={`send-line is-${state}`} role="status" data-testid={testid} data-state={state}>
      <span className="send-line-text" data-testid={`${testid}.text`}>{lineText(state, last.inbox)}</span>
      {state === 'queued' && (
        <Button size="sm" variant="secondary" icon="copy" onClick={() => void copySent()} testid={`${testid}.copy`}>
          {t('gonder2.copy')}
        </Button>
      )}
    </div>
  )
}

/** "Copy the text": what would be sent, for the agent's chat (not sent). */
export function CopyText({ what, testid }: { what: () => PasteWhat | null; testid: string }): JSX.Element {
  const t = useT()
  return (
    <IconButton
      icon="copy"
      size="sm"
      variant="ghost"
      label={t('gonder2.copyText')}
      onClick={() => {
        const w = what()
        if (w) void copyWhat(w)
      }}
      testid={testid}
    />
  )
}
