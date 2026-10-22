// A file only its owner can read, such as the API keys' or the account's.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { promisify } from "node:util";

/** Writes `text` to `file`, readable and writable by its owner alone. */
export async function writePrivate(file: string, text: string): Promise<void> {
  // Written whole beside it and renamed over it, so a half-written file is never read.
  const partial = `${file}.${randomUUID()}.partial`;
  try {
    await writeFile(partial, text, { mode: 0o600 });
    // Windows ignores the mode: the access list drops what it takes from the folder, which may
    // let every user of the machine read. The rename keeps the list.
    if (process.platform === "win32") {
      const domain = process.env.USERDOMAIN;
      const owner = `${domain ? `${domain}\\` : ""}${userInfo().username}`;
      const args = [partial, "/inheritance:r", "/grant:r", `${owner}:F`];
      await promisify(execFile)("icacls", args, { windowsHide: true });
    }
    await rename(partial, file);
  } finally {
    await rm(partial, { force: true });
  }
}
