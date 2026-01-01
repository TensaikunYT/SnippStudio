// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The branch to publish (SnippStudio phase 9c, decision 5). The working
// history is not published (it holds the personal files phase 1b took out);
// this makes a branch of ONE commit from a cleaned copy of a tree, without
// switching branches and without touching the working tree or the index:
//   - a temporary index is filled from <rev> (default HEAD);
//   - what does not go public is removed from it (internal notes, files made
//     from the user's own material: PUBLIC_EXCLUDE below);
//   - its tree becomes one parentless commit by AUTHOR below
//     ("SnippStudio contributors <noreply@snippstudio.invalid>");
//   - the branch (default refs/heads/public) is set to it, every run anew.
// The same tree gives the same commit (fixed dates), so a run with nothing
// changed changes nothing.
//
//   node scripts/yayin/dal.mjs [--rev=<commit>] [--branch=<name>] [--dry]
// Then: git clone --single-branch --branch public <repo> <folder>, and the scan
// (tara.mjs --tree=<folder>) there. Pushing is the user's (YAYIN.md).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('../..', import.meta.url))

/** Paths (git, forward slashes) that never go public. */
export const PUBLIC_EXCLUDE = [
  /^CLAUDE\.md$/,
  /(^|\/)CLAUDE\.md$/,
  /^CODE-FILM-CLIP-PLAN\.md$/,
  /-REVIEW\.md$/,
  /^UI-DESIGN\.md$/,
  /^\.claude\//,
  // Measurements made on the user's own talks and films (testdata, phase 4A):
  /^src\/test\/fixtures\/.*whisper.*\.json$/i,
  /^scripts\/split\/plans\//,
  // The recipe that copies the user's own films and voice-overs into
  // testdata (phase 2B): its lines are the list of those films, and nobody
  // else can run it. The tests that need testdata skip without it.
  /^scripts\/testdata\/make\.mjs$/
]
/** Kept although an exclude rule would take them (none today). */
export const PUBLIC_KEEP = [/^SECURITY-REVIEW\.md$/]

/** The public commit's author (Faz 9 audit patch P, P4): the copyright line's
 *  "<product> contributors", at an address under .invalid, a top-level domain
 *  that can never be registered (RFC 2606, RFC 6761), so the commit can never
 *  be linked to anybody's account. (The old "snipp@users.noreply.github.com"
 *  was GitHub's form for the existing user "snipp".) It follows the product
 *  name (src/shared/product.json). */
const PRODUCT = JSON.parse(readFileSync(join(APP, 'src', 'shared', 'product.json'), 'utf8')).name
export const AUTHOR = { name: `${PRODUCT} contributors`, email: `noreply@${PRODUCT.toLowerCase().replace(/[^a-z0-9-]/g, '')}.invalid` }
const DATE = '2026-01-01T00:00:00Z'

export const goesPublic = (p) => PUBLIC_KEEP.some((r) => r.test(p)) || !PUBLIC_EXCLUDE.some((r) => r.test(p))

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const i = a.indexOf('='); return [a.slice(2, i < 0 ? undefined : i), i < 0 ? true : a.slice(i + 1)] }))
  const repo = typeof args.repo === 'string' ? resolve(args.repo) : APP
  const rev = typeof args.rev === 'string' ? args.rev : 'HEAD'
  const branch = typeof args.branch === 'string' ? args.branch : 'public'
  const tmp = mkdtempSync(join(tmpdir(), 'snipp-public-'))
  const env = {
    ...process.env,
    GIT_INDEX_FILE: join(tmp, 'index'),
    GIT_AUTHOR_NAME: AUTHOR.name, GIT_AUTHOR_EMAIL: AUTHOR.email, GIT_AUTHOR_DATE: DATE,
    GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email, GIT_COMMITTER_DATE: DATE
  }
  const git = (a, input) => execFileSync('git', ['-C', repo, ...a], { env, input, maxBuffer: 1 << 30 }).toString().trim()
  try {
    git(['read-tree', rev])
    const all = git(['ls-files', '-z']).split('\0').filter(Boolean)
    const out = all.filter((p) => !goesPublic(p))
    if (out.length) git(['update-index', '--force-remove', '-z', '--stdin'], out.join('\0') + '\0')
    const tree = git(['write-tree'])
    const source = git(['rev-parse', '--short', rev])
    const commit = git(['commit-tree', tree, '-m', `SnippStudio source\n\nOne commit made from a cleaned tree (scripts/yayin/dal.mjs); the working history is not published.`])
    console.log(`${all.length} files in ${rev} (${source}); ${out.length} left out; tree ${tree.slice(0, 10)}; commit ${commit.slice(0, 10)}`)
    for (const p of out.slice(0, 30)) console.log(`  out: ${p}`)
    if (args.dry) return
    git(['update-ref', `refs/heads/${branch}`, commit])
    console.log(`refs/heads/${branch} -> ${commit.slice(0, 10)} (no branch switched, working tree untouched)`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main()
