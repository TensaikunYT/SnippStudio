// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.11, Bölüm B (tarifler/FAZ4A-YAMA.md S1–S2): the
// round-2 reviewers' probes J1 (one client fills the analysis queue with
// two sessions) and J2 (a client opening 33 sessions ends another
// client's) as tests with their new behaviour. Each rule's test fails when
// the rule is taken back (scripts/mutate.mjs, B-mutations).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ANALYSES_WAITING_MAX, ANALYSES_WAITING_PER_CLIENT, queueAnalysis } from '../renderer/src/agent/queue'
import { AgentHost, SESSIONS_MAX, SESSIONS_PER_CLIENT } from '../main/agent-host'

const live = { cancelled: () => false }

test('J1 one client with two sessions cannot fill the analysis queue: the limit is per client, and a client with nothing waiting always gets a place (S1)', async () => {
  assert.equal(ANALYSES_WAITING_MAX, 8)
  assert.equal(ANALYSES_WAITING_PER_CLIENT, 4)
  let release!: () => void
  const head = queueAnalysis(() => new Promise<void>((r) => (release = r)), live, { client: 'greedy' })
  const got: string[] = []
  const waiting: Promise<unknown>[] = []
  const add = (client: string): void => {
    try {
      waiting.push(queueAnalysis(async () => client, live, { client }).catch(() => undefined))
      got.push(`${client}: queued`)
    } catch (e) {
      got.push(`${client}: ${(e as Error).message.split(';')[0]}`)
    }
  }
  // Two sessions of one client ("greedy"), four calls each.
  for (let i = 0; i < 8; i++) add('greedy')
  assert.deepEqual(got, [...Array(4).fill('greedy: queued'), ...Array(4).fill('greedy: 4 of your analyses are already waiting')])
  // Others fill the rest; the queue is full …
  for (const c of ['b', 'b', 'b', 'b']) add(c)
  got.length = 0
  add('b')
  add('c')
  add('c')
  add('d')
  assert.deepEqual(got, ['b: 8 analyses are already waiting', 'c: queued', 'c: 8 analyses are already waiting', 'd: queued'])
  release()
  await head
  await Promise.all(waiting)
})

test('J2 a client opening 33 sessions does not end another client\'s session: its own oldest go (S2)', () => {
  assert.equal(SESSIONS_MAX, 32)
  assert.equal(SESSIONS_PER_CLIENT, 8)
  const host = new AgentHost({ userData: () => '.', port: 0, version: 't', name: 'snipp-test', forced: false, target: () => null } as never)
  const victim = host.open('user-agent')
  const greedy = Array.from({ length: 33 }, () => host.open('greedy'))
  assert.equal(host.has(victim), true)
  assert.deepEqual(greedy.map((id) => host.has(id)).lastIndexOf(false), 33 - SESSIONS_PER_CLIENT - 1)
  assert.equal(greedy.filter((id) => host.has(id)).length, SESSIONS_PER_CLIENT)
  // A full server (four clients of eight, and the victim): a client that
  // has sessions loses its own oldest; a new one, the oldest of all.
  const many = new AgentHost({ userData: () => '.', port: 0, version: 't', name: 'snipp-test', forced: false, target: () => null } as never)
  const first = many.open('user-agent')
  const by: Record<string, string[]> = {}
  for (const c of ['a', 'b', 'c', 'd']) by[c] = Array.from({ length: c === 'd' ? 7 : 8 }, () => many.open(c))
  // 1 + 31 = 32: full. "d" opens its eighth: one too many for the server,
  // "d"'s own oldest goes (not the victim, the oldest of all).
  const d8 = many.open('d')
  assert.equal(many.has(first), true)
  assert.equal(many.has(by.d[0]), false)
  assert.equal(many.has(d8), true)
  for (const c of ['a', 'b', 'c']) assert.ok(by[c].every((id) => many.has(id)), c)
  // A client with no session yet: the oldest of all goes.
  const e = many.open('e')
  assert.equal(many.has(e), true)
  assert.equal(many.has(first), false)
})
