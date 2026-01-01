// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The film pipeline's input set: the voice and its two SRTs, written side by
// side into one folder (<name>.srt, <name>-words.srt, <name>.mp3). The films
// are made from exactly these three, so they are the SAME files the single
// "Subtitles (.srt)…" export writes, under the same names: one caption list,
// one writer, the subtitle lane only. Pure: the tests read it.
import type { Caption } from '../types'
import { safeFileName } from '../export/formats'
import { captionsToSrt } from './srt'

export interface VoiceSet {
  /** The three file names (basenames: they go into the folder chosen). */
  names: { sentences: string; words: string; sound: string }
  /** The sentence SRT and the word SRT, as the single SRT export writes them. */
  sentences: string
  words: string
  /** How many cues each holds (the export window's line). */
  cues: { sentences: number; words: number }
  /** Whether every subtitle carries word timings. One without them is
   *  written into the word SRT as its whole sentence (captionsToSrt's
   *  fallback), which is worth a word before writing it. */
  wordTimed: boolean
}

const cueCount = (srt: string): number => srt.split(/\r?\n\r?\n/).filter((b) => b.trim()).length

/** The set for a project, or null when there is no subtitle to write. */
export function voiceSet(projectName: string | null | undefined, captions: Caption[]): VoiceSet | null {
  const sentences = captionsToSrt(captions, { perWord: false })
  if (!sentences.trim()) return null
  const words = captionsToSrt(captions, { perWord: true })
  const base = safeFileName(projectName, 'subtitles')
  return {
    names: { sentences: `${base}.srt`, words: `${base}-words.srt`, sound: `${base}.mp3` },
    sentences,
    words,
    cues: { sentences: cueCount(sentences), words: cueCount(words) },
    wordTimed: captions.filter((c) => (c.layer ?? 0) === 0 && !c.shape && c.text.trim()).every((c) => (c.words?.length ?? 0) > 0)
  }
}
