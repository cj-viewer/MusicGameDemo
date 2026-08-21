'use strict';
/**
 * 单文件 exe 的入口：把打包进来的 dist 内容用内存静态服务器提供，
 * 再打开系统默认浏览器。不落地任何临时文件。
 *
 * 也可以脱离 SEA 直接跑（node scripts/desktop/server.cjs），此时改为读磁盘上的 dist/，
 * 方便在打包前验证服务器本身。
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

/** 读取内嵌资源包；不在 SEA 环境下则退回磁盘上的 dist/。 */
function loadFiles() {
  let sea = null;
  try { sea = require('node:sea'); } catch { /* 旧版 Node 无此模块 */ }

  if (sea && sea.isSea()) {
    const raw = Buffer.from(sea.getRawAsset('bundle'));
    const indexLength = Number(raw.readBigUInt64LE(0));
    const index = JSON.parse(raw.subarray(8, 8 + indexLength).toString('utf8'));
    const base = 8 + indexLength;
    const files = new Map();
    for (const [name, entry] of Object.entries(index)) {
      files.set(name, raw.subarray(base + entry.o, base + entry.o + entry.l));
    }
    return files;
  }

  const distDir = path.resolve(__dirname, '../../dist');
  if (!fs.existsSync(distDir)) {
    console.error('找不到 dist/，请先执行 npm run build');
    process.exit(1);
  }
  const files = new Map();
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else files.set(rel, fs.readFileSync(abs));
    }
  };
  walk(distDir, '');
  return files;
}

const files = loadFiles();

/** 解析单段 Range；视频拖动和媒体流都依赖它。 */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  let start;
  let end;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return { unsatisfiable: true };
  return { start, end: Math.min(end, size - 1) };
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  let name = pathname.replace(/^\/+/, '');
  if (name === '' || name.endsWith('/')) name += 'index.html';

  const body = files.get(name);
  if (!body) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    return;
  }

  const type = mimeOf(name);
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = parseRange(req.headers.range, body.length);

  if (range && range.unsatisfiable) {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${body.length}` }).end();
    return;
  }
  if (range) {
    const chunk = body.subarray(range.start, range.end + 1);
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${range.start}-${range.end}/${body.length}`,
      'Content-Length': chunk.length
    });
    res.end(req.method === 'HEAD' ? undefined : chunk);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
});

/** 端口被占用就顺延，避免多开或撞上其他服务时直接崩掉。 */
function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error('启动失败：', err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log('节奏星球已启动：' + url);
    console.log('保持本窗口开着；关闭窗口即结束游戏。');
    if (process.env.NO_OPEN !== '1') openBrowser(url);
  });
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    console.log('无法自动打开浏览器，请手动访问上面的地址。');
  }
}

listen(Number(process.env.PORT) || 5199, 20);
