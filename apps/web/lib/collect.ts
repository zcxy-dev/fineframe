// Files from a drop or a file picker, with their paths inside what was dropped, so footage in
// folders of its own (clips all named source.mp4) keeps the folder names that tell it apart.

export interface Picked {
  /** The path inside what was dropped, with forward slashes; a lone file's is its name. */
  path: string;
  file: File;
}

/** Every file in a drop, folders read to any depth, hidden files left out. */
export async function fromDrop(items: DataTransferItemList): Promise<Picked[]> {
  // Entries must be taken while the drop event runs; the list empties once it returns.
  const entries: FileSystemEntry[] = [];
  const loose: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) loose.push(file);
    }
  }
  const picked: Picked[] = loose.map((file) => ({ path: file.name, file }));
  for (const entry of entries) await walk(entry, picked);
  return picked.filter((item) => !hidden(item.path));
}

/** The files a picker chose; a folder picker gives each one's path inside the folder. */
export function fromInput(files: FileList): Picked[] {
  return Array.from(files)
    .map((file) => ({ path: file.webkitRelativePath || file.name, file }))
    .filter((item) => !hidden(item.path));
}

function hidden(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

async function walk(entry: FileSystemEntry, out: Picked[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({ path: entry.fullPath.replace(/^\/+/, ""), file });
    return;
  }
  if (!entry.isDirectory || entry.name.startsWith(".")) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // A directory reader hands out its entries in batches until it hands out none.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    for (const child of batch) await walk(child, out);
  }
}

/** A video's length in seconds, read from its header by the browser; null when it cannot. */
export function durationOf(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}
