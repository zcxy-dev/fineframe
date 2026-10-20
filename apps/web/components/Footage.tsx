"use client";

import { type DragEvent, useId, useRef, useState } from "react";
import { fromDrop, fromInput, type Picked } from "../lib/collect.ts";
import { formatBytes, formatClock, type Role } from "../lib/settings.ts";
import styles from "./editor.module.css";
import { useT } from "./I18n.tsx";
import {
  AudioIcon,
  CloseIcon,
  FilmIcon,
  FolderIcon,
  ImageIcon,
  LinkIcon,
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

/** A pasted link's video, which the server fetches when the edit starts. */
export interface LinkItem {
  url: string;
  /** Undefined while the server reads the link. */
  video?: { title: string; seconds: number | null; site: string };
}

interface Props {
  items: readonly Item[];
  links: readonly LinkItem[];
  /** Why the last link pasted cannot be imported. */
  linkError: string | null;
  skipped: number;
  onAdd: (picked: Picked[]) => void;
  /** Adds each link in what was pasted. */
  onAddLinks: (text: string) => void;
  onRemoveLink: (url: string) => void;
  onRemove: (key: string) => void;
  /** Offers a music file to the edit, or stops offering it. */
  onToggle: (key: string) => void;
  onClear: () => void;
}

/** The drop zone and the link field, then the list of what was dropped and pasted. */
export function Footage({
  items,
  links,
  linkError,
  skipped,
  onAdd,
  onAddLinks,
  onRemoveLink,
  onRemove,
  onToggle,
  onClear,
}: Props) {
  const t = useT();
  const words = t.footage;
  const id = useId();
  const [over, setOver] = useState(false);
  const [pasted, setPasted] = useState("");
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const drop = async (event: DragEvent) => {
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    onAdd(await fromDrop(event.dataTransfer.items));
  };
  const addLinks = () => {
    if (!pasted.trim()) return;
    onAddLinks(pasted);
    setPasted("");
  };
  const videos = items.filter((item) => item.use === "video");
  const photos = items.filter((item) => item.use === "image").length;
  const music = items.filter((item) => item.use === "music" && !item.off).length;
  const seconds =
    videos.reduce((sum, item) => sum + (item.duration ?? 0), 0) +
    links.reduce((sum, link) => sum + (link.video?.seconds ?? 0), 0);
  const compact = items.length + links.length > 0;

  return (
    <div className={styles.footage}>
      <section
        className={compact ? `${styles.drop} ${styles.dropCompact}` : styles.drop}
        data-over={over}
        aria-label={words.dropHere}
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
          <p className={styles.dropTitle}>{compact ? words.dropMore : words.drop}</p>
          {!compact && <p className={styles.dropHint}>{words.hint}</p>}
        </div>
        <div className={styles.dropButtons}>
          <button type="button" className={styles.button} onClick={() => files.current?.click()}>
            <PlusIcon width={16} height={16} />
            {words.chooseFiles}
          </button>
          <button type="button" className={styles.button} onClick={() => folder.current?.click()}>
            <FolderIcon width={16} height={16} />
            {words.chooseFolder}
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

      <div className={styles.linkField}>
        <label className={styles.label} htmlFor={`${id}-link`}>
          {words.link}
        </label>
        <div className={styles.linkRow}>
          <input
            id={`${id}-link`}
            className={styles.input}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder={words.linkPlaceholder}
            aria-invalid={linkError !== null}
            aria-describedby={`${id}-link-hint`}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addLinks();
            }}
          />
          <button type="button" className={styles.button} onClick={addLinks}>
            <LinkIcon width={16} height={16} />
            {words.addLink}
          </button>
        </div>
        {linkError && (
          <p className={styles.linkError} role="alert">
            {linkError}
          </p>
        )}
        <p className={styles.help} id={`${id}-link-hint`}>
          {words.linkHint}
        </p>
        <p className={styles.rights}>{words.rights}</p>
      </div>

      {compact && (
        <div className={`${styles.card} ${styles.files}`}>
          <div className={styles.filesHead}>
            <div>
              <h2 className={styles.filesTitle}>{words.title}</h2>
              <p className={styles.filesMeta}>
                {words.videos(videos.length + links.length)}
                {photos > 0 && ` · ${words.photos(photos)}`}
                {music > 0 && ` · ${words.tracks(music)}`}
                {seconds > 0 && ` · ${words.inAll(formatClock(seconds))}`}
                {skipped > 0 && ` · ${words.leftOut(skipped)}`}
              </p>
            </div>
            <button type="button" className={styles.linkButton} onClick={onClear}>
              {words.clear}
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
                      <span className={styles.badge}>{words.notUsed}</span>
                    ) : (
                      <>
                        {item.use === "music" && `${words.music} · `}
                        {item.use !== "image" && (
                          <>
                            {item.duration === undefined
                              ? "…"
                              : item.duration === null
                                ? words.lengthUnknown
                                : formatClock(item.duration)}
                            {" · "}
                          </>
                        )}
                        {item.use === "image" && `${words.photo} · `}
                        {formatBytes(item.file.size)}
                      </>
                    )}
                    {item.use === "music" && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className={styles.inlineButton}
                          aria-label={
                            item.off
                              ? words.asMusicLabel(item.path)
                              : words.notMusicLabel(item.path)
                          }
                          onClick={() => onToggle(item.key)}
                        >
                          {item.off ? words.asMusic : words.notMusic}
                        </button>
                      </>
                    )}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={words.remove(item.path)}
                  onClick={() => onRemove(item.key)}
                >
                  <CloseIcon width={16} height={16} />
                </button>
              </li>
            ))}
            {links.map((link) => (
              <li key={link.url} className={styles.file}>
                <span className={styles.fileIcon}>
                  <LinkIcon />
                </span>
                <span className={styles.fileText}>
                  <span className={styles.fileName} title={link.url}>
                    {link.video?.title ?? link.url}
                  </span>
                  <span className={styles.fileMeta}>
                    {link.video
                      ? [
                          link.video.site,
                          link.video.seconds === null
                            ? words.lengthUnknown
                            : formatClock(link.video.seconds),
                          words.fromLink,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : words.reading}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={words.remove(link.video?.title ?? link.url)}
                  onClick={() => onRemoveLink(link.url)}
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
