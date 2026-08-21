#!/usr/bin/env node
/**
 * 把 dist/ 打包成一个自带静态服务器的单文件 exe（Node SEA）。
 *
 * 流程：vite build（放宽分辨率守卫）→ 把 dist 压成单个 bundle.bin
 *      → 生成 SEA blob → 复制 node 可执行文件 → postject 注入
 *
 * 用法：npm run package:desktop
 * 产物：release/节奏星球.exe
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build-desktop');
const releaseDir = path.join(root, 'release');
const distDir = path.join(root, 'dist');
const isWin = process.platform === 'win32';
const exeName = isWin ? '节奏星球.exe' : '节奏星球';

const step = (msg) => console.log(`\n▸ ${msg}`);
const mb = (n) => (n / 1048576).toFixed(2) + 'MB';

/** 递归收集 dist 下的全部文件，返回 [相对路径, 绝对路径] 列表。 */
function collect(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...collect(abs, rel));
    else out.push([rel, abs]);
  }
  return out;
}

/**
 * 资源包格式：[8 字节小端 index 长度][index JSON][各文件内容顺序拼接]
 * 只用一个 SEA asset，避免为几百个文件各写一条配置。
 */
function packDist() {
  const entries = collect(distDir);
  if (entries.length === 0) throw new Error('dist/ 是空的');
  const index = {};
  const chunks = [];
  let offset = 0;
  for (const [rel, abs] of entries) {
    const buf = fs.readFileSync(abs);
    index[rel] = { o: offset, l: buf.length };
    chunks.push(buf);
    offset += buf.length;
  }
  const indexJson = Buffer.from(JSON.stringify(index), 'utf8');
  const header = Buffer.alloc(8);
  header.writeBigUInt64LE(BigInt(indexJson.length));
  return { bundle: Buffer.concat([header, indexJson, ...chunks]), count: entries.length };
}

// 1. 构建网页产物（关掉分辨率守卫）
step('构建前端产物');
// 直接调 tsc / vite，不经过 npm.cmd：Node 24 禁止无 shell 地 spawn .cmd（EINVAL）。
// 上游已彻底移除分辨率守卫（main.ts 现在只 console.warn），无需再传构建期开关。
const buildEnv = { ...process.env };
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], {
  cwd: root, stdio: 'inherit', env: buildEnv
});
execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: root, stdio: 'inherit', env: buildEnv
});

// 2. 打包 dist
step('打包 dist 资源');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });
const { bundle, count } = packDist();
const bundlePath = path.join(buildDir, 'bundle.bin');
fs.writeFileSync(bundlePath, bundle);
console.log(`  ${count} 个文件 → bundle.bin ${mb(bundle.length)}`);

// 3. 生成 SEA blob
step('生成 SEA blob');
const seaConfig = {
  main: path.join(root, 'scripts/desktop/server.cjs'),
  output: path.join(buildDir, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets: { bundle: bundlePath }
};
const seaConfigPath = path.join(buildDir, 'sea-config.json');
fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], { cwd: root, stdio: 'inherit' });

// 4. 复制 node 可执行文件
step('复制 Node 运行时');
fs.mkdirSync(releaseDir, { recursive: true });
const exePath = path.join(releaseDir, exeName);
fs.copyFileSync(process.execPath, exePath);
console.log(`  ${path.basename(process.execPath)} → ${exeName} (${mb(fs.statSync(exePath).size)})`);

// Windows 上已签名的 node.exe 注入后签名会失效，先尽量移除签名；没有 signtool 也能继续。
if (isWin) {
  try {
    execFileSync('signtool', ['remove', '/s', exePath], { stdio: 'ignore' });
    console.log('  已移除原签名');
  } catch {
    console.log('  跳过移除签名（无 signtool，通常不影响运行）');
  }
}

// 5. 注入 blob
step('注入 SEA blob');
const postject = path.join(root, 'node_modules/postject/dist/cli.js');
if (!fs.existsSync(postject)) throw new Error('缺少 postject，请先执行 npm install');
execFileSync(process.execPath, [
  postject, exePath, 'NODE_SEA_BLOB', seaConfig.output,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])
], { cwd: root, stdio: 'inherit' });

fs.rmSync(buildDir, { recursive: true, force: true });

const finalSize = fs.statSync(exePath).size;
console.log(`\n✅ 完成：${path.relative(root, exePath)}  ${mb(finalSize)}`);
console.log('   双击即可运行；它会启动本地服务器并打开默认浏览器。');
