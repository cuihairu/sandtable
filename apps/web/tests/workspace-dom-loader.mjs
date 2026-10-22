import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const { transform } = await import('esbuild')

export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.tsx')) specifier += '?tsx-hook'
  return next(specifier, context)
}

export async function load(url, context, next) {
  if (url.endsWith('?tsx-hook')) {
    const filename = url.slice(0, -'?tsx-hook'.length)
    const source = await readFile(fileURLToPath(filename), 'utf8')
    const result = await transform(source, {
      loader: 'tsx',
      jsx: 'automatic',
      sourcefile: filename,
    })
    return { format: 'module', shortCircuit: true, source: result.code }
  }
  return next(url, context)
}
