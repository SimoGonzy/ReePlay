import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform === 'linux') {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'prepare-linux-tools.sh')
  const result = spawnSync('sh', [script], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
