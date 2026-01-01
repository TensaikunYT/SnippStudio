// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Who may read what over the app's own schemes (5a/5b patch, audit C-1 + C-2).
//
// The fence was the film page's content security policy plus a CORS answer
// naming the editor. Neither holds: a film's .svg opened in a frame and a
// worker started from its folder get no policy of their own, and Chromium
// enforces no CORS for these custom schemes. So the main process decides per
// request, in the session's request filter, from what Chromium itself says
// about the requester (the frame that asked and its ancestors, the referrer),
// never from anything the page writes into the request:
//   - a request that comes from a code film (its host page, the film, any frame
//     inside it, any worker of it) never gets media:// (the user's media) and
//     never another film's snippfilm:// folder;
//   - a request whose requester cannot be told (no frame, no referrer) gets
//     neither scheme either (fail closed);
//   - the editor (a frame chain with no film in it) gets both, as before.
// Pure: tested in Node (src/test/film-fence.test.ts).

// Requests the session's filter never sees: a worker's (its script and
// everything it asks for) reach the protocol handlers without passing the
// filter (measured, e2e 65), and the handlers see nothing of who asked. So the
// filter stamps every request it let through with a secret header the page
// never learns (FENCE_HEADER, set after the page, over any value the page
// wrote), and the handlers serve only stamped requests: what the fence did not
// judge is refused. A film's worker therefore reads nothing over these schemes,
// not even its own folder (fail closed; no film on this machine starts a
// worker from a file of its folder, FAZ5-PLAN.md).

/** The header the request filter stamps admitted requests with. */
export const FENCE_HEADER = 'x-snipp-fence'

/** Was this request judged and admitted by the filter? (`stamp` is the
 *  request's FENCE_HEADER, `secret` this run's.) OPTIONS carries no content
 *  and is answered without. */
export function admitted(method: string, stamp: string | null, secret: string): boolean {
  if (method === 'OPTIONS') return true
  return !!secret && stamp === secret
}

/** The film id (16 hex) of a snippfilm:// address or origin, or ''. */
export function filmIdIn(u: string | null | undefined): string {
  const m = u ? /^snippfilm:\/\/([a-f0-9]{16})(?:[/?#]|$)/i.exec(u) : null
  return m ? m[1].toLowerCase() : ''
}

/** What Chromium says about who asked: the urls and origins of the frame that
 *  asked and of each of its ancestors (any order), and the referrer. */
export interface Asker {
  frames: readonly string[]
  referrer: string
}

/** Who asked: 'editor', a film id, 'films' (more than one film in the chain:
 *  never legitimate) or 'unknown' (nothing to tell by). */
export function askerOf(a: Asker): string {
  const ids = new Set<string>()
  for (const f of a.frames) {
    const id = filmIdIn(f)
    if (id) ids.add(id)
  }
  const ref = filmIdIn(a.referrer)
  if (ref) ids.add(ref)
  if (ids.size > 1) return 'films'
  if (ids.size === 1) return [...ids][0]
  // A frame chain with no film in it, or a referrer that is not a film's:
  // the editor (its pages are file:// or the dev server's).
  if (a.frames.some((f) => !!f && f !== 'null' && !/^about:/i.test(f)) || (a.referrer && !/^about:/i.test(a.referrer))) return 'editor'
  return 'unknown'
}

export interface FenceAnswer {
  allow: boolean
  /** The film refused (its id), for its "blocked" list; '' when not a film. */
  film: string
}

/** May this requester have this address? Only media:// and snippfilm:// are
 *  judged here; anything else is the network firewall's (network.ts). */
export function fenceAnswer(url: string, a: Asker): FenceAnswer {
  const media = /^media:/i.test(url)
  const target = filmIdIn(url)
  const film = /^snippfilm:/i.test(url)
  if (!media && !film) return { allow: true, film: '' }
  const who = askerOf(a)
  if (who === 'editor') return { allow: true, film: '' }
  if (who === 'unknown') return { allow: false, film: '' }
  if (who === 'films') return { allow: false, film: '' }
  // A film: its own folder only.
  return { allow: film && target === who, film: who }
}
