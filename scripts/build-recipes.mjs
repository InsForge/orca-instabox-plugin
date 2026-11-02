// Inlines src/lifecycle.js into the recipe files, which can only carry a command, not a script path.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src', 'lifecycle.js'), 'utf8')

const code = source
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('//'))
  .join(' ')

// One string must survive both sh -c and cmd.exe /d /s /c inside double quotes.
const forbidden = ['"', '$', '`', '\\', '%', '\n', '\r']
for (const ch of forbidden) {
  if (code.includes(ch)) {
    throw new Error(`src/lifecycle.js must not contain ${JSON.stringify(ch)} outside full-line comments`)
  }
}
new Function(code)

const command = `node -e "${code}"`
if (command.length > 32 * 1024) {
  throw new Error(`recipe command is ${command.length} bytes; Orca accepts at most 32 KiB`)
}

const recipes = [
  {
    file: 'instabox.json',
    id: 'instabox',
    name: 'Instabox',
    description:
      'A new Instabox cloud machine for each workspace, from the default template. Needs the instabox CLI, signed in.'
  }
]

for (const { file, ...recipe } of recipes) {
  const artifact = {
    schemaVersion: 1,
    ...recipe,
    create: command,
    suspend: command,
    resume: command,
    destroy: command
  }
  writeFileSync(join(root, 'recipes', file), `${JSON.stringify(artifact, null, 2)}\n`)
}
console.log(`wrote ${recipes.length} recipes, command ${command.length} bytes`)
