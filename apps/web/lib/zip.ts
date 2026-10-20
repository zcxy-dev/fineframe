// A zip of files stored as they are, written as it streams: videos do not shrink when
// compressed, so storing them keeps "Download all" quick and needs no library.
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

/** Where a zip without its 64-bit extension ends: a size, offset or entry count of all ones marks
 * the extension's, so the largest it holds is one less. Shorts come nowhere near either. */
const ZIP64_BYTES = 0xffff_ffff;
const ZIP64_ENTRIES = 0xffff;

/** Whether `bytes`, a file's size or an offset, fits a zip without its 64-bit extension. */
export function fitsZip(bytes: number): boolean {
  return bytes < ZIP64_BYTES;
}
/** Bit 11 of the flags: the names are UTF-8, so 01-剪輯.mp4 opens as written everywhere. */
const UTF8 = 0x0800;
/** Version 2.0, the one that defines folders and stored files, on MS-DOS, as most zips say. */
const VERSION = 20;

/** Thrown when the files are too large or too many for a zip without its 64-bit extension. */
export class ArchiveTooLarge extends Error {
  override name = "ArchiveTooLarge";
}

/** The zip of `entries`, as it streams. Fails before any byte with ArchiveTooLarge when the
 * files would need the 64-bit extension. */
export async function zipStream(entries: readonly ArchiveEntry[]): Promise<ReadableStream> {
  if (entries.length >= ZIP64_ENTRIES) throw new ArchiveTooLarge(`${entries.length} files`);
  const sized: (ArchiveEntry & { size: number; data?: Buffer })[] = [];
  let total = 0;
  for (const entry of entries) {
    const data = entry.text === undefined ? undefined : Buffer.from(entry.text, "utf8");
    const size = data ? data.length : (await stat(entry.path as string)).size;
    total += size + 30 + Buffer.byteLength(entry.name);
    if (!fitsZip(size) || !fitsZip(total)) throw new ArchiveTooLarge(`${total} bytes`);
    sized.push({ ...entry, size, ...(data ? { data } : {}) });
  }
  return Readable.toWeb(Readable.from(write(sized))) as ReadableStream;
}

async function* write(entries: (ArchiveEntry & { size: number; data?: Buffer })[]) {
  const [time, date] = dosTime(new Date());
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = entry.data ? crc32(entry.data) : await fileCrc(entry.path as string);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.size, 18);
    local.writeUInt32LE(entry.size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    yield local;
    yield name;
    if (entry.data) yield entry.data;
    else yield* createReadStream(entry.path as string);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.size, 20);
    central.writeUInt32LE(entry.size, 24);
    central.writeUInt16LE(name.length, 28);
    // Extra field, comment, disk, internal and external attributes: none.
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + entry.size;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0);
  yield* directory;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
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
