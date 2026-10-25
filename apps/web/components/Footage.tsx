"use client";

import {
  Film,
  FolderOpen,
  ImageIcon,
  Link2,
  Music2,
  Plus,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { type DragEvent, useId, useRef, useState } from "react";
import { fromDrop, fromInput, type Picked } from "../lib/collect.ts";
import { formatBytes, formatClock, type Role } from "../lib/settings.ts";
import { cn, HELP, ICON_FRAME, LABEL, LIST, META, SLUG } from "../lib/styles.ts";
import { useT } from "./I18n.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

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

const ROW =
  "grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent animate-in fade-in-0 slide-in-from-top-1 duration-300";
const NAME = "truncate text-[13px] font-medium";

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
    <div className="flex flex-col gap-6">
      {/* The footage going in, in viewfinder corners that open out and darken while it is dragged
          over. */}
      <section
        className={cn(
          "corners flex items-center rounded-2xl border transition-[background-color,border-color] duration-300",
          compact
            ? "gap-3 bg-card px-4 py-3 max-sm:flex-wrap"
            : "hatch min-h-72 flex-col justify-center gap-5 px-6 py-12 text-center max-sm:min-h-52",
          over && "border-foreground/40 bg-primary/10",
        )}
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
        <div
          className={cn(
            "grid shrink-0 place-items-center rounded-full border border-edge bg-card text-steel transition-[color,transform,border-color] duration-500 ease-(--ease-cut)",
            compact ? "size-9 [&_svg]:size-4" : "size-14 [&_svg]:size-5.5",
            over && "-translate-y-1 border-primary bg-primary text-primary-foreground",
          )}
        >
          <Upload aria-hidden="true" />
        </div>
        <div
          className={cn("flex flex-col gap-1.5", compact ? "flex-1 items-start" : "items-center")}
        >
          <p
            className={cn("font-semibold", compact ? "text-[13px]" : "text-lg tracking-[-0.01em]")}
          >
            {compact ? words.dropMore : words.drop}
          </p>
          {!compact && <p className="max-w-[48ch] text-[13px] text-steel">{words.hint}</p>}
        </div>
        <div className={cn("flex flex-wrap justify-center gap-2", compact && "max-sm:w-full")}>
          <Button
            type="button"
            variant="outline"
            size={compact ? "sm" : "default"}
            className="max-sm:flex-1"
            onClick={() => files.current?.click()}
          >
            <Plus aria-hidden="true" />
            {words.chooseFiles}
          </Button>
          <Button
            type="button"
            variant="outline"
            size={compact ? "sm" : "default"}
            className="max-sm:flex-1"
            onClick={() => folder.current?.click()}
          >
            <FolderOpen aria-hidden="true" />
            {words.chooseFolder}
          </Button>
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

      <div className="flex flex-col gap-2">
        <label className={LABEL} htmlFor={`${id}-link`}>
          {words.link}
        </label>
        <div className="flex gap-2">
          <Input
            id={`${id}-link`}
            className="h-10 flex-1"
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
          <Button type="button" variant="outline" onClick={addLinks}>
            <Link2 aria-hidden="true" />
            {words.addLink}
          </Button>
        </div>
        {linkError && (
          <p
            className="flex gap-1.5 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]"
            role="alert"
          >
            <TriangleAlert
              className="mt-0.5 size-3.5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            {linkError}
          </p>
        )}
        <p className={HELP} id={`${id}-link-hint`}>
          {words.linkHint}
        </p>
        <p className="text-xs leading-relaxed text-steel">{words.rights}</p>
      </div>

      {compact && (
        <section className="flex flex-col gap-3 animate-in fade-in-0 duration-300">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className={SLUG}>{words.title}</h2>
              <p className={cn(META, "mt-1")}>
                {words.videos(videos.length + links.length)}
                {photos > 0 && ` · ${words.photos(photos)}`}
                {music > 0 && ` · ${words.tracks(music)}`}
                {seconds > 0 && ` · ${words.inAll(formatClock(seconds))}`}
                {skipped > 0 && ` · ${words.leftOut(skipped)}`}
              </p>
            </div>
            <Button type="button" variant="link" size="inline" onClick={onClear}>
              {words.clear}
            </Button>
          </div>
          <ul className={cn(LIST, "max-h-[420px] overflow-y-auto")}>
            {items.map((item) => (
              <li key={item.key} className={ROW}>
                <span className={cn(ICON_FRAME, item.off && "text-muted-foreground")}>
                  {item.use === "video" ? (
                    <Film aria-hidden="true" />
                  ) : item.use === "image" ? (
                    <ImageIcon aria-hidden="true" />
                  ) : (
                    <Music2 aria-hidden="true" />
                  )}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={cn(NAME, item.off && "text-muted-foreground")} title={item.path}>
                    {item.path}
                  </span>
                  <span className={META}>
                    {item.off ? (
                      <span className="text-steel">{words.notUsed}</span>
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
                          className="text-steel underline decoration-edge underline-offset-2 hover:text-foreground hover:decoration-foreground"
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={words.remove(item.path)}
                  onClick={() => onRemove(item.key)}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
            {links.map((link) => (
              <li key={link.url} className={ROW}>
                <span className={ICON_FRAME}>
                  <Link2 aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={NAME} title={link.url}>
                    {link.video?.title ?? link.url}
                  </span>
                  <span className={META}>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={words.remove(link.video?.title ?? link.url)}
                  onClick={() => onRemoveLink(link.url)}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
