'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { inject } = require('postject');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} exited with ${result.status}`);
}
async function build() {
  if (process.platform === 'win32' && process.arch === 'arm64') {
    const x64 = path.join(root, '.tools', 'node-x64.exe');
    if (!fs.existsSync(x64)) throw new Error('On ARM64, put the official Node 24 Windows x64 runtime and its LICENSE in .tools, then build again.');
    run(x64, [__filename]);
    return;
  }
  if (process.platform !== 'win32' || process.arch !== 'x64' || !process.version.startsWith('v24.')) {
    throw new Error('Build with Node 24 x64 on Windows. End users do not need Node installed.');
  }
  fs.mkdirSync(dist, { recursive: true });
  const license = path.join(path.dirname(process.execPath), 'LICENSE');
  if (!fs.existsSync(license)) throw new Error('Node runtime LICENSE file missing beside node.exe. Obtain the matching official runtime distribution.');
  fs.copyFileSync(license, path.join(dist, 'NODE-LICENSE.txt'));
  const metadata = fs.readFileSync(path.join(root, 'metadata.cjs'), 'utf8');
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'app.cjs'), 'utf8');
  for (const needle of ["require('./metadata.cjs')", "require('./package.json').version"]) {
    if (!source.includes(needle)) throw new Error(`Bundler expected ${needle} in app.cjs.`);
  }
  // Function replacers keep `$` sequences in bundled sources literal.
  const app = source.replace("require('./metadata.cjs')", () => `(() => { const module = { exports: {} };\n${metadata}\nreturn module.exports; })()`)
    .replace("require('./package.json').version", () => JSON.stringify(version));
  const bundle = path.join(dist, 'bundle.cjs');
  fs.writeFileSync(bundle, app);
  const assets = {};
  for (const name of ['index.html', 'app.js', 'style.css', 'logo.svg', 'songlabslogo.png']) {
    assets[name] = path.join(root, 'public', name);
  }
  const config = path.join(dist, 'sea-config.json');
  const blob = path.join(dist, 'sea-prep.blob');
  fs.writeFileSync(config, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true,
    useSnapshot: false, useCodeCache: false, execArgvExtension: 'none', assets }));
  run(process.execPath, ['--experimental-sea-config', config]);
  const executable = path.join(dist, 'MoviesOfInterest.exe');
  fs.copyFileSync(process.execPath, executable);
  // Remove the copied runtime's Authenticode directory; the modified app is unsigned.
  const pe = fs.readFileSync(executable);
  const header = pe.readUInt32LE(0x3c);
  const optional = header + 24;
  const directories = optional + (pe.readUInt16LE(optional) === 0x20b ? 112 : 96);
  pe.writeUInt32LE(0, directories + 8 * 4);
  pe.writeUInt32LE(0, directories + 8 * 4 + 4);
  fs.writeFileSync(executable, pe);
  await inject(executable, 'NODE_SEA_BLOB', fs.readFileSync(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'icon.ps1')]);
  const candidates = [process.env.ISCC_PATH, path.join(root, '.tools', 'InnoSetup', 'ISCC.exe'),
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe', 'C:\\Program Files\\Inno Setup 7\\ISCC.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe')];
  const compiler = candidates.find(value => value && fs.existsSync(value));
  if (!compiler) throw new Error('Executable built. Install Inno Setup or set ISCC_PATH to compile the setup wizard.');
  for (const name of fs.readdirSync(dist)) if (/^MoviesOfInterest-Setup-.*\.exe$/.test(name)) fs.unlinkSync(path.join(dist, name));
  run(compiler, [`/DAppVersion=${version}`, path.join(root, 'installer', 'MoviesOfInterest.iss')]);
  const setup = path.join(dist, `MoviesOfInterest-Setup-${version}.exe`);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(setup)).digest('hex');
  fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), `${hash}  ${path.basename(setup)}\n`);
  console.log('Built installer and SHA256SUMS.txt in dist.');
}
build().catch(error => { console.error(error.message); process.exitCode = 1; });
