// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Several outputs in one run (DENEME-4, worker W): the export window's Video,
// Sound only and This frame are ticks, not a choice of one. The ones ticked
// are made one after another, each its own export job (its card, its line in
// the Renders panel, its Cancel), into the same folder under the same name
// with its own extension (name.mp4, name.wav, name.png). The save dialog is
// asked once, for the first; the others are placed beside it. A job that is
// cancelled or fails stops the ones after it. Pure: the jobs are passed in.

export type OutputKind = 'video' | 'gif' | 'sound' | 'frame'

/** The order they are made in: the long one first, the frame last. */
export const OUTPUT_ORDER: readonly OutputKind[] = ['video', 'gif', 'sound', 'frame']

/** The ticked outputs, in their order. */
export function chosenOutputs(on: Partial<Record<OutputKind, boolean>>): OutputKind[] {
  return OUTPUT_ORDER.filter((k) => !!on[k])
}

// The paths themselves: shared with the main process, which lets the window
// write exactly these (src/shared/output-paths.ts).
export { outputPaths, stemOf } from '../../../shared/output-paths'

/** A file's name alone (for the window's list of what will be written). */
export function fileNameOf(path: string): string {
  return path.replace(/^.*[\\/]/, '')
}

export interface OutputStep {
  kind: OutputKind
  /** Makes this output; true when its file is in place. */
  run: () => Promise<boolean>
}

/** Runs the steps in order; one that does not finish stops the rest. */
export async function runOutputs(steps: readonly OutputStep[]): Promise<{ done: OutputKind[]; stoppedAt?: OutputKind }> {
  const done: OutputKind[] = []
  for (const step of steps) {
    let ok = false
    try {
      ok = await step.run()
    } catch {
      ok = false
    }
    if (!ok) return { done, stoppedAt: step.kind }
    done.push(step.kind)
  }
  return { done }
}
