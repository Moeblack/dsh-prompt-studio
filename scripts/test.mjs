import { join } from 'node:path'
import { pluginRoot, run } from './dsh-env.mjs'

await run(process.execPath, [join(pluginRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts'])
