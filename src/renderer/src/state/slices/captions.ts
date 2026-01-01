// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The store's subtitle and text actions: lines, texts and shapes, their
// style, motion and keyframes, word times, splitting, compacting. Moved out of
// state/store.ts in SnippStudio phase 2B (no change).
import { captionMotionAt } from '../../playback/pose'
import { planCaptionSplit } from '../../subtitles/split'
import { remapMarkedWords, splitMarkerAtWordIndex } from '../../subtitles/marker'
import { moveCaptionWordEnd, moveCaptionWordStart } from '../../subtitles/timing'
import { defaultCaptionMotion, isSubtitle, uid } from '../../types'
import { clone } from '../../commands/ops/base'
import { addShape, addText, deleteCaptions, setCaptionOwnStyle, setCaptionShape, setCaptionStyle, updateCaption } from '../../commands/captions'
import { keyLocalAt, keyOnFrame } from '../../timeline/key-grid'
import { env, runKey, tellKeyedOffClip } from '../shared'
import { t } from '../../ui/strings'
import type { EditorState } from '../editor-state'
import type { GetState, Mutate, SetState } from './types'

export type CaptionActions = Pick<EditorState, 
  | 'setCaptions'
  | 'setSubtitles'
  | 'addCaptionAtPlayhead'
  | 'addShapeAtPlayhead'
  | 'setCaptionShape'
  | 'setCaptionMotion'
  | 'addCaptionKeyframe'
  | 'deleteCaptionKeyframe'
  | 'clearCaptionKeyframes'
  | 'setCaptionOwnStyle'
  | 'updateCaption'
  | 'setCaptionWordStart'
  | 'setCaptionWordEnd'
  | 'splitCaptionAtCursor'
  | 'deleteCaption'
  | 'setCaptionStyle'
  | 'setCaptionStyleShorts'
  | 'deleteCaptions'
  | 'replaceCaptionsInRange'
  | 'compactCaptions'
>

export function captionActions(set: SetState, get: GetState, mutate: Mutate): CaptionActions {
  return {
    setCaptions: (captions) => mutate((p) => void (p.captions = captions)),

    setSubtitles: (captions) =>
      mutate((p) => {
        const kept = p.captions.filter((c) => !isSubtitle(c))
        p.captions = [...kept, ...captions].sort((a, b) => a.start - b.start)
      }),
    // (The window's "+ Text" writes its placeholder in the window's language;
    // the command's own default, an agent's, stays English: phase 11b, U8.)
    addCaptionAtPlayhead: (text = t('caption.newText')) => {
      let id = ''
      mutate((p) => {
        id = addText.apply(p, { time: get().currentTime, text }, env())
      })
      set({ selectedCaptionIds: [id] })
      return id
    },

    addShapeAtPlayhead: (kind, highlightCaptionId) => {
      // ONE undo step for the whole thing: the caption and its shape are made
      // in one edit (commands/captions.ts, shape.add).
      let id = ''
      mutate((p) => {
        id = addShape.apply(p, { time: get().currentTime, kind, highlightCaptionId }, env(true))
      })
      set({ selectedCaptionIds: [id] })
      return id
    },

    setCaptionShape: (id, patch) => mutate((p) => setCaptionShape.apply(p, { id, patch }, env()), false),

    setCaptionMotion: (id, patch, commit = false) => {
      const was = get().project.captions.find((c) => c.id === id)
      if (was?.kfs?.length && keyLocalAt({ start: was.start, duration: was.end - was.start }, get().currentTime, get().project.settings.fps) === null) return tellKeyedOffClip()
      mutate((p) => {
        const cap = p.captions.find((c) => c.id === id)
        if (!cap) return
        if (cap.kfs && cap.kfs.length > 0) {
          // Keyframed: write at the playhead, so dragging a slider records the
          // move instead of silently editing a base nothing is reading.
          // On the frame grid, merged only on the same frame; none with the
          // playhead off the line (phase Ç2c.2, decision 1, K7, K19).
          const local = keyLocalAt({ start: cap.start, duration: cap.end - cap.start }, get().currentTime, p.settings.fps)
          if (local === null) return
          const near = keyOnFrame(cap.kfs, local, p.settings.fps)
          if (near) Object.assign(near, patch)
          else {
            cap.kfs.push({ ...captionMotionAt(cap, local), ...patch, id: uid(), time: local })
            cap.kfs.sort((a, b) => a.time - b.time)
          }
          return
        }
        cap.motion = { ...(cap.motion ?? defaultCaptionMotion()), ...patch }
      }, commit)
    },

    addCaptionKeyframe: (id) =>
      mutate((p) => {
        const cap = p.captions.find((c) => c.id === id)
        if (!cap) return
        const local = keyLocalAt({ start: cap.start, duration: cap.end - cap.start }, get().currentTime, p.settings.fps)
        if (local === null) return
        const value = captionMotionAt(cap, local)
        cap.kfs = cap.kfs ?? []
        const near = keyOnFrame(cap.kfs, local, p.settings.fps)
        if (near) Object.assign(near, value)
        else cap.kfs.push({ ...value, id: uid(), time: local })
        cap.kfs.sort((a, b) => a.time - b.time)
      }),

    deleteCaptionKeyframe: (id, kfId) =>
      mutate((p) => {
        const cap = p.captions.find((c) => c.id === id)
        if (!cap?.kfs) return
        cap.kfs = cap.kfs.filter((k) => k.id !== kfId)
        if (cap.kfs.length === 0) delete cap.kfs
      }),

    clearCaptionKeyframes: (id) =>
      mutate((p) => {
        const cap = p.captions.find((c) => c.id === id)
        if (!cap) return
        // The look it currently holds becomes the static offset, so clearing
        // the animation doesn't also snap the text somewhere else.
        const local = Math.min(
          Math.max(0, get().currentTime - cap.start),
          Math.max(0, cap.end - cap.start)
        )
        if (cap.kfs && cap.kfs.length > 0) cap.motion = captionMotionAt(cap, local)
        delete cap.kfs
      }),

    // A run of the same fields on the same text is one step (a colour picker
    // fires on every move: Ç2a patch, item 6), as setCaptionStyle.
    setCaptionOwnStyle: (id, patch) => mutate((p) => setCaptionOwnStyle.apply(p, { id, patch }, env()), false, runKey(`caption-own-style:${id}`, patch)),
    updateCaption: (id, patch, commit = true) =>
      mutate((p) => updateCaption.apply(p, { id, patch: patch as Record<string, unknown> }, env()), commit, `caption:${id}:${Object.keys(patch).join(',')}`),
    setCaptionWordStart: (id, index, start) => {
      const caption = get().project.captions.find((item) => item.id === id)
      if (!caption?.words?.length) return
      const adjusted = moveCaptionWordStart(caption.words, index, start, caption.start, caption.end)
      if (adjusted === caption.words) return
      mutate((p) => {
        const target = p.captions.find((item) => item.id === id)
        if (target) target.words = adjusted
      }, true, `caption-word:${id}:${index}`)
    },
    setCaptionWordEnd: (id, index, end) => {
      const caption = get().project.captions.find((item) => item.id === id)
      if (!caption?.words?.length) return
      const adjusted = moveCaptionWordEnd(caption.words, index, end, caption.start, caption.end)
      if (adjusted === caption.words) return
      mutate((p) => {
        const target = p.captions.find((item) => item.id === id)
        if (target) target.words = adjusted
      }, true, `caption-word-end:${id}:${index}`)
    },
    splitCaptionAtCursor: (id, text, cursor) => {
      let rightId: string | null = null
      let rightStart = 0
      mutate((p) => {
        const caption = p.captions.find((item) => item.id === id)
        if (!caption) return
        const nextCueStart = p.captions
          .filter((item) => item.id !== id && (item.layer ?? 0) === (caption.layer ?? 0) && item.start > caption.start)
          .reduce((next, item) => Math.min(next, item.start), Infinity)
        const plan = planCaptionSplit(caption, text, cursor, nextCueStart)
        if (!plan) return

        const oldMarker = caption.style?.marker
        const editedMarker = oldMarker?.enabled && oldMarker.words?.length && caption.text !== text
          ? { ...oldMarker, words: remapMarkedWords(caption.text, text, oldMarker.words) }
          : oldMarker
        const leftWordCount = [...plan.leftText.matchAll(/\S+/gu)].length
        const [leftMarker, rightMarker] = splitMarkerAtWordIndex(editedMarker, leftWordCount)
        const splitMarks = caption.marks && caption.text !== text && caption.marks.length ? remapMarkedWords(caption.text, text, caption.marks) : caption.marks

        const right = clone(caption)
        rightId = uid()
        right.id = rightId
        right.start = plan.rightStart
        right.end = plan.rightEnd
        right.text = plan.rightText
        if (plan.rightWords) right.words = plan.rightWords
        else delete right.words
        if (right.style && rightMarker) right.style.marker = rightMarker
        // Its motion keys stay on their instants: counted from its own start
        // now (phase Ç2c.2, report K11: it replayed the move from its start).
        if (right.kfs?.length) right.kfs = right.kfs.map((k) => ({ ...k, time: k.time - (right.start - caption.start) }))

        caption.end = plan.leftEnd
        caption.text = plan.leftText
        if (plan.leftWords) caption.words = plan.leftWords
        else delete caption.words
        if (caption.style && leftMarker) caption.style.marker = leftMarker
        // Your key words go with their side too.
        if (splitMarks) {
          caption.marks = splitMarks.filter((i) => i < leftWordCount)
          right.marks = splitMarks.filter((i) => i >= leftWordCount).map((i) => i - leftWordCount)
        }

        rightStart = right.start
        p.captions.push(right)
        p.captions.sort((a, b) => a.start - b.start)
      })
      if (rightId) set({ selectedCaptionIds: [rightId], currentTime: rightStart })
      return rightId
    },
    deleteCaption: (id) => mutate((p) => deleteCaptions.apply(p, { ids: [id] }, env())),
    setCaptionStyle: (patch) => mutate((p) => setCaptionStyle.apply(p, { patch }, env()), false, runKey('caption-style', patch)),

    setCaptionStyleShorts: (patch) =>
      mutate((p) => {
        if (patch === null) {
          delete p.captionStyleShorts
          return
        }
        p.captionStyleShorts = { ...(p.captionStyleShorts ?? clone(p.captionStyle)), ...patch }
      }, false, runKey('caption-style-shorts', patch)),
    deleteCaptions: (ids) => {
      mutate((p) => deleteCaptions.apply(p, { ids }, env()))
      set({ selectedCaptionIds: [] })
    },

    replaceCaptionsInRange: (a, b, caps) =>
      mutate((p) => {
        // Only subtitles inside the range go — a title or a shape that happens
        // to sit over the re-transcribed seconds is not the recogniser's to
        // delete.
        p.captions = p.captions
          .filter((c) => !isSubtitle(c) || c.end <= a + 0.01 || c.start >= b - 0.01)
          .concat(caps)
          .sort((x, y) => x.start - y.start)
      }),

    compactCaptions: () =>
      mutate((p) => {
        // Subtitles only. Stretching a title or a shape to meet the next
        // caption is not "filling a gap in the subtitles", it is moving
        // something the user placed.
        const subs = p.captions.filter(isSubtitle).sort((x, y) => x.start - y.start)
        for (let i = 0; i < subs.length - 1; i++) {
          // Extend each cue right up to the next one (never shrink).
          if (subs[i + 1].start > subs[i].end) subs[i].end = subs[i + 1].start
        }
        p.captions.sort((x, y) => x.start - y.start)
      })
  }
}
