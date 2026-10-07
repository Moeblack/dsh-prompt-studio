import { copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pluginRoot, run, withDshEnvironment } from './dsh-env.mjs'

await withDshEnvironment(async ({ tools }) => {
  const dist = join(pluginRoot, 'dist')
  await rm(dist, { recursive: true, force: true })
  // Emits `lib/types` declarations and type-checks the platform API surface.
  await run(process.execPath, [tools.tsc, '-p', 'tsconfig.json'])
  await run(process.execPath, [tools.tsdown, '--config', 'tsdown.config.ts'])
  await copyFile(join(dist, 'index.js'), join(pluginRoot, 'index.mjs'))
  await copyFile(join(dist, 'client.js'), join(pluginRoot, 'client.js'))
  await copyFile(join(dist, 'client.js.map'), join(pluginRoot, 'client.js.map'))
  await rm(dist, { recursive: true, force: true })
})
