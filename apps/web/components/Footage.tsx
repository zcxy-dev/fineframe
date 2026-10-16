"use client";

import { type DragEvent, useRef, useState } from "react";
import { fromDrop, fromInput, type Picked } from "../lib/collect.ts";
import { formatBytes, formatClock, type Role } from "../lib/settings.ts";
import styles from "./editor.module.css";
import {
  AudioIcon,
  CloseIcon,
  FilmIcon,
  FolderIcon,
  ImageIcon,
  PlusIcon,
  UploadIcon,
} from "./icons.tsx";

export interface Item {
  key: string;
  path: string;
  file: File;
  use: Role;
  /** Music the user chose not to offer the edit. */
  off?: boolean;
  /** Seconds; undefined while it is read, null when the browser cannot read it. */
  duration?: number | null;
}

interface Props {
  items: readonly Item[];
  skipped: number;
  onAdd: (picked: Picked[]) => void;
  onRemove: (key: string) => void;
  /** Offers a music file to the edit, or stops offering it. */
  onToggle: (key: string) => void;
  onClear: () => void;
}

/** The drop zone, then the list of what was dropped. */
export function Footage({ items, skipped, onAdd, onRemove, onToggle, onClear }: Props) {
  const [over, setOver] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const drop = async (event: DragEvent) => {
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    onAdd(await fromDrop(event.dataTransfer.items));
  };
  const videos = items.filter((item) => item.use === "video");
  const photos = items.filter((item) => item.use === "image").length;
  const music = items.filter((item) => item.use === "music" && !item.off).length;
  const seconds = videos.reduce((sum, item) => sum + (item.duration ?? 0), 0);
  const compact = items.length > 0;

  return (
    <div className={styles.footage}>
      <section
        className={compact ? `${styles.drop} ${styles.dropCompact}` : styles.drop}
        data-over={over}
        aria-label="Drop footage here"
        onDragEnter={(event) => {
          event.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          depth.current -= 1;
          if (depth.current <= 0) setOver(false);
        }}
        onDrop={drop}
      >
        <div className={styles.dropIcon}>
          <UploadIcon width={22} height={22} />
        </div>
        <div className={styles.dropText}>
          <p className={styles.dropTitle}>
            {compact ? "Drop more footage" : "Drop video files or a whole folder"}
          </p>
          {!compact && (
            <p className={styles.dropHint}>
              Videos are cut into the edit; photos can appear over it as B-roll, and audio files are
              music for it.
            </p>
          )}
        </div>
        <div className={styles.dropButtons}>
          <button type="button" className={styles.button} onClick={() => files.current?.click()}>
            <PlusIcon width={16} height={16} />
            Choose files
          </button>
          <button type="button" className={styles.button} onClick={() => folder.current?.click()}>
            <FolderIcon width={16} height={16} />
            Choose a folder
          </button>
        </div>
        <input
          ref={files}
          type="file"
          multiple
          accept="video/*,image/*,audio/*,.mkv,.mts,.m2ts,.mxf"
          hidden
          onChange={(event) => {
            if (event.target.files) onAdd(fromInput(event.target.files));
            event.target.value = "";
          }}
        />
        <input
          ref={folder}
          type="file"
          hidden
          {...{ webkitdirectory: "", directory: "" }}
          onChange={(event) => {
            if (event.target.files) onAdd(fromInput(event.target.files));
            event.target.value = "";
          }}
        />
      </section>

      {compact && (
        <div className={`${styles.card} ${styles.files}`}>
          <div className={styles.filesHead}>
            <div>
              <h2 className={styles.filesTitle}>Footage</h2>
              <p className={styles.filesMeta}>
                {videos.length} {videos.length === 1 ? "video" : "videos"}
                {photos > 0 && ` · ${photos} ${photos === 1 ? "photo" : "photos"}`}
                {music > 0 && ` · ${music} music ${music === 1 ? "track" : "tracks"}`}
                {seconds > 0 && ` · ${formatClock(seconds)} in all`}
                {skipped > 0 && ` · ${skipped} other ${skipped === 1 ? "file" : "files"} left out`}
              </p>
            </div>
            <button type="button" className={styles.linkButton} onClick={onClear}>
              Clear all
            </button>
          </div>
          <ul className={styles.fileList}>
            {items.map((item) => (
              <li key={item.key} className={styles.file} data-unused={item.off === true}>
                <span className={styles.fileIcon}>
                  {item.use === "video" ? (
                    <FilmIcon />
                  ) : item.use === "image" ? (
                    <ImageIcon />
                  ) : (
                    <AudioIcon />
                  )}
                </span>
                <span className={styles.fileText}>
                  <span className={styles.fileName} title={item.path}>
                    {item.path}
                  </span>
                  <span className={styles.fileMeta}>
                    {item.off ? (
                      <span className={styles.badge}>Not used</span>
                    ) : (
                      <>
                        {item.use === "music" && "Music · "}
                        {item.use !== "image" && (
                          <>
                            {item.duration === undefined
                              ? "…"
                              : item.duration === null
                                ? "Length unknown"
                                : formatClock(item.duration)}
                            {" · "}
                          </>
                        )}
                        {item.use === "image" && "Photo · "}
                        {formatBytes(item.file.size)}
                      </>
                    )}
                    {item.use === "music" && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className={styles.inlineButton}
                          aria-label={`${item.off ? "Use" : "Don't use"} ${item.path} as music`}
                          onClick={() => onToggle(item.key)}
                        >
                          {item.off ? "Use as music" : "Don't use"}
                        </button>
                      </>
                    )}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`Remove ${item.path}`}
                  onClick={() => onRemove(item.key)}
                >
                  <CloseIcon width={16} height={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
