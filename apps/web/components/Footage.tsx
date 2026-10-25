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
import { type DragEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { fromDrop, fromInput, type Picked } from "../lib/collect.ts";
import { formatBytes, formatClock, type Role } from "../lib/settings.ts";
import { cn, HELP, LABEL, META, SLUG } from "../lib/styles.ts";
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

/** A tile's picture: the footage's own frame, or an icon on graphite. */
const FRAME =
  "relative grid aspect-video place-items-center overflow-hidden rounded-xl bg-graphite text-white/70 [&>svg]:size-5";
const NAME = "truncate text-[13px] font-medium";

/** The drop zone and the link field; once footage is in, a tile of each file and link, with a
 * frame of each video and photo, beside a tile that takes more. */
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
  const dragging = {
    onDragEnter: (event: DragEvent) => {
      event.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragOver: (event: DragEvent) => event.preventDefault(),
    onDragLeave: () => {
      depth.current -= 1;
      if (depth.current <= 0) setOver(false);
    },
    onDrop: drop,
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
  const pickers = (
    <>
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
    </>
  );
  const choose = (size: "sm" | "default") => (
    <div className="flex flex-wrap justify-center gap-2">
      <Button type="button" variant="outline" size={size} onClick={() => files.current?.click()}>
        <Plus aria-hidden="true" />
        {words.chooseFiles}
      </Button>
      <Button type="button" variant="outline" size={size} onClick={() => folder.current?.click()}>
        <FolderOpen aria-hidden="true" />
        {words.chooseFolder}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {compact ? (
        <section
          className="flex flex-col gap-4 rounded-2xl border bg-card p-5 max-sm:p-4"
          aria-label={words.title}
          {...dragging}
        >
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className={SLUG}>{words.title}</h2>
              <p className={cn(META, "mt-1")}>
                {words.videos(videos.length + links.length)}
                {photos > 0 && `${t.sep}${words.photos(photos)}`}
                {music > 0 && `${t.sep}${words.tracks(music)}`}
                {seconds > 0 && `${t.sep}${words.inAll(formatClock(seconds))}`}
                {skipped > 0 && `${t.sep}${words.leftOut(skipped)}`}
              </p>
            </div>
            <Button type="button" variant="link" size="inline" onClick={onClear}>
              {words.clear}
            </Button>
          </div>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-0">
            {items.map((item) => (
              <Tile
                key={item.key}
                name={item.path}
                off={item.off}
                remove={words.remove(item.path)}
                onRemove={() => onRemove(item.key)}
                frame={<Preview item={item} />}
                meta={
                  item.off ? (
                    words.notUsed
                  ) : (
                    <>
                      {item.use === "music" && `${words.music}${t.sep}`}
                      {item.use !== "image" &&
                        `${
                          item.duration === undefined
                            ? "…"
                            : item.duration === null
                              ? words.lengthUnknown
                              : formatClock(item.duration)
                        }${t.sep}`}
                      {item.use === "image" && `${words.photo}${t.sep}`}
                      {formatBytes(item.file.size)}
                    </>
                  )
                }
                action={
                  item.use === "music" && (
                    <button
                      type="button"
                      className="self-start text-xs text-steel underline decoration-edge underline-offset-2 hover:text-foreground hover:decoration-foreground"
                      aria-label={
                        item.off ? words.asMusicLabel(item.path) : words.notMusicLabel(item.path)
                      }
                      onClick={() => onToggle(item.key)}
                    >
                      {item.off ? words.asMusic : words.notMusic}
                    </button>
                  )
                }
              />
            ))}
            {links.map((link) => (
              <Tile
                key={link.url}
                name={link.video?.title ?? link.url}
                remove={words.remove(link.video?.title ?? link.url)}
                onRemove={() => onRemoveLink(link.url)}
                frame={
                  <span className={FRAME}>
                    <Link2 aria-hidden="true" />
                  </span>
                }
                meta={
                  link.video
                    ? [
                        link.video.site,
                        link.video.seconds === null
                          ? words.lengthUnknown
                          : formatClock(link.video.seconds),
                        words.fromLink,
                      ]
                        .filter(Boolean)
                        .join(t.sep)
                    : words.reading
                }
              />
            ))}
            {/* More footage, in viewfinder corners that open out and darken while it is dragged
                over the card. */}
            <li className="flex min-w-0 flex-col">
              <button
                type="button"
                className={cn(
                  "corners hatch grid aspect-video place-items-center rounded-xl border border-dashed border-edge text-steel transition-colors duration-300 hover:text-foreground",
                  over && "border-foreground/40 bg-primary/10 text-foreground",
                )}
                data-over={over}
                onClick={() => files.current?.click()}
              >
                <span className="flex flex-col items-center gap-1.5 text-[13px] font-semibold">
                  <span
                    className={cn(
                      "grid size-8 place-items-center rounded-full border border-edge bg-card transition-[transform,background-color] duration-500 ease-(--ease-cut) [&_svg]:size-4",
                      over && "-translate-y-1 border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    <Plus aria-hidden="true" />
                  </span>
                  {words.dropMore}
                </span>
              </button>
              <Button
                type="button"
                variant="link"
                size="inline"
                className="mt-2 self-start text-xs"
                onClick={() => folder.current?.click()}
              >
                <FolderOpen aria-hidden="true" />
                {words.chooseFolder}
              </Button>
            </li>
          </ul>
          {pickers}
        </section>
      ) : (
        // The footage going in, in viewfinder corners that open out and darken while it is
        // dragged over.
        <section
          className={cn(
            "corners hatch flex min-h-72 flex-col items-center justify-center gap-5 rounded-2xl border px-6 py-12 text-center transition-[background-color,border-color] duration-300 max-sm:min-h-52",
            over && "border-foreground/40 bg-primary/10",
          )}
          data-over={over}
          aria-label={words.dropHere}
          {...dragging}
        >
          <div
            className={cn(
              "grid size-14 shrink-0 place-items-center rounded-full border border-edge bg-card text-steel transition-[color,transform,border-color] duration-500 ease-(--ease-cut) [&_svg]:size-5.5",
              over && "-translate-y-1 border-primary bg-primary text-primary-foreground",
            )}
          >
            <Upload aria-hidden="true" />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <p className="text-lg font-semibold tracking-[-0.01em]">{words.drop}</p>
            <p className="max-w-[48ch] text-[13px] text-steel">{words.hint}</p>
          </div>
          {choose("default")}
          {pickers}
        </section>
      )}

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
          {words.linkHint} {words.rights}
        </p>
      </div>
    </div>
  );
}

/** One file or link: its frame, name and details, and a button that takes it out. */
function Tile({
  name,
  meta,
  frame,
  action,
  off = false,
  remove,
  onRemove,
}: {
  name: string;
  meta: ReactNode;
  frame: ReactNode;
  action?: ReactNode;
  off?: boolean | undefined;
  remove: string;
  onRemove: () => void;
}) {
  return (
    <li className="relative flex min-w-0 flex-col gap-1.5 animate-in fade-in-0 zoom-in-[0.97] duration-300">
      <div className={cn("transition-opacity", off && "opacity-40")}>{frame}</div>
      <span className={cn(NAME, off && "text-muted-foreground")} title={name}>
        {name}
      </span>
      <span className={cn(META, "-mt-1 truncate")}>{meta}</span>
      {action}
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="absolute top-1.5 right-1.5 size-7 border-transparent bg-card/90"
        aria-label={remove}
        onClick={onRemove}
      >
        <X aria-hidden="true" />
      </Button>
    </li>
  );
}

/** A frame of a video or a photo, read from the file in the browser; an icon for music, or for a
 * file the browser cannot show. */
function Preview({ item }: { item: Item }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const { file, use } = item;
  // One address for the file, kept while its length is read and the tile renders again.
  useEffect(() => {
    if (use === "music") return;
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file, use]);
  const icon = item.use === "music" ? <Music2 /> : item.use === "image" ? <ImageIcon /> : <Film />;
  return (
    <span className={FRAME} aria-hidden="true">
      {icon}
      {url &&
        !failed &&
        (item.use === "image" ? (
          // biome-ignore lint/performance/noImgElement: the dropped file itself, from the browser.
          <img
            src={url}
            alt=""
            className="absolute inset-0 size-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <video
            // A moment in, so the tile shows a frame rather than the first black one.
            src={`${url}#t=1`}
            className="absolute inset-0 size-full object-cover"
            muted
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
          />
        ))}
      {item.use === "video" && item.duration ? (
        <span className="absolute bottom-1.5 left-1.5 rounded-md bg-graphite/80 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">
          {formatClock(item.duration)}
        </span>
      ) : null}
    </span>
  );
}
