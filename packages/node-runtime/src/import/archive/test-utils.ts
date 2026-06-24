import { deflateRawSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

interface ZipFixtureEntry {
  name: string
  content: string | Buffer
  encrypted?: boolean
}

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let value = n
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[n] = value >>> 0
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * 测试专用的最小 ZIP 生成器，仅实现 UTF-8 文件名和 deflate，
 * 避免测试依赖系统 zip 命令或额外生产依赖。
 */
export function writeZipFixture(filePath: string, entries: ZipFixtureEntry[]): void {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8')
    const compressed = deflateRawSync(content)
    const flags = 0x0800 | (entry.encrypted ? 0x0001 : 0)
    const checksum = crc32(content)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(flags, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(name.length, 26)

    localParts.push(localHeader, name, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(flags, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt32LE(localOffset, 42)
    centralParts.push(centralHeader, name)

    localOffset += localHeader.length + name.length + compressed.length
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(localOffset, 16)

  writeFileSync(filePath, Buffer.concat([...localParts, ...centralParts, end]))
}
