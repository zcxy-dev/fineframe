// Pure, so the web page sorts dropped files with the same rules as the command.

export type MediaKind = "video" | "audio" | "image";

export const EXTENSIONS: Record<MediaKind, readonly string[]> = {
  video: [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mts", ".m2ts", ".mxf", ".3gp"],
  audio: [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aif", ".aiff"],
  image: [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"],
};

/** The kind a file's name says it is, by its extension in any case; null for anything else. */
export function kindOf(name: string): MediaKind | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot < name.lastIndexOf("/")) return null;
  const extension = name.slice(dot).toLowerCase();
  const found = Object.entries(EXTENSIONS).find(([, list]) => list.includes(extension));
  return found ? (found[0] as MediaKind) : null;
}
