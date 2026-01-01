// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The files of a release, made in the same run as the package (Faz 9 audit
// patch P, P5): the binaries a release offers must come from the source it
// publishes (GPL-3.0 §6, "Corresponding Source"), so they are made from one
// tree in one go, never zipped by hand later.
//   <name>-<version>-<platform>.zip   the unpacked program, in a folder named
//                                     <name>-<version>
//   SHA256SUMS.txt                    sha256sum's format (sha256sum -c works)
//   SOURCE.txt                        the commit the package was built from,
//                                     and whether the tree had changes
// dist.mjs --release calls writeReleaseFiles after its checks; built in the
// clean clone of the public branch (YAYIN.md), the commit is the published one.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readdirSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** SHA-256 of a file, in hex (read in pieces: the zip is ≈ 0.8 GB). */
export function sha256(file) {
  const h = createHash('sha256')
  const f = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(1 << 22)
    for (let n; (n = readSync(f, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n))
  } finally {
    closeSync(f)
  }
  return h.digest('hex')
}

/** SHA256SUMS.txt's text: "<hex>  <name>" per file, as sha256sum writes it. */
export const sumsText = (rows) => rows.map((r) => `${r.hash}  ${r.name}\n`).join('')

/** The commit a tree is at, and whether it has changes git sees. */
export function sourceOf(dir) {
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim()
  return { commit: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), dirty: git('status', '--porcelain').length > 0 }
}

/** Zips <parent>/<folder> as <zip>, its entries under <top>/ (the folder is
 *  renamed to <top> for the zip and back after). Windows: its own tar.exe
 *  (bsdtar; -a picks the zip format from the name); elsewhere: zip. */
export function zipFolder(parent, folder, top, zip) {
  if (existsSync(zip)) rmSync(zip)
  const renamed = folder !== top
  if (renamed) renameSync(join(parent, folder), join(parent, top))
  try {
    const r = process.platform === 'win32'
      ? spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, top], { cwd: parent, encoding: 'utf8' })
      : spawnSync('zip', ['-r', '-q', '-y', zip, top], { cwd: parent, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`zip failed: ${(r.stderr || r.error || '').toString().trim()}`)
  } finally {
    if (renamed) renameSync(join(parent, top), join(parent, folder))
  }
}

const PLATFORM_TAG = { win32: 'win', darwin: 'mac', linux: 'linux' }

/** The release files beside an electron-builder output folder. `unpacked` is
 *  the folder's name inside `out` (win-unpacked…). Returns what it wrote. */
export function writeReleaseFiles(out, { name, version, unpacked, source, platform = process.platform, arch = process.arch, date = new Date() }) {
  const top = `${name}-${version}`
  const zip = `${top}-${PLATFORM_TAG[platform] ?? platform}-${arch}.zip`
  zipFolder(out, unpacked, top, join(out, zip))
  const installers = readdirSync(out).filter((n) => /\.(exe|dmg|AppImage|deb)$/i.test(n) && n.includes(version)).sort()
  const rows = [...installers, zip].map((n) => ({ name: n, hash: sha256(join(out, n)) }))
  writeFileSync(join(out, 'SHA256SUMS.txt'), sumsText(rows))
  writeFileSync(join(out, 'SOURCE.txt'), [
    `${name} ${version}`,
    `Built from commit ${source.commit} (${source.branch})${source.dirty ? ', WITH UNCOMMITTED CHANGES: not a release' : ''}.`,
    `Built ${date.toISOString().slice(0, 10)} by scripts/package/dist.mjs --release.`,
    'The source of exactly this build is that commit. Write it into the release notes.',
    ''
  ].join('\n'))
  return { zip, installers, sums: rows, source: 'SOURCE.txt' }
}
