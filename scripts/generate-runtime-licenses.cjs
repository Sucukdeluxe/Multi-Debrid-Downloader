const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const visited = new Map();

function packageDirectory(name, parent) {
  const resolver = createRequire(path.join(parent, 'package.json'));
  let resolved;
  try { resolved = resolver.resolve(`${name}/package.json`); }
  catch { resolved = resolver.resolve(name); }
  let directory = path.dirname(resolved);
  for (;;) {
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).name === name) return directory;
    const next = path.dirname(directory);
    if (next === directory) throw new Error(`Package metadata missing: ${name}`);
    directory = next;
  }
}
function collect(name, parent) {
  const directory = packageDirectory(name, parent);
  if (visited.has(directory)) return;
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const files = fs.readdirSync(directory).filter(file => /^(license|licence|copying|notice)(?:\.|$)/i.test(file) && fs.statSync(path.join(directory, file)).isFile());
  if (!files.length) throw new Error(`Runtime dependency has no license text: ${name}`);
  visited.set(directory, { metadata, text: files.sort().map(file => fs.readFileSync(path.join(directory, file), 'utf8').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '')).join('\n\n') });
  for (const dependency of Object.keys(metadata.dependencies || {})) collect(dependency, directory);
}
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const name of Object.keys(metadata.dependencies || {})) collect(name, root);
const content = [...visited.values()].sort((a, b) => `${a.metadata.name}@${a.metadata.version}` < `${b.metadata.name}@${b.metadata.version}` ? -1 : 1).map(({ metadata, text }) => `${metadata.name}@${metadata.version}\nLicense: ${metadata.license || 'See text below'}\n\n${text}`).join('\n\n' + '='.repeat(72) + '\n\n');
const destination = path.join(root, 'resources', 'licenses', 'RUNTIME_LICENSES.txt');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, content.trimEnd() + '\n');
console.log(`Runtime license notices generated for ${visited.size} dependency packages.`);
