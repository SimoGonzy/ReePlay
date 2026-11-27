import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const frontend = join(root, 'frontend')
const python = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python')

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${executable} exited with status ${result.status}`)
}

const rustTriple = spawnSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' })
const triple = process.env.MUSICAPP_TARGET_TRIPLE || (rustTriple.status === 0 ? rustTriple.stdout.trim() : '')
if (!triple) throw new Error('Rust is not installed. Install Rust and the Tauri prerequisites before building the desktop package.')
if (!/^[a-zA-Z0-9_-]+$/.test(triple)) throw new Error('Invalid Rust target.')

const work = join(frontend, '.sidecar-build')
mkdirSync(work, { recursive: true })
run(python, [
  '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile',
  '--name', 'musicapp-backend',
  '--distpath', join(work, 'dist'),
  '--workpath', join(work, 'work'),
  '--specpath', work,
  '--collect-all', 'yt_dlp',
  '--collect-all', 'uvicorn',
  '--collect-all', 'fastapi',
  '--collect-all', 'zeroconf',
  '--collect-all', 'cryptography',
  '--collect-all', 'ifaddr',
  join(root, 'backend_entry.py'),
])

const suffix = process.platform === 'win32' ? '.exe' : ''
const output = join(frontend, 'src-tauri', 'binaries')
mkdirSync(output, { recursive: true })
const destination = join(output, `musicapp-backend-${triple}${suffix}`)
copyFileSync(join(work, 'dist', `musicapp-backend${suffix}`), destination)
console.log(`Sidecar ready: ${destination}`)

const licenseOutput = join(frontend, 'src-tauri', 'python-licenses')
run(python, ['-c', `import importlib.metadata, pathlib, shutil, sys
output = pathlib.Path(sys.argv[1])
for package in ('cryptography', 'zeroconf', 'ifaddr'):
    distribution = importlib.metadata.distribution(package)
    licenses = [entry for entry in distribution.files or [] if pathlib.Path(str(entry)).name.lower().startswith(('license', 'copying'))]
    if not licenses:
        raise RuntimeError(f'License not found for {package}')
    target = output / package
    target.mkdir(parents=True, exist_ok=True)
    for entry in licenses:
        shutil.copy2(distribution.locate_file(entry), target / pathlib.Path(str(entry)).name)
`, licenseOutput])
