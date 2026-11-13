// Whether a module is the script Node was started with (`node scripts/x.js`)
// or was imported, by a test or another script. For the scripts in scripts/
// that are both a command and a module.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * True when `script` (by default the path Node was given) is the module at
 * `moduleUrl` (its `import.meta.url`).
 *
 * Node gives a script its path as typed: through a symlink (a checkout
 * reached by a linked folder), or without ".js". Comparing that text with
 * the module's own address said "imported", and the command then did nothing
 * and exited 0: a launch check that passes without running (SPEC §20 M8).
 * So both are resolved to the file they name first.
 * @param {string} moduleUrl
 * @param {string} [script]
 */
export function isMain(moduleUrl, script = process.argv[1]) {
  if (!script) return false; // node -e, the REPL
  const self = realpathSync(fileURLToPath(moduleUrl));
  for (const candidate of [script, `${script}.js`]) {
    try {
      if (realpathSync(candidate) === self) return true;
    } catch {
      // No such file: try the next spelling.
    }
  }
  return false;
}
