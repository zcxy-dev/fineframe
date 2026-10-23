// A zip of files stored as they are, written as it streams: videos do not shrink when
// compressed, so storing them keeps "Download all" quick and needs no library. A size, offset or
// count too large for a zip's own fields goes in its 64-bit extension (ZIP64), and only those.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";

/** One file in the zip: a file on disk, or text. */
export interface ArchiveEntry {
  name: string;
  path?: string;
  text?: string;
}

/** A field of all ones says its value is in the 64-bit extension instead. */
const ALL_ONES = 0xffff_ffff;
const ALL_ONES_SHORT = 0xffff;
/** Bit 11 of the flags: the names are UTF-8, so 01-剪輯.mp4 opens as written everywhere. */
const UTF8 = 0x0800;
/** Version 2.0, the one that defines folders and stored files; 4.5 for a header that needs the
 * 64-bit extension. */
const VERSION = 20;
const VERSION_ZIP64 = 45;
/** Made on Unix, each file readable by all (0644), as Info-ZIP and Python write zips: Info-ZIP's
 * unzip misreads the UTF-8 name of a file past 4 GiB in a zip made on MS-DOS. */
const MADE_ON_UNIX = 0x0300;
const FILE_MODE = (0o100644 << 16) >>> 0;

/** The zip of `entries`, as it streams. */
export async function zipStream(entries: readonly ArchiveEntry[]): Promise<ReadableStream> {
  const sized: (ArchiveEntry & { size: number; data?: Buffer })[] = [];
  for (const entry of entries) {
    const data = entry.text === undefined ? undefined : Buffer.from(entry.text, "utf8");
    const size = data ? data.length : (await stat(entry.path as string)).size;
    sized.push({ ...entry, size, ...(data ? { data } : {}) });
  }
  return Readable.toWeb(Readable.from(write(sized))) as ReadableStream;
}

/** `value` as a 32-bit field holds it: all ones when it is in the 64-bit extension. */
const field = (value: number) => Math.min(value, ALL_ONES);

/** The 64-bit extension's extra field with `values`, or none without any. */
function zip64(values: number[]): Buffer {
  if (values.length === 0) return Buffer.alloc(0);
  const extra = Buffer.alloc(4 + 8 * values.length);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(8 * values.length, 2);
  for (const [i, value] of values.entries()) extra.writeBigUInt64LE(BigInt(value), 4 + 8 * i);
  return extra;
}

async function* write(entries: (ArchiveEntry & { size: number; data?: Buffer })[]) {
  const [time, date] = dosTime(new Date());
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = entry.data ? crc32(entry.data) : await fileCrc(entry.path as string);
    // A local header with the extension holds both sizes there.
    const localExtra = zip64(entry.size >= ALL_ONES ? [entry.size, entry.size] : []);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(localExtra.length ? VERSION_ZIP64 : VERSION, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(field(entry.size), 18);
    local.writeUInt32LE(field(entry.size), 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    yield local;
    yield name;
    if (localExtra.length) yield localExtra;
    if (entry.data) yield entry.data;
    else yield* createReadStream(entry.path as string);
    // The central header's extension holds only what its fields cannot, in this order.
    const extra = zip64([entry.size, entry.size, offset].filter((value) => value >= ALL_ONES));
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    const version = extra.length ? VERSION_ZIP64 : VERSION;
    central.writeUInt16LE(MADE_ON_UNIX | version, 4);
    central.writeUInt16LE(version, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(field(entry.size), 20);
    central.writeUInt32LE(field(entry.size), 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    // Comment, disk and internal attributes: none.
    central.writeUInt32LE(FILE_MODE, 38);
    central.writeUInt32LE(field(offset), 42);
    directory.push(central, name, extra);
    offset += local.length + name.length + localExtra.length + entry.size;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0);
  yield* directory;
  if (entries.length >= ALL_ONES_SHORT || size >= ALL_ONES || offset >= ALL_ONES) {
    // The 64-bit end of the central directory, and where it is.
    const end64 = Buffer.alloc(56);
    end64.writeUInt32LE(0x06064b50, 0);
    end64.writeBigUInt64LE(44n, 4);
    end64.writeUInt16LE(VERSION_ZIP64, 12);
    end64.writeUInt16LE(VERSION_ZIP64, 14);
    end64.writeBigUInt64LE(BigInt(entries.length), 24);
    end64.writeBigUInt64LE(BigInt(entries.length), 32);
    end64.writeBigUInt64LE(BigInt(size), 40);
    end64.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + size), 8);
    locator.writeUInt32LE(1, 16);
    yield end64;
    yield locator;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(entries.length, ALL_ONES_SHORT), 8);
  end.writeUInt16LE(Math.min(entries.length, ALL_ONES_SHORT), 10);
  end.writeUInt32LE(field(size), 12);
  end.writeUInt32LE(field(offset), 16);
  yield end;
}

async function fileCrc(path: string): Promise<number> {
  let crc = 0;
  for await (const chunk of createReadStream(path)) crc = crc32(chunk as Buffer, crc);
  return crc;
}

/** A local time as MS-DOS writes it in a zip: [time, date]. */
function dosTime(at: Date): [number, number] {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2);
  const date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  return [time, date];
}
