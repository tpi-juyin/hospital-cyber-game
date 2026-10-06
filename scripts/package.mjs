import { mkdir, readFile, writeFile, cp, chmod, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const GAME_VERSION = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const NODE_VERSION = '24.21.0';
const CLOUDFLARED_VERSION = '2026.9.1';
const cache = join(root, '.downloads'); const release = join(root, 'release');
await mkdir(cache, { recursive: true }); await mkdir(release, { recursive: true });
const hash = b => createHash('sha256').update(b).digest('hex');
async function request(url) { const r = await fetch(url, { headers: { 'User-Agent': 'hospital-cyber-game-packager', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(180000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r; }
async function download(url, destination, expected) {
  if (existsSync(destination)) { const b = await readFile(destination); if (!expected || hash(b) === expected) return hash(b); }
  console.log(`下載 ${new URL(url).pathname.split('/').at(-1)}`);
  const bytes = Buffer.from(await (await request(url)).arrayBuffer()); const digest = hash(bytes);
  if (expected && digest !== expected) throw new Error(`SHA-256 不符：${destination}`);
  await writeFile(destination, bytes); return digest;
}
const nodeBase = `https://nodejs.org/dist/v${NODE_VERSION}`;
const sumsPath = join(cache, `node-${NODE_VERSION}-SHASUMS256.txt`);
await download(`${nodeBase}/SHASUMS256.txt`, sumsPath);
const sums = new Map((await readFile(sumsPath, 'utf8')).trim().split('\n').map(l => { const [digest, name] = l.trim().split(/\s+/); return [name, digest]; }));
const metadataPath = join(cache, `cloudflared-${CLOUDFLARED_VERSION}.json`);
if (!existsSync(metadataPath)) await writeFile(metadataPath, JSON.stringify(await (await request(`https://api.github.com/repos/cloudflare/cloudflared/releases/tags/${CLOUDFLARED_VERSION}`)).json(), null, 2));
const cloudRelease = JSON.parse(await readFile(metadataPath, 'utf8'));
const cloudLicense = join(cache, `cloudflared-${CLOUDFLARED_VERSION}-LICENSE`);
await download(`https://raw.githubusercontent.com/cloudflare/cloudflared/${CLOUDFLARED_VERSION}/LICENSE`, cloudLicense);
const targets = [
  { name: 'windows-x64', node: `node-v${NODE_VERSION}-win-x64.zip`, cloud: 'cloudflared-windows-amd64.exe', windows: true },
  { name: 'macos-arm64', node: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, cloud: 'cloudflared-darwin-arm64.tgz', windows: false },
  { name: 'macos-x64', node: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, cloud: 'cloudflared-darwin-amd64.tgz', windows: false },
];
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
let licenses = '# 第三方套件與授權\n\n此清單含隨應用程式分發的正式依賴及其授權文字。Node.js 與 cloudflared 的完整授權另見 licenses/。\n';
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path || meta.dev) continue;
  const pkg = JSON.parse(await readFile(join(root, path, 'package.json'), 'utf8'));
  licenses += `\n## ${pkg.name} ${meta.version}\n\nLicense: ${typeof pkg.license === 'string' ? pkg.license : '見下方授權文字或套件來源'}\n\n`;
  const entries = await readdir(join(root, path));
  for (const file of entries.filter(n => /^(licen[cs]e|copying|notice)/i.test(n))) {
    if (!(await stat(join(root, path, file))).isFile()) continue;
    licenses += '```text\n' + await readFile(join(root, path, file), 'utf8') + '\n```\n';
  }
}
await writeFile(join(root, 'THIRD_PARTY_LICENSES.md'), licenses);
const archives = [];
for (const target of targets) {
  const expected = sums.get(target.node); if (!expected) throw new Error(`找不到 Node checksum：${target.node}`);
  const nodeArchive = join(cache, target.node); const nodeHash = await download(`${nodeBase}/${target.node}`, nodeArchive, expected);
  const cloudAsset = cloudRelease.assets.find(a => a.name === target.cloud); if (!cloudAsset) throw new Error(`找不到 cloudflared 資產：${target.cloud}`);
  if (!/^sha256:[a-f0-9]{64}$/.test(cloudAsset.digest || '')) throw new Error(`cloudflared 官方缺少 SHA-256：${target.cloud}`);
  const cloudArchive = join(cache, `${CLOUDFLARED_VERSION}-${target.cloud}`);
  const cloudHash = await download(cloudAsset.browser_download_url, cloudArchive, cloudAsset.digest.slice(7));
  const work = join(cache, `extract-${target.name}`); await mkdir(work, { recursive: true });
  if (target.windows) execFileSync('unzip', ['-qo', nodeArchive, '-d', work]);
  else execFileSync('tar', ['-xzf', nodeArchive, '-C', work]);
  const nodeFolder = join(work, target.node.replace(/\.zip$|\.tar\.gz$/g, ''));
  const name = `hospital-cyber-game-${target.name}`; const out = join(release, name);
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'runtime'), { recursive: true }); await mkdir(join(out, 'licenses'), { recursive: true }); await mkdir(join(out, 'scripts'), { recursive: true });
  for (const folder of ['dist', 'dist-server', 'docs']) await cp(join(root, folder), join(out, folder), { recursive: true });
  for (const file of ['README.md', 'THIRD_PARTY_LICENSES.md']) await cp(join(root, file), join(out, file));
  await cp(join(root, 'scripts/launch.mjs'), join(out, 'scripts/launch.mjs'));
  await cp(join(root, 'scripts/tunnel-controller.mjs'), join(out, 'scripts/tunnel-controller.mjs'));
  await cp(join(root, 'scripts/open-host.mjs'), join(out, 'scripts/open-host.mjs'));
  const launch = target.windows ? 'start-game.cmd' : 'start-game.command';
  let launcher = await readFile(join(root, launch), 'utf8'); if (target.windows) launcher = launcher.replace(/\r?\n/g, '\r\n');
  await writeFile(join(out, launch), launcher); if (!target.windows) await chmod(join(out, launch), 0o755);
  await cp(join(nodeFolder, target.windows ? 'node.exe' : 'bin/node'), join(out, 'runtime', target.windows ? 'node.exe' : 'node'));
  await cp(join(nodeFolder, 'LICENSE'), join(out, 'licenses/Node.js-LICENSE.txt'));
  if (target.windows) await cp(cloudArchive, join(out, 'runtime/cloudflared.exe'));
  else { const cloudWork = join(work, 'cloud'); await mkdir(cloudWork, { recursive: true }); execFileSync('tar', ['-xzf', cloudArchive, '-C', cloudWork]); await cp(join(cloudWork, 'cloudflared'), join(out, 'runtime/cloudflared')); await chmod(join(out, 'runtime/node'), 0o755); await chmod(join(out, 'runtime/cloudflared'), 0o755); }
  await cp(cloudLicense, join(out, 'licenses/cloudflared-LICENSE.txt'));
  await writeFile(join(out, 'VERSION.json'), JSON.stringify({ game: GAME_VERSION, platform: target.name, node: NODE_VERSION, cloudflared: CLOUDFLARED_VERSION, archiveChecksums: { node: nodeHash, cloudflared: cloudHash }, nativeExecution: target.name === 'macos-arm64' ? 'See docs/TEST_RESULTS.md; packaging is not proof of execution.' : '尚未在對應原生系統驗證；請先預演。', builtAt: new Date().toISOString() }, null, 2) + '\n');
  const archive = join(release, `${name}.zip`);
  await rm(archive, { force: true });
  // Python's zipfile marks non-ASCII filenames as UTF-8; macOS /usr/bin/zip does not.
  // Whitelist release files so no local smoke-test logs or credentials enter the ZIP.
  execFileSync('python3', ['-c', `
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys
root, archive, launcher = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
entries = ['runtime','dist','dist-server','docs','scripts','licenses',launcher,'README.md','THIRD_PARTY_LICENSES.md','VERSION.json']
with ZipFile(archive, 'w', ZIP_DEFLATED, compresslevel=6) as z:
    for entry in entries:
        item = root / entry
        files = sorted(item.rglob('*')) if item.is_dir() else [item]
        for file in files:
            if file.is_file():
                z.write(file, file.relative_to(root.parent).as_posix())
`, out, archive, launch], { cwd: release });
  const bytes = await readFile(archive); const digest = hash(bytes); archives.push(`${digest}  ${name}.zip`); console.log(`完成 ${target.name}：${(bytes.length / 1048576).toFixed(1)} MB`);
}
await writeFile(join(release, 'SHA256SUMS.txt'), archives.join('\n') + '\n');
execFileSync('python3', [join(root, 'scripts/verify-packages.py')], { stdio: 'inherit' });
console.log('三種主持包已輸出至 release/。原生跨平台執行驗證狀態請見測試報告。');
