#!/usr/bin/env node
/**
 * 把 MP4 的 moov 原子从文件尾搬到 mdat 之前（即 ffmpeg 的 `-movflags +faststart`）。
 *
 * moov 放在尾部时，浏览器必须先下完整个文件才知道怎么解码，片头视频就会“点了没反应”。
 * 搬到前面后，<video> 边下边播，几百 KB 就能起播。
 *
 * 这是无损重排：只挪动原子位置，并把 stco/co64 里记录的 chunk 绝对偏移整体加上 moov 的长度，
 * 不重新编码，画质与体积不变。
 *
 * 用法：node scripts/faststart-mp4.mjs <输入.mp4> [输出.mp4]
 * 省略输出时原地覆盖（先写临时文件再替换）。
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';

/** 需要递归下钻查找 stco/co64 的容器原子。 */
const CONTAINERS = new Set([
  'moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'mvex', 'moof', 'traf'
]);

/** 读取一个原子头，返回 { type, headerSize, size }；size 为含头的总长度。 */
function readAtom(buf, offset) {
  if (offset + 8 > buf.length) return null;
  let size = buf.readUInt32BE(offset);
  const type = buf.toString('latin1', offset + 4, offset + 8);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > buf.length) return null;
    const large = buf.readBigUInt64BE(offset + 8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    headerSize = 16;
  } else if (size === 0) {
    size = buf.length - offset; // 延伸到文件尾
  }
  if (size < headerSize) return null;
  return { type, size, headerSize };
}

/** 列出 [start, end) 范围内的顶层原子。 */
function listAtoms(buf, start, end) {
  const atoms = [];
  let p = start;
  while (p < end) {
    const atom = readAtom(buf, p);
    if (!atom || p + atom.size > end) break;
    atoms.push({ ...atom, offset: p });
    p += atom.size;
  }
  return atoms;
}

/** 就地把 moov 内所有 stco/co64 记录的偏移加上 delta。 */
function shiftChunkOffsets(moov, delta) {
  let patched = 0;
  const walk = (start, end) => {
    for (const atom of listAtoms(moov, start, end)) {
      const body = atom.offset + atom.headerSize;
      if (atom.type === 'stco') {
        const count = moov.readUInt32BE(body + 4);
        for (let i = 0; i < count; i++) {
          const at = body + 8 + i * 4;
          const next = moov.readUInt32BE(at) + delta;
          if (next > 0xffffffff) throw new Error('stco 偏移超过 32 位，需要改用 co64');
          moov.writeUInt32BE(next, at);
        }
        patched += count;
      } else if (atom.type === 'co64') {
        const count = moov.readUInt32BE(body + 4);
        for (let i = 0; i < count; i++) {
          const at = body + 8 + i * 8;
          moov.writeBigUInt64BE(moov.readBigUInt64BE(at) + BigInt(delta), at);
        }
        patched += count;
      } else if (CONTAINERS.has(atom.type)) {
        walk(body, atom.offset + atom.size);
      }
    }
  };
  walk(0, moov.length);
  return patched;
}

function faststart(inputPath, outputPath) {
  const buf = readFileSync(inputPath);
  const atoms = listAtoms(buf, 0, buf.length);
  if (atoms.length === 0) throw new Error('不是有效的 MP4：读不出顶层原子');

  const moovIndex = atoms.findIndex((a) => a.type === 'moov');
  const mdatIndex = atoms.findIndex((a) => a.type === 'mdat');
  if (moovIndex < 0) throw new Error('找不到 moov 原子');
  if (mdatIndex < 0) throw new Error('找不到 mdat 原子');
  if (moovIndex < mdatIndex) {
    console.log(`${inputPath}: moov 已经在 mdat 之前，无需处理。`);
    return false;
  }

  const moovAtom = atoms[moovIndex];
  const moov = Buffer.from(buf.subarray(moovAtom.offset, moovAtom.offset + moovAtom.size));
  if (listAtoms(moov, moovAtom.headerSize, moov.length).some((a) => a.type === 'cmov')) {
    throw new Error('moov 是压缩格式（cmov），本脚本不支持');
  }

  // moov 插到 mdat 前面，mdat 里所有 chunk 的绝对偏移整体后移 moov 的长度。
  const patched = shiftChunkOffsets(moov, moovAtom.size);

  const before = atoms.slice(0, mdatIndex).map((a) => buf.subarray(a.offset, a.offset + a.size));
  const after = atoms
    .slice(mdatIndex)
    .filter((a) => a.type !== 'moov')
    .map((a) => buf.subarray(a.offset, a.offset + a.size));
  const out = Buffer.concat([...before, moov, ...after]);

  if (out.length !== buf.length) {
    throw new Error(`重排后大小不一致：${buf.length} -> ${out.length}`);
  }

  const tmp = `${outputPath}.tmp`;
  writeFileSync(tmp, out);
  if (existsSync(outputPath)) unlinkSync(outputPath);
  renameSync(tmp, outputPath);
  console.log(
    `${outputPath}: moov(${moovAtom.size} 字节) 已前移，修正 ${patched} 个 chunk 偏移，总大小不变 ${out.length} 字节。`
  );
  return true;
}

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('用法：node scripts/faststart-mp4.mjs <输入.mp4> [输出.mp4]');
  process.exit(1);
}
faststart(input, output ?? input);
