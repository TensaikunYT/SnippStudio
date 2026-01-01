/// <reference types="vite/client" />

declare module '*.ttf' {
  const url: string
  export default url
}

declare module '*.woff2' {
  const url: string
  export default url
}

/** Injected at build time (electron.vite.config.ts). */
declare const __BUILD_STAMP__: string
/** The build's date and time (ISO), injected at build time. */
declare const __BUILD_DATE__: string
// The build's channel and branch are injected too (channel.ts and
// main/channel.ts declare them where they are read: they are absent under the
// unit tests).
