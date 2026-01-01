// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The timeline core's time tolerances, in seconds, in one place (phase
// Ç2b.2, decision 7). The values are the ones the code had written out by
// hand; only where they are read from changed.

/** Float noise: two times this close are the same moment. */
export const EPS = 1e-6
/** A keyframe or a slice edge this close is the same one; the placement's
 *  search for a free lane steps by it. */
export const KEY_EPS = 1e-4
/** A millisecond: a time this far inside a clip is inside it (the clip a
 *  split at the playhead targets). */
export const MS_EPS = 0.001
/** The shortest piece a split or a kept range leaves: a cut closer than this
 *  to a clip's edge is no cut. */
export const EDGE_MIN = 0.05
/** Two clips on a track this close meet: one cut (a transition between
 *  them); the render, the timeline's junctions and the presets use it. */
export const JOIN_EPS = 0.06
