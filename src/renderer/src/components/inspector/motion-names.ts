// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's entrance / exit and its movement while visible, by name (the
// interface audit's G8: the ids "slide-up", "ramp-right" were shown as they
// are, in the Inspector and in the clip's motion menu).
import type { ClipAnim, IdleStyle } from '../../types'
import { t, type StringKey } from '../../ui/strings'

/** 'ramp-right' → 'rampRight' (keys carry no hyphens). */
const camel = (id: string): string => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

export const animName = (kind: ClipAnim): string => t(`insp.anim.${camel(kind)}` as StringKey)
export const idleName = (kind: IdleStyle): string => t(`insp.idle.${kind}` as StringKey)
