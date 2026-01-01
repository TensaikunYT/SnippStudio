// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The interface audit's patch, worker A (tarifler\YAMA-ARAYUZ.md), around the
// timeline:
//   - G4: the "+" at a cut is a visible, grabbable button (at least 16 px to
//     see, a 24 px target) when the pointer is near the cut or a clip at the
//     cut is selected; elsewhere on the lane it stays a faint dot (the
//     timeline is not crowded).
export const name = 'yama-a-timeline'

/** The "+" of a cut: its drawn size and opacity, and its target's size. */
const plusOf = (c, clipId) =>
  c.run((id) => {
    const target = document.querySelector(`[data-testid="timeline.junction.${id}.add"]`)
    if (!target) return null
    const plus = target.firstElementChild
    const r = plus.getBoundingClientRect()
    const t = target.getBoundingClientRect()
    return { w: Math.round(r.width * 10) / 10, opacity: parseFloat(getComputedStyle(plus).opacity), target: [Math.round(t.width), Math.round(t.height)] }
  }, clipId)

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  const [first, second] = await lib.clipList(c)
  await c.st((s) => s.selectClips([]))
  const junction = await c.box(`timeline.junction.${first.id}`)
  const lane = await c.box(`timeline.track.${first.trackId}`)
  assert.ok(junction && lane, 'the cut and its lane')

  // Far from the cut, on the same lane: a faint dot only.
  await c.mouse('mouseMoved', junction.cx - 160, lane.y + lane.h * 0.6)
  await c.sleep(350)
  const far = await plusOf(c, first.id)
  // Near the cut (the middle of the lane, not on the target itself).
  await c.mouse('mouseMoved', junction.cx + 6, lane.y + lane.h * 0.6)
  await c.sleep(350)
  const near = await plusOf(c, first.id)
  // A clip of the cut selected, the pointer away from the timeline.
  await c.mouse('mouseMoved', 5, 5)
  await c.st((s, id) => s.selectClips([id]), second.id)
  await c.sleep(350)
  const selected = await plusOf(c, first.id)
  console.log(`     G4: far ${JSON.stringify(far)}; near ${JSON.stringify(near)}; a clip of the cut selected ${JSON.stringify(selected)}`)
  assert.ok(near.w >= 16 && near.opacity >= 0.9, `near the cut: at least 16 px and opaque (${near.w}, ${near.opacity})`)
  assert.ok(selected.w >= 16 && selected.opacity >= 0.9, `a clip of the cut selected (${selected.w}, ${selected.opacity})`)
  assert.deepEqual(near.target, [24, 24], 'a 24 px target')
  assert.ok(far.w < 10, `far from it: a dot (${far.w})`)
  // Still one click away: the click adds the transition.
  await c.click(`timeline.junction.${first.id}.add`)
  await c.waitFor('a transition', () => c.st((s, id) => !!s.project.clips[id].transitionOut, first.id))
}
