import { defineConfig } from 'electron-vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
// The product's name (phase 9a, decision 1: one place, src/shared/product.json).
const product = JSON.parse(readFileSync(new URL('./src/shared/product.json', import.meta.url), 'utf8'))

// Which copy this build is (src/main/channel.ts). On this work-in-progress
// branch every build is "<name> Dev" (its own name and profile) unless
// SNIPP_CHANNEL=release is set (the packaged product: scripts/package/dist.mjs).
const channel = process.env.SNIPP_CHANNEL === 'release' ? 'release' : 'dev'

/** The branch being built, for a dev copy's title ('' when git cannot say). */
function gitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

// Note: no @vitejs/plugin-react on purpose. esbuild compiles JSX natively,
// and skipping the react-refresh preamble (an inline script) lets us keep a
// strict CSP with no 'unsafe-inline' for scripts, in dev and production alike.
export default defineConfig(() => {
  const identity = {
    __SNIPP_CHANNEL__: JSON.stringify(channel),
    __SNIPP_BRANCH__: JSON.stringify(channel === 'dev' ? gitBranch() : '')
  }
  return {
    main: {
      define: identity,
      build: {
        rollupOptions: {
          input: 'src/main/index.ts'
        }
      }
    },
    preload: {
      build: {
        rollupOptions: {
          input: 'src/preload/index.ts',
          // Sandboxed renderers only support CommonJS preload scripts.
          output: {
            format: 'cjs',
            entryFileNames: '[name].js'
          }
        }
      }
    },
    renderer: {
      plugins: [{
        name: 'release-offline-csp',
        apply: 'build',
        transformIndexHtml: (html) => html.replace(' ws://localhost:* http://localhost:*', '')
      }, {
        // The page's first title, before main.tsx sets it (shared/product.json).
        name: 'product-name',
        transformIndexHtml: (html) => html.replace('%PRODUCT_NAME%', channel === 'dev' ? `${product.name} Dev` : product.name)
      }],
      define: {
        ...identity,
        __BUILD_STAMP__: JSON.stringify('v' + pkg.version),
        // When this build was made (the Projects page shows it beside the version).
        __BUILD_DATE__: JSON.stringify(new Date().toISOString())
      },
      worker: {
        format: 'es'
      },
      build: {
        // transformers.js + mediabunny are large; silence the default warning
        chunkSizeWarningLimit: 6000
      }
    }
  }
})
