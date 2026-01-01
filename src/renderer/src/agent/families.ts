// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which family an op is (SnippStudio phase 4A.9, FAZ4A-YENIDEN.md A2): a
// function of the command AND its parameters (deleting a clip with ripple
// moves the rest of its track; setting a clip's speed retimes what follows).
// A command not listed here cannot be sent by an agent (a test holds the
// list to every agent command). What each family means: replay.ts.
//
// The content families are kept few on purpose (the safety rule: be exact in
// a few, leave the rest to "the very same project, or dropped"). What could
// move out of `structural` later is in FAZ4A-PLAN.md 7.1 (K28).
export type Family = 'cut' | 'place' | 'record' | 'own' | 'line' | 'field' | 'add' | 'structural'

type P = Record<string, unknown>
const S = (): Family => 'structural'
const patchTimes = (p: P): boolean => {
  const patch = (p.patch ?? {}) as P
  return patch.start !== undefined || patch.end !== undefined || patch.layer !== undefined
}

export const FAMILIES: Readonly<Record<string, (params: P) => Family>> = {
  'timeline.cutRanges': () => 'cut',
  'timeline.cutRangeOnTrack': S,
  'silence.apply': S,
  'clip.delete': (p) => (p.ripple ? 'structural' : 'record'),
  'clip.move': S,
  'clip.moveToTrack': S,
  'clip.trimHead': () => 'own',
  'clip.trimEnd': (p) => ((p.delta as number) < 0 ? 'own' : 'structural'),
  'clip.slip': S,
  'clip.keepRange': () => 'own',
  'clip.split': (p) => (p.linkAV ? 'structural' : 'own'),
  'clip.add': S,
  'clip.addMedia': S,
  'clip.append': S,
  'clip.duplicate': S,
  'clip.set': (p) => (p.speed !== undefined ? 'structural' : 'record'),
  'clip.setTransform': () => 'record',
  'clip.setOpacity': () => 'record',
  'clip.setVolume': () => 'record',
  'clip.setMuted': () => 'record',
  'clip.setSpeed': S,
  'clip.setFades': () => 'record',
  'clip.setTransition': () => 'record',
  'transitions.mix': S,
  'transitions.preset': S,
  'transitions.clear': S,
  'motion.cinematize': S,
  'motion.gentlePan': S,
  'fx.stillImage': S,
  'audio.transitionSfx': () => 'field',
  'audio.risers': () => 'field',
  'text.add': () => 'place',
  'shape.add': S,
  'caption.update': (p) => (patchTimes(p) ? 'structural' : 'line'),
  'caption.editLine': (p) => (p.start !== undefined || p.end !== undefined ? 'structural' : 'line'),
  'caption.delete': () => 'line',
  'caption.setStyle': () => 'field',
  'caption.setOwnStyle': () => 'line',
  'caption.setShape': () => 'line',
  'marker.add': () => 'place',
  'marker.update': S,
  'marker.delete': S,
  'track.add': () => 'add',
  'track.delete': S,
  'track.move': S,
  'track.setMagnet': S,
  'template.place': S,
  'automation.placeImages': S,
  'broll.place': S
}

export function familyOf(name: string, params: P): Family {
  return (FAMILIES[name] ?? S)(params)
}
