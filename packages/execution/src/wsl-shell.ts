import { createHash } from 'node:crypto'
import path from 'node:path'

/** Positional arguments keep workspace paths and names out of shell source. */
export function wslShellArguments(root: string, distribution: string): string[] {
  const directoryKey = createHash('sha256').update(path.win32.resolve(root)).digest('hex')
  const script = [
    'target=$(wslpath -u "$1") || exit',
    'cd "$target" || exit',
    'export TMPDIR="$HOME/.local/state/eden-agent/command-tmp/$2"',
    '(umask 077; mkdir -p -- "$TMPDIR") || exit',
    'if command -v bash >/dev/null 2>&1; then exec bash --noprofile --norc -o pipefail -s; fi',
    // Older minimal distributions may lack bash and sh pipefail. Keep the shell usable.
    'exec /bin/sh -c \'if (set -o pipefail) 2>/dev/null; then set -o pipefail; fi; . /dev/stdin\'',
  ].join('\n')
  return ['--distribution', distribution, '--exec', '/bin/sh', '-c', script, 'eden-agent', root, directoryKey]
}
