// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where the user's last send stands (GONDER2-PLAN.md): the agent's wait took
// it ("Claude Code was waiting: it has it"), or it is in line because the
// agent is not waiting ("In line · paste it into the chat" + Copy), or the
// user copied it (it left the line: pasted into the chat by hand). One line
// for the four places that send (the command box, the notes' "Send to
// agent", Watch mode, the range band); the places that close after a send
// say it in a toast with the same words and the same Copy.
import { create } from 'zustand'
import { api } from '../platform'
import { t } from '../ui/strings'
import { notify } from '../ui/toast-core'
import { useStore } from '../state/store'
import { agentDisplayName, workingAgent } from './holder'
import { useInbox, withdrawItem } from './inbox'
import { pasteText, type PasteWhat } from './paste'

export type SendFrom = 'box' | 'notes' | 'band'

export interface LastSend {
  from: SendFrom
  /** Its number in the inbox. */
  inbox: number
  what: PasteWhat
}

export const useSendLine = create<{ last: LastSend | null; copied: number | null }>(() => ({ last: null, copied: null }))

export type LineState = 'taken' | 'queued' | 'copied'

/** How a send stands (pure). */
export function lineState(inbox: number, queuedIds: readonly number[], copied: number | null): LineState {
  if (copied === inbox) return 'copied'
  return queuedIds.includes(inbox) ? 'queued' : 'taken'
}

/** The agent a send went (or goes) to, as the user knows it. */
export function sendName(inbox: number): string {
  const to = useInbox.getState().recent.find((r) => r.id === inbox)?.to ?? workingAgent() ?? useInbox.getState().waiting?.client ?? null
  return to ? agentDisplayName(to) : t('gonder2.agent')
}

/** The words of the line. */
export function lineText(state: LineState, inbox: number): string {
  if (state === 'taken') return t('gonder2.line.taken', { name: sendName(inbox) })
  return t(state === 'copied' ? 'gonder2.line.copied' : 'gonder2.line.queued')
}

/** A send happened (the component, on the user's press). `toast`: say it
 *  in a toast too (the places that close or change after a send). */
export function noteSent(from: SendFrom, r: { id: number; taken: boolean }, what: PasteWhat, toast = false): void {
  useSendLine.setState({ last: { from, inbox: r.id, what }, copied: null })
  if (!toast) return
  if (r.taken) notify({ text: lineText('taken', r.id) })
  else notify({ text: lineText('queued', r.id), action: { label: t('gonder2.copy'), run: () => void copySent() } })
}

const write = async (text: string): Promise<boolean> => {
  if (!text) return false
  return (await api?.clipboardWriteText(text).catch(() => false)) ?? false
}

/** Copies what would be sent (it is not sent): the always-there "Copy the
 *  text" of each place. */
export async function copyWhat(what: PasteWhat): Promise<boolean> {
  const ok = await write(pasteText(what, useStore.getState().project, t))
  notify(ok ? { text: t('gonder2.copied') } : { text: t('notes.toast.copyFailed'), kind: 'error' })
  return ok
}

/** Copies the last send for the chat and takes it out of the line (pasted
 *  by hand, the agent must not get it twice from its next wait). */
export async function copySent(): Promise<boolean> {
  const last = useSendLine.getState().last
  if (!last) return false
  const ok = await write(pasteText(last.what, useStore.getState().project, t))
  if (!ok) {
    notify({ text: t('notes.toast.copyFailed'), kind: 'error' })
    return false
  }
  if (withdrawItem(last.inbox)) useSendLine.setState({ copied: last.inbox })
  notify({ text: t('gonder2.copied') })
  return true
}
