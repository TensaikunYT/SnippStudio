// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Every command, by name, and the batch: several commands as one edit.
import type { Project } from '../types'
import { withIds } from '../types'
import { CommandError, checkParams, defaultEnv, produceEdit, withinLimits, type Command, type CommandEnv } from './core'
import { applySilence, cutCaptionRange, cutRangeOnTrack, cutRanges, rippleTrim } from './timeline'
import {
  addClip, addMedia, appendClip, deleteClips, duplicateClips, keepRange, moveClip, moveClipToTrack, placeClips, setClip, setFades, setMuted,
  setOpacity, setSpeed, setSpeedCurve, setTransform, setTransition, setVolume, slipClip, splitClips, trimEnd, trimHead, unlinkClips
} from './clips'
import { cinematize, clearTransitions, gentlePan, mixTransitions, presetTransitions, risers, stillImageFx, transitionSfx } from './effects'
import { addShape, addText, deleteCaptions, editLine, setCaptionOwnStyle, setCaptionShape, setCaptionStyle, updateCaption } from './captions'
import { addMarker, deleteMarker, updateMarker } from './markers'
import { addTrack, deleteTrack, moveTrack, renameTrack, setMagnet } from './tracks'
import { placeTemplate } from './templates'
import { placeBroll, placeImages } from './automation'
import { addNote, deleteNote, setNoteStatus, updateNote } from './notes'
import { setCodeEdits, setCodeParams, setProjectLook } from './codefilm'
import { setAgentLock } from './agent-lock'
import { setClipLabel } from './clip-label'

export * from './core'
export { s, validate, type Infer, type JsonSchema, type Schema } from './schema'

const LIST: Command<never, unknown>[] = [
  cutRanges, cutRangeOnTrack, cutCaptionRange, applySilence, rippleTrim,
  deleteClips, moveClip, moveClipToTrack, placeClips, trimHead, trimEnd, slipClip, keepRange, splitClips, addClip, addMedia, appendClip, duplicateClips, unlinkClips,
  setClip, setTransform, setOpacity, setVolume, setMuted, setSpeed, setSpeedCurve, setFades, setTransition,
  mixTransitions, presetTransitions, clearTransitions, cinematize, gentlePan, stillImageFx, transitionSfx, risers,
  addText, addShape, updateCaption, editLine, deleteCaptions, setCaptionStyle, setCaptionOwnStyle, setCaptionShape,
  addMarker, updateMarker, deleteMarker,
  addTrack, deleteTrack, moveTrack, renameTrack, setMagnet,
  placeTemplate, placeImages, placeBroll,
  addNote, updateNote, setNoteStatus, deleteNote,
  setCodeParams, setProjectLook, setCodeEdits,
  setAgentLock, setClipLabel
] as unknown as Command<never, unknown>[]

/** Every command, the internal ones included (the store's). */
export const COMMANDS: Readonly<Record<string, Command>> = Object.freeze(
  Object.fromEntries(LIST.map((c) => [c.name, c as unknown as Command]))
)

/** What an agent may call: the agent tools are built from these (phase 4). */
export const AGENT_COMMANDS: Readonly<Record<string, Command>> = Object.freeze(
  Object.fromEntries(Object.entries(COMMANDS).filter(([, c]) => !c.internal))
)

/** A command by name, as an agent calls it (internal ones are refused). */
export function commandByName(name: string): Command {
  const cmd = COMMANDS[name]
  // (The notes are answered with the notes tool, not edit: not listed.)
  if (!cmd) throw new CommandError(name, `there is no such command (known: ${Object.keys(AGENT_COMMANDS).filter((n) => !n.startsWith('note.')).join(', ')})`)
  if (cmd.internal) throw new CommandError(name, 'is internal to the app and cannot be called by name')
  return cmd
}

export interface CommandCall {
  name: string
  params?: unknown
}

export interface CheckedCall {
  cmd: Command
  params: unknown
  /** Its place in the batch (0-based), for the error message. */
  index?: number
  /** A shift made with an earlier call's, as one move (moveGroups): not run
   *  again; its result is undefined. */
  merged?: true
}

/** Every call's name and parameters checked, all problems at once: a
 *  CommandError listing them when any is wrong. */
export function checkBatch(calls: readonly CommandCall[]): CheckedCall[] {
  const problems: string[] = []
  const checked: CheckedCall[] = []
  calls.forEach((call, i) => {
    try {
      const cmd = commandByName(call?.name)
      checked.push({ cmd, params: checkParams(cmd, call.params ?? {}), index: i })
    } catch (e) {
      problems.push(`#${i + 1} ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  // Notes are applied outside the film's undo step, so in a batch that has
  // both they come last (their times are then the edited film's).
  const firstNote = checked.findIndex((c) => isNoteCommand(c.cmd.name))
  if (firstNote >= 0 && checked.slice(firstNote).some((c) => !isNoteCommand(c.cmd.name))) {
    problems.push(`#${firstNote + 1} ${checked[firstNote].cmd.name}: in a batch with film edits, the note.* calls come after all of them`)
  }
  if (problems.length > 0) throw new CommandError('batch', 'nothing was applied', problems)
  // Shifts written one after another are one move (D22, K8).
  const groups = moveGroups(checked.map((c) => ({ name: c.cmd.name, params: c.params })), true)
  for (const g of groups) {
    checked[g[0]] = { ...checked[g[0]], params: mergedMove(g.map((i) => checked[i].params as MoveParams)) }
    for (const i of g.slice(1)) checked[i] = { ...checked[i], merged: true }
  }
  return checked
}

type MoveParams = { clipId?: string; clipIds?: string[]; start?: number; by?: number; linkAV?: boolean; push?: boolean }

/**
 * The clip.move calls of a batch that are ONE move (D22, K8): shifts (`by`)
 * of the same amount, with the same linkAV and push. Written one after
 * another, each from where the one before left the clips, "every clip 10 s
 * later" in timeline order sent the last clip 30 s later (each landed on
 * the next and pushed it). As one move of all their clips they are resolved
 * against where the clips were. `adjacent`: only calls that follow each
 * other (a batch is a sequence); otherwise every such call of the list (an
 * agent's edit call: all its ops are written in one version's times).
 * Returns the groups of two or more, each a list of indices, in order.
 */
export function moveGroups(calls: readonly CommandCall[], adjacent: boolean): number[][] {
  const groups: number[][] = []
  const open = new Map<string, { at: number[]; ids: Set<string> }>()
  calls.forEach((c, i) => {
    const a = (c.params ?? {}) as MoveParams
    const shift = c.name === 'clip.move' && typeof a.by === 'number' && a.start === undefined && (a.clipId === undefined) !== (a.clipIds === undefined)
    if (!shift) return void (adjacent && open.clear())
    const key = `${a.by}|${a.linkAV === true}|${a.push === undefined ? '' : a.push}`
    if (adjacent && !open.has(key)) open.clear()
    const ids = idsOfMove(a)
    const g = open.get(key)
    // (A clip named again is a second shift of it, not the same one.)
    if (g && !ids.some((id) => g.ids.has(id))) {
      g.at.push(i)
      ids.forEach((id) => g.ids.add(id))
    } else {
      const made = { at: [i], ids: new Set(ids) }
      open.set(key, made)
      groups.push(made.at)
    }
  })
  return groups.filter((g) => g.length > 1)
}

const idsOfMove = (m: MoveParams): string[] => m.clipIds ?? (m.clipId !== undefined ? [m.clipId] : [])

/** The one move a group (moveGroups) is: all their clips, by their amount. */
export function mergedMove(members: readonly MoveParams[]): MoveParams {
  const { clipId: _one, clipIds: _many, ...rest } = members[0]
  return { ...rest, clipIds: [...new Set(members.flatMap(idsOfMove))] }
}

/** Note commands: a note's text and status are not the film, so they make no
 *  undo step (FAZ1-PLAN.md K6). */
export const isNoteCommand = (name: string): boolean => name.startsWith('note.')

/**
 * Checked calls run one after another, each its own edit — so subtitles
 * follow their voice clip and notes their picture after every call, exactly
 * as the same calls made one by one would leave them. The first that fails
 * throws (nothing of the batch is kept: the caller still holds the project it
 * started from).
 */
export function applySequence(project: Project, checked: readonly CheckedCall[], env: CommandEnv): { project: Project; results: unknown[] } {
  const results: unknown[] = []
  let cur = project
  checked.forEach(({ cmd, params, merged }, i) => {
    if (merged) return void results.push(undefined)
    try {
      cmd.check?.(cur, params as never)
      const next = withIds(env.newId, () =>
        produceEdit(cur, (d) => {
          results.push(cmd.apply(d, params as never, env))
        }, cmd.name)
      )
      // (No clip beyond what a project can hold: core.ts withinLimits, K9.)
      withinLimits(cur, next, cmd.name)
      cur = next
    } catch (e) {
      throw new CommandError('batch', `nothing was applied: #${(checked[i].index ?? i) + 1} ${cmd.name} failed`, [e instanceof Error ? e.message : String(e)])
    }
  })
  return { project: cur, results }
}

/**
 * Several commands as ONE edit, pure: every call is checked first (name and
 * parameters, all problems at once), then they run one after another (see
 * applySequence). If any of them fails nothing is applied — the CommandError
 * says which one. A seeded env.random makes the random choices repeatable.
 */
export function applyBatch(
  project: Project,
  calls: readonly CommandCall[],
  env: CommandEnv = defaultEnv()
): { project: Project; results: unknown[] } {
  return applySequence(project, checkBatch(calls), env)
}
