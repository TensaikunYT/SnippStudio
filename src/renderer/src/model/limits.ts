// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a project can hold (security patch, item 9), in a module of its own
// (22 Nov 2026, K9) so that the file reader's repair (model/repair.ts) and the
// commands' parameter rules (commands/schema.ts) read the SAME numbers: a
// command accepted a time the reader then dropped ("clip.move start: 400000"
// moved a clip that was gone after save and open). Pure, no imports.

/**
 * The limits lie far outside any real project: a side of 16…8192 pixels (8K
 * is 7680), 1…240 frames a second, 100 hours on the timeline, a clip speed
 * of 0.01…10 000 (model/repair.ts says why the speed's range is that wide).
 */
export const PROJECT_LIMITS = { minSide: 16, maxSide: 8192, minFps: 1, maxFps: 240, maxTime: 360_000, minSpeed: 0.01, maxSpeed: 10_000 } as const
