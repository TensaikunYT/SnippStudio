// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { atlasArrivals, atlasCamera, createTemplate, setAtlasKey } from '../renderer/src/templates/model'
import { defaultProject } from '../renderer/src/types'

test('your-camera map: keys glide, places pin as the camera reaches them', () => {
  const p = defaultProject()
  const id = createTemplate(p, 'atlas', 0)
  const b = p.templates!.find((t) => t.id === id)!
  // A new one opens on the world and flies to its first place.
  assert.equal(b.cams!.length, 2)
  assert.equal(b.cams![0].z, 1)
  b.items = [{ id: 'a', title: 'Istanbul' }, { id: 'b', title: 'Spain' }, { id: 'c', title: 'Japan' }]
  b.cams = [{ t: 0, lon: 12, lat: 10, z: 1 }, { t: 3, lon: 29, lat: 41, z: 11 }, { t: 7, lon: -4, lat: 40, z: 4.5 }]
  // On a key exactly; half way, between (and pulled back a little).
  const on = atlasCamera(b, 3)
  assert.ok(Math.abs(on.lon - 29) < 1e-9 && Math.abs(on.lat - 41) < 1e-9 && Math.abs(on.z - 11) < 1e-9)
  const mid = atlasCamera(b, 5)
  assert.ok(mid.lon < 29 && mid.lon > -4 && mid.z < 11)
  const at = atlasArrivals(b)
  assert.ok(at[0] > 1 && at[0] <= 3)
  assert.ok(at[1] > 5 && at[1] <= 7)
  assert.equal(at[2], Infinity)
  // A key set on the frame of another replaces it (phase Ç2c.2, decision 1:
  // the frame of the project, 30 fps here).
  setAtlasKey(b, 3.01, { lon: 30, lat: 41, z: 12 }, 30)
  assert.equal(b.cams.length, 3)
  assert.equal(b.cams[1].lon, 30)
})
