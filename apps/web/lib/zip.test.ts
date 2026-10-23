import assert from "node:assert/strict";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import { fileTitle } from "./paths.ts";
import { zipStream } from "./zip.ts";

test("a title becomes a file name every system keeps", () => {
  assert.equal(fileTitle('a/b\\c:d*e?f"g<h>i|j'), "a b c d e f g h i j");
  assert.equal(fileTitle("剪輯：一天…  "), "剪輯：一天…");
  assert.equal(fileTitle("Ends with dots..."), "Ends with dots");
  assert.equal(fileTitle("tab\there\nnewline"), "tab here newline");
  assert.equal(fileTitle("???"), "short");
  // Names Windows keeps for devices, with or without an extension after them.
  assert.equal(fileTitle("CON"), "CON_");
  assert.equal(fileTitle("nul.final"), "nul_.final");
  assert.equal(fileTitle("Com1"), "Com1_");
  assert.equal(fileTitle("Console"), "Console");
  // At most 60 characters, counted as people read them, not as UTF-16 halves.
  assert.equal([...fileTitle("影".repeat(80))].length, 60);
  assert.equal([...fileTitle("😀".repeat(80))].length, 60);
});

/** A zip as it streamed: its length, and every part of it but a file's data read from disk. */
async function streamed(stream: ReadableStream<Uint8Array>) {
  const parts: { at: number; bytes: Buffer }[] = [];
  let length = 0;
  for await (const chunk of stream) {
    // Files stream in chunks of 64 KiB; headers, names and texts come as parts of their own.
    if (chunk.length < 65_536) parts.push({ at: length, bytes: Buffer.from(chunk) });
    length += chunk.length;
  }
  const read = (at: number, size: number) => {
    // The last part starting at or before `at`.
    let [low, high] = [0, parts.length - 1];
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((parts[middle] as (typeof parts)[number]).at <= at) low = middle;
      else high = middle - 1;
    }
    const part = parts[low];
    assert.ok(part && part.at <= at && at + size <= part.at + part.bytes.length, `not kept: ${at}`);
    return part.bytes.subarray(at - part.at, at - part.at + size);
  };
  return { length, read };
}

/** Each file in the zip as its central directory and its local header both describe it, read
 * as an unzipper does, through the 64-bit extension wherever a field is all ones. */
async function unzip(stream: ReadableStream<Uint8Array>) {
  const { length, read } = await streamed(stream);
  const end = read(length - 22, 22);
  assert.equal(end.readUInt32LE(0), 0x06054b50);
  let count = end.readUInt16LE(10);
  let directory = end.readUInt32LE(16);
  if (count === 0xffff || directory === 0xffff_ffff) {
    const locator = read(length - 42, 20);
    assert.equal(locator.readUInt32LE(0), 0x07064b50);
    const zip64 = read(Number(locator.readBigUInt64LE(8)), 56);
    assert.equal(zip64.readUInt32LE(0), 0x06064b50);
    count = Number(zip64.readBigUInt64LE(32));
    directory = Number(zip64.readBigUInt64LE(48));
  }
  /** The sizes and offset of a header, from its 64-bit extra field where they are all ones. */
  const widen = (fields: number[], extra: Buffer) => {
    let at = 0;
    while (at < extra.length && extra.readUInt16LE(at) !== 1) at += 4 + extra.readUInt16LE(at + 2);
    let next = at + 4;
    return fields.map((value) => {
      if (value !== 0xffff_ffff) return value;
      next += 8;
      return Number(extra.readBigUInt64LE(next - 8));
    });
  };
  const files: { name: string; size: number; at: number; crc: number }[] = [];
  let at = directory;
  for (let n = 0; n < count; n++) {
    const header = read(at, 46);
    assert.equal(header.readUInt32LE(0), 0x02014b50);
    const [names, extras, comments] = [28, 30, 32].map((field) => header.readUInt16LE(field));
    const name = read(at + 46, names as number).toString("utf8");
    const extra = read(at + 46 + (names as number), extras as number);
    const [size, compressed, offset] = widen(
      [24, 20, 42].map((field) => header.readUInt32LE(field)),
      extra,
    ) as [number, number, number];
    assert.equal(compressed, size);
    const local = read(offset, 30);
    assert.equal(local.readUInt32LE(0), 0x04034b50);
    assert.equal(read(offset + 30, local.readUInt16LE(26)).toString("utf8"), name);
    const localExtra = read(offset + 30 + local.readUInt16LE(26), local.readUInt16LE(28));
    assert.deepEqual(
      widen(
        [22, 18].map((field) => local.readUInt32LE(field)),
        localExtra,
      ),
      [size, size],
    );
    files.push({
      name,
      size,
      at: offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28),
      crc: header.readUInt32LE(16),
    });
    at += 46 + (names as number) + (extras as number) + (comments as number);
  }
  return { files, read };
}

test("more files than a zip without its 64-bit extension counts are all written", async () => {
  const entries = Array.from({ length: 65_537 }, (_, i) => ({ name: `${i}.txt`, text: `${i}` }));
  const { files, read } = await unzip(await zipStream(entries));
  assert.equal(files.length, 65_537);
  const last = files.at(-1);
  assert.equal(last?.name, "65536.txt");
  assert.equal(read(last?.at ?? 0, last?.size ?? 0).toString(), "65536");
});

test("a file of 4 GiB or more is written whole, and the files after it are found", {
  // Windows may write the sparse file out in full; the zip is the same on every system.
  skip: process.platform === "win32" && "a sparse file of 4 GiB",
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zip64-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const big = join(dir, "overlay.mov");
  const file = await open(big, "w");
  await file.truncate(2 ** 32 + 16);
  await file.close();
  const { files, read } = await unzip(
    await zipStream([
      { name: "README.txt", text: "first" },
      { name: "media/overlay.mov", path: big },
      { name: "edit.fcpxml", text: "after" },
    ]),
  );
  assert.deepEqual(
    files.map(({ name, size }) => [name, size]),
    [
      ["README.txt", 5],
      ["media/overlay.mov", 2 ** 32 + 16],
      ["edit.fcpxml", 5],
    ],
  );
  const after = files[2] as (typeof files)[number];
  assert.ok(after.at > 2 ** 32);
  assert.equal(read(after.at, after.size).toString(), "after");
  assert.equal(after.crc, crc32("after"));
});
