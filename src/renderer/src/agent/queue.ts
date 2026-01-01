// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Analyses run one at a time, a few waiting (SnippStudio phase 4A.8, G6;
// reworked in 4A.9, V-limits-sessions-2 / -3). Pure: no store, no clock.
//
// - A waiting entry whose call was cancelled (its session ended, another
//   project was opened, access went off) is dead: it does not count toward
//   the limit, and it is settled ("cancelled") as soon as that is seen — not
//   when the one running before it ends.
// - Emptying the queue settles every waiting entry: nothing is left that
//   never ends (an analysis handed on as a job stayed "running" for ever).
// - One session may not hold every place (phase 4A.10, D5, safety#9): at most
//   `perOwner` of the waiting entries are one owner's. The owner of an
//   analysis is the CLIENT, not the session (phase 4A.11, S1: one client
//   with two sessions filled every place), and an owner with nothing
//   waiting always gets one place, even when the others filled the queue.

export interface QueueSignal {
  cancelled: () => boolean
}

interface Entry {
  run: () => Promise<void>
  signal: QueueSignal
  reject: (e: Error) => void
  owner?: string
}

export interface WorkQueue {
  /** Queues `work`; rejects at once when `max` live entries already wait
   *  (unless none of them is `owner`'s), or `perOwner` of `owner`'s. */
  add<T>(work: () => Promise<T>, signal: QueueSignal, owner?: string): Promise<T>
  /** Settles everything that waits (not the one running) with `reason`. */
  clear(reason: string): number
  /** Entries waiting (dead ones are dropped first). */
  waiting(): number
}

export function createQueue(max: number, full: (max: number) => string, perOwner = max, mine: (n: number) => string = full): WorkQueue {
  const list: Entry[] = []
  let running = false
  const dropDead = (): void => {
    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i].signal.cancelled()) continue
      const [dead] = list.splice(i, 1)
      dead.reject(new Error('cancelled'))
    }
  }
  const pump = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      while (list.length) await list.shift()!.run()
    } finally {
      running = false
    }
  }
  return {
    add<T>(work: () => Promise<T>, signal: QueueSignal, owner?: string): Promise<T> {
      dropDead()
      const owned = owner === undefined ? 0 : list.filter((e) => e.owner === owner).length
      // (An owner nobody waits for yet is let in past `max`: owners are
      // clients, at most as many as the sessions the server keeps.)
      if (list.length >= max && (owner === undefined || owned > 0)) throw new Error(full(max))
      if (owner !== undefined && owned >= perOwner) throw new Error(mine(perOwner))
      return new Promise<T>((resolve, reject) => {
        list.push({
          signal,
          reject,
          owner,
          run: async () => {
            if (signal.cancelled()) return reject(new Error('cancelled'))
            try {
              resolve(await work())
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)))
            }
          }
        })
        void pump()
      })
    },
    clear(reason: string): number {
      const waiting = list.splice(0)
      for (const e of waiting) e.reject(new Error(reason))
      return waiting.length
    },
    waiting(): number {
      dropDead()
      return list.length
    }
  }
}

/** Analyses waiting at most (G6), and one client's at most (phase 4A.10,
 *  D5; by client since phase 4A.11, S1). */
export const ANALYSES_WAITING_MAX = 8
export const ANALYSES_WAITING_PER_CLIENT = 4
/** The window's one analysis queue (agent/host.ts). */
export const analysisQueue = createQueue(
  ANALYSES_WAITING_MAX,
  (max) => `${max} analyses are already waiting; wait for their jobs (job {"id","wait"}) before asking for more.`,
  ANALYSES_WAITING_PER_CLIENT,
  (n) => `${n} of your analyses are already waiting; wait for their jobs (job {"id","wait"}) before asking for more.`
)
/** An analysis of `session`'s, queued under its CLIENT (S1). */
export const queueAnalysis = <T>(work: () => Promise<T>, signal: QueueSignal, session: { client: string }): Promise<T> => analysisQueue.add(work, signal, session.client)
