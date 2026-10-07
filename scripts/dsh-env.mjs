import { access, copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

export const pluginRoot = fileURLToPath(new URL('..', import.meta.url))

function dshRootFromEnvironment() {
  return resolve(process.env.DSH_ROOT ?? join(pluginRoot, '..', 'dsh'))
}

async function requirePath(path, description) {
  try {
    await access(path)
  } catch {
    throw new Error(`${description} was not found at ${path}`)
  }
}

async function readPackageName() {
  const manifest = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8'))
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new Error(`${join(pluginRoot, 'package.json')} does not declare a package name`)
  }
  return manifest.name
}

/**
 * The DSH client-bundle preset resolves a package's manifest by globbing
 * `packages/<group>/<package>/package.json` inside the DSH checkout, so an
 * external plugin needs a manifest-only projection there for the duration of a
 * build. Only the manifest is read; nothing is written back.
 * @param dshRoot - DSH source checkout the build consumes.
 * @param name - this plugin's package name.
 * @returns the created group directory, removed again after the build.
 */
async function ensureManifestProjection(dshRoot, name) {
  const group = join(dshRoot, 'packages', '_plugin-build')
  const target = join(group, name)
  await mkdir(target, { recursive: true })
  await copyFile(join(pluginRoot, 'package.json'), join(target, 'package.json'))
  return group
}

/** The JavaScript entry points behind the DSH checkout's `tsc` and `tsdown` bins. */
export function dshToolEntryPoints(dshRoot) {
  return {
    tsc: join(dshRoot, 'node_modules/typescript/bin/tsc'),
    tsdown: join(dshRoot, 'node_modules/tsdown/dist/run.mjs'),
  }
}

/**
 * Prepare the DSH checkout for one build. No link is created into it: the
 * client-bundle preset is imported through its real absolute path by
 * `tsdown.config.ts`, and platform types come from this package's own
 * dependencies, so the build needs no symlink or junction (and therefore no
 * elevation on Windows).
 */
export async function withDshEnvironment(task) {
  const dshRoot = dshRootFromEnvironment()
  await requirePath(join(dshRoot, 'packages/client/tsdown.client.ts'), 'DSH client bundle preset')
  const tools = dshToolEntryPoints(dshRoot)
  await requirePath(tools.tsdown, 'DSH tsdown executable')
  await requirePath(tools.tsc, 'DSH TypeScript executable')
  const projection = await ensureManifestProjection(dshRoot, await readPackageName())
  try {
    return await task({ dshRoot, pluginRoot, tools })
  } finally {
    await rm(projection, { recursive: true, force: true })
  }
}

export function run(command, args, cwd = pluginRoot) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.versions.electron === undefined
        ? process.env
        : { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${command} exited with ${code ?? `signal ${signal}`}`))
    })
  })
}
