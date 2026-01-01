// The tests compile some renderer modules that import font files (Vite turns
// them into URLs in the app). Their type here; the tests never load them.
declare module '*.ttf' {
  const url: string
  export default url
}
