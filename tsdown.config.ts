import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_ID = 'dsh-prompt-studio'

// The shared client-bundle preset is only published as DSH source, so it is
// loaded from the checkout named by `DSH_ROOT` (or `../dsh`) through its real
// absolute path. Importing it by path instead of through a `./.dsh` link keeps
// the build free of any temporary link into that checkout: a Windows directory
// symlink needs elevation or Developer Mode, and even a junction would be
// residue a failed build could leave behind.
const dshRoot = process.env.DSH_ROOT ?? fileURLToPath(new URL('../dsh', import.meta.url))
const { clientBundle } = await import(pathToFileURL(join(dshRoot, 'packages/client/tsdown.client.ts')).href)

// `clientBundle(id, libEntry)` returns a face-selecting function; evaluate it
// without `DSH_BUILD_FACE` and keep the client config (the trailing entry).
// The node library half is discarded — this package bundles its server half
// directly from `src/index.ts` below.
const clientConfig = clientBundle(PLUGIN_ID, [])({ env: {} }).at(-1)

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'dist',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // The server half bundles its only runtime value dependency (schemastery,
    // pulled in by config.ts) so a linked/installed plugin is self-contained;
    // every other `@deepseek-ai/*` import is type-only and erased. Type-only
    // imports never reach the bundler, so no explicit external list is needed.
  },
  {
    ...clientConfig,
    outDir: 'dist',
  },
]
