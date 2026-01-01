// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Sequences the random runs failed on while the core was being built
// (SnippStudio phase 4A.9, A8), shrunk and kept: each must give no violation.
// What each one caught is in its `what`; plan 7.3 lists them.
import type { Step } from './run'

export interface FixedCase {
  what: string
  seed: number
  shape: number
  mode: 'draft' | 'direct'
  steps: Step[]
  /** The core of this tree still gets it wrong, and the oracle must SEE it
   *  (a violation of this kind): kept red until its fix lands (plan 8.0),
   *  then this line goes. */
  red?: string
}

export const FIXED: FixedCase[] = [
  {
    what: 'a cut range that lies in two places now is cut whole or not at all (one place held what the user put there; the other was cut and the range reported as left out)',
    ...{"seed": 319, "shape": 3, "mode": "draft", "steps": [{"k": "read"}, {"k": "edit", "from": 0, "ops": [{"op": "timeline.cutRanges", "ranges": [[10.26, 11.76], "L1#3"]}]}, {"k": "user", "cls": "cut", "act": {"t": "cut", "range": [28.91, 29.52]}}, {"k": "read"}, {"k": "edit", "from": 0, "ops": [{"op": "timeline.cutRanges", "ranges": [[29.38, 30.16]]}]}, {"k": "user", "cls": "move", "act": {"t": "batch", "name": "clip.move", "params": {"clipId": "0e7aa1fa-9c86", "start": 32.71}}}, {"k": "user", "cls": "delete", "act": {"t": "batch", "name": "clip.delete", "params": {"ids": ["vo1"]}}}, {"k": "analyze", "ranges": [[31.13, 31.92]]}, {"k": "edit", "from": 0, "ops": [{"op": "apply", "result": "r1"}]}, {"k": "user", "cls": "move", "act": {"t": "batch", "name": "clip.move", "params": {"clipId": "274fc51b-0e61", "start": 32.68}}}]}
  },
  {
    what: 'a cut on a locked voice track slides the subtitles along the sound: a mark is for the word, not for the word that lies over its sound now',
    ...{"seed": 2509, "shape": 1, "mode": "draft", "steps": [{"k": "read"}, {"k": "read"}, {"k": "user", "cls": "lock", "act": {"t": "lock", "track": "A1"}}, {"k": "edit", "from": 1, "ops": [{"op": "caption.update", "id": "L2", "patch": {"marks": [1]}}]}, {"k": "user", "cls": "cut", "act": {"t": "cut", "range": [2.63, 3.18]}}]}
  },
  {
    what: 'the user retypes a line the agent retyped, then takes it back: the text of the agent is back in the draft',
    ...{"seed": 1639, "shape": 3, "mode": "draft", "steps": [{"k": "read"}, {"k": "edit", "from": 0, "ops": [{"op": "caption.editLine", "id": "L7", "text": "RIVER stone!"}]}, {"k": "user", "cls": "capText", "act": {"t": "batch", "name": "caption.editLine", "params": {"id": "L7", "text": "ri ver stone light paper"}}}, {"k": "user", "cls": "undo", "act": {"t": "undo"}}]}
  },
  {
    what: 'deleting the music bed after a split of the voice takes four subtitle words whose sound is still there (K-1 of the command layer, run as a structural op: an op whose own reference run loses words is not made)',
    ...{"seed":269,"shape":1,"mode":"draft","steps":[{"k":"read"},{"k":"edit","from":0,"ops":[{"op":"clip.split","clipIds":["a1"],"time":13.66}]},{"k":"analyze","ranges":[[31.77,32.32]]},{"k":"edit","from":0,"ops":[{"op":"clip.delete","ids":["m1"]}]}]}
  }
] as FixedCase[]
