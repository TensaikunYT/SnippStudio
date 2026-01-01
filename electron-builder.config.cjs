// The package configuration, the only one (SnippStudio phase 9a, decision 5:
// package.json's "build" and electron-builder.dist.json became this file).
// The name and id come from src/shared/product.json (decision 1). The app is
// built as the release copy first (scripts/package/dist.mjs sets
// SNIPP_CHANNEL=release), so the packaged app has the product's own name and
// profile folder.
//
//   npm run dist           NSIS installer (unsigned; never run by a session)
//   npm run dist:dir       the unpacked folder only (<out>/win-unpacked)
//   npm run dist:mac       dmg + zip, arm64 and x64 (on a Mac only: phase 10b.5)
//   npm run dist:linux     AppImage + deb, x64 (on Linux only)
// All: scripts/package/dist.mjs [--out=<folder>] (default release/).
// macOS and Linux are prepared, never built on the Windows PC this was written
// on (FAZ10-PLAN.md): .github/workflows/platforms.yml builds them.
const { readFileSync } = require('node:fs')
const path = require('node:path')

const product = JSON.parse(readFileSync(path.join(__dirname, 'src', 'shared', 'product.json'), 'utf8'))

/** Notarisation only when one of Apple's two sets of credentials is there in
 *  full (App Store Connect API key, or Apple ID); otherwise skipped, said in
 *  the build log (phase 10b.5). */
const notaryEnv = (env) =>
  !!(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) || !!(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID)
/** A Developer ID certificate given (CSC_LINK / CSC_NAME): electron-builder
 *  finds it. None: an ad-hoc signature ('-'), so the arm64 build runs on the
 *  Mac it was built on (an unsigned arm64 binary does not run at all); it is
 *  not a signature Gatekeeper trusts on another Mac. */
const macIdentity = (env) => (env.CSC_LINK || env.CSC_NAME ? undefined : '-')

module.exports = {
  appId: product.appId,
  productName: product.name,
  copyright: `Copyright (C) 2026 ${product.name} contributors`,
  directories: { output: 'release' },
  // The app carries no native module (TERMINAL-YOK-PLAN.md: the embedded
  // terminal and its native part went); nothing to rebuild.
  npmRebuild: false,
  // Electron's fuses (were in package.json only; the old release file had none).
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true
  },
  // The app is the bundled out/ (vite puts the renderer's libraries in it).
  // No production dependency is loaded at run time (the embedded terminal's
  // native module went: TERMINAL-YOK-PLAN.md): the renderer has them bundled, and
  // onnxruntime-node and sharp (pulled in by transformers.js, never used: the
  // app runs onnxruntime-web) would only add native files for every platform
  // (haritalar\cekirdek-platform.md M7).
  files: [
    'out/**',
    '!out/render-qa-profile/**',
    '!out/transition-qa.*',
    '!node_modules/**'
  ],
  // The licences, beside the program (Faz 9 audit patch P, P1): the app's
  // own (GPL-3.0), the notices, and licenses/ (the standard texts the notices
  // name, and every shipped package's own licence file:
  // scripts/yayin/notices.mjs). scripts/package/check.mjs checks them.
  extraFiles: [
    { from: 'LICENSE', to: 'LICENSE.txt' },
    { from: 'THIRD-PARTY-NOTICES.md', to: 'THIRD-PARTY-NOTICES.md' },
    { from: 'licenses', to: 'licenses' },
    // The guides the Settings window's Help page opens (TERMINAL-YOK-PLAN.md).
    { from: 'docs', to: 'docs' }
  ],
  extraResources: [
    // The one speech model (decision 7): the multilingual medium set, copied
    // from models/ by scripts/package/models.mjs. Nothing is downloaded.
    { from: 'models-dist', to: 'models', filter: ['**/*', '!README.md'] },
    { from: 'vendor/three', to: 'three' },
    { from: 'resources/kod-sablonlari', to: 'kod-sablonlari' }
  ],
  win: {
    icon: 'build/icon.ico',
    target: ['nsis']
  },
  // ---- macOS (phase 10b.5; report section 2a). Prepared, not built here. ----
  mac: {
    // build/icon.icns: scripts/package/icons-posix.mjs (from the 256 px icon,
    // enlarged: a 1024 px master is the user's to draw).
    icon: 'build/icon.icns',
    category: 'public.app-category.video',
    // Two downloads, one per chip (the 1 GB model is not doubled).
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ],
    hardenedRuntime: true,
    // The app and its helpers: V8's and WebAssembly's JIT (the speech model
    // runs in WASM), and library validation off (an ad-hoc signed app needs
    // it for Electron's own frameworks; electron-builder warns otherwise).
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    identity: macIdentity(process.env),
    notarize: notaryEnv(process.env),
    darkModeSupport: true
  },
  dmg: {
    artifactName: '${productName}-${version}-${arch}.${ext}'
  },
  // ---- Linux (phase 10b.5; report section 2b). Prepared, not built here. ----
  linux: {
    icon: 'build/icon-1024.png',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] }
    ],
    executableName: 'snippstudio',
    category: 'AudioVideo',
    synopsis: 'A local video editor that works with the AI agent you already use',
    description: 'Timeline, on-device subtitles, code clips and export up to 4K, with an agent server for the AI agent you already use.',
    maintainer: `${product.name} contributors <snipp@users.noreply.github.com>`,
    vendor: `${product.name} contributors`,
    desktop: {
      entry: {
        Name: product.name,
        StartupWMClass: product.name,
        Keywords: 'video;editor;subtitles;'
      }
    }
  },
  // The deb's install script loads electron-builder's own AppArmor profile
  // (unconfined + userns: Ubuntu 24.04 refuses Chromium's sandbox without
  // it). An AppImage cannot carry one: its path changes each run; the release
  // notes say what to do (YAYIN.md).
  deb: {
    artifactName: '${productName}-${version}-${arch}.${ext}'
  },
  appImage: {
    artifactName: '${productName}-${version}-${arch}.${ext}'
  },
  // Decision 2: the project file stays .snipp.
  fileAssociations: [
    {
      ext: product.projectExt,
      name: `${product.name} Project`,
      description: `${product.name} project`,
      // (.ico on Windows; macOS reads build/snipp-file.icns by the same name.)
      icon: 'build/snipp-file.ico',
      role: 'Editor',
      // Linux only: the .desktop file's MimeType and the shared-mime-info
      // glob electron-builder writes for the deb (Windows and macOS ignore it).
      mimeType: 'application/x-snippstudio-project'
    }
  ],
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: product.name,
    runAfterFinish: true
  }
}
