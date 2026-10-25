"use client";

import { brandTones } from "@video-editor/effects/colour";
import { layoutFor, rgba, watermarkPlacement } from "@video-editor/effects/layout";
import { brandPreset, type DrawnStyle, PRESETS, TYPE_SCALE } from "@video-editor/engine/captions";
import type { FaceId } from "@video-editor/engine/faces";
import type { Brand, BrandCaptions, BrandFont } from "@video-editor/schema";
import { ArrowLeft, Plus, Upload } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { CHECK, cn, HELP, LABEL, LABEL_HINT, SECTION, TITLE } from "../lib/styles.ts";
import { CaptionPreview } from "./CaptionPreview.tsx";
import { ErrorNote } from "./ErrorNote.tsx";
import { useT } from "./I18n.tsx";
import { Segments } from "./Segments.tsx";
import { Button, buttonVariants } from "./ui/button.tsx";
import { Input, NativeSelect } from "./ui/input.tsx";
import { TextAnimate } from "./ui/text-animate.tsx";
import { Workspace } from "./Workspace.tsx";

/** A brand kit as the server keeps it. */
export interface Kit {
  id: string;
  brand: Brand;
}

/** What /api/kits says: every kit, the default's id and the bundled faces. */
export interface KitList {
  kits: Kit[];
  default: string | null;
  faces: { id: FaceId; name: string }[];
}

/** The kits, loaded once and again on `reload`. */
export function useKits(): { list: KitList | null; reload: () => void } {
  const [list, setList] = useState<KitList | null>(null);
  const reload = useCallback(() => {
    void fetch("/api/kits")
      .then((response) => response.json() as Promise<KitList>)
      .then(setList)
      .catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  return { list, reload };
}

/** Where the page loads a kit's face from: a bundled one from the server, which downloads it on
 * first use, or the kit's own upload; none for the house face, which the page has. */
function faceUrl(kit: string, use: "graphics" | "captions", font?: BrandFont): string | null {
  if (!font) return null;
  if ("id" in font) return font.id === "noto-sans-tc" ? null : `/api/faces/${font.id}`;
  return `/api/kits/${kit}/files/${use}?v=${encodeURIComponent(font.path)}`;
}

/** The CSS family a face at `url` is loaded under once it has loaded; null for the house face
 * or until then. */
function useFace(url: string | null): string | null {
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    setFamily(null);
    if (!url) return;
    let live = true;
    const name = `kit-${[...url].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7)}`;
    void new FontFace(name, `url("${url}")`)
      .load()
      .then((face) => {
        document.fonts.add(face);
        if (live) setFamily(`"${name}"`);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);
  return family;
}

/** A kit's custom captions as a caption style to pick, in their colours and face. */
export function KitCaptionPreview({ kit }: { kit: Kit }) {
  const custom = kit.brand.captions;
  const font = useFace(faceUrl(kit.id, "captions", kit.brand.fonts?.captions));
  if (!custom) return null;
  return (
    <CaptionPreview
      style={custom.style}
      preset={brandPreset(custom.style, kit.brand.colors, custom)}
      {...(font ? { font } : {})}
    />
  );
}

/** The custom captions a kit starts with when they are switched on. */
const CUSTOM: BrandCaptions = {
  style: "bold",
  size: "M",
  text: "#ffffff",
  highlight: "#ffc233",
  frame: "outline",
  position: "bottom",
  lines: 2,
};

/** The size each aspect's sample frame is laid out at, as the edit renders it. */
const FRAMES = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
} as const;

/** A neutral stand-in for footage: a soft key light on a grey wall. */
const WALL: CSSProperties = {
  background:
    "radial-gradient(ellipse 55% 60% at 38% 40%, rgb(255 255 255 / 0.16), transparent 70%), radial-gradient(ellipse at center, transparent 40%, rgb(0 0 0 / 0.45) 100%), linear-gradient(160deg, #66707a, #3f464e 55%, #2a2e34)",
};

/** A sample frame in a kit's look, as an edit draws it: a name lower third in the graphics'
 * colours and face, a caption in the kit's captions, and the logo as its watermark. Laid out at
 * the output's size and scaled to fit, so every size and margin is the renderer's. */
function KitPreview({
  kit,
  brand,
  aspect,
}: {
  kit: string;
  brand: Brand;
  aspect: "16:9" | "9:16";
}) {
  const t = useT();
  const { width, height } = FRAMES[aspect];
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale((entry?.contentRect.width ?? 0) / width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  const graphics = useFace(faceUrl(kit, "graphics", brand.fonts?.graphics));
  const captions = useFace(faceUrl(kit, "captions", brand.fonts?.captions));
  // The logo's own size once it has loaded, by its address.
  const [logo, setLogo] = useState<{ url: string; width: number; height: number } | null>(null);
  const logoUrl = brand.logo ? `/api/kits/${kit}/files/logo?v=${brand.logo.file.path}` : null;

  const layout = layoutFor(aspect, width, height);
  const { u, safe } = layout;
  const tones = brandTones(brand.colors);
  const style: DrawnStyle = brand.captions?.style ?? "bold";
  const preset = brandPreset(style, brand.colors, brand.captions);
  const scaleOf = TYPE_SCALE[aspect];
  const em = scaleOf.em * Math.min(width, height) * preset.scale;
  const position = brand.captions?.position ?? "bottom";
  const captionAt: CSSProperties =
    position === "top"
      ? { top: scaleOf.band[0] * height }
      : position === "middle"
        ? { top: height / 2, translate: "-50% -50%" }
        : { bottom: (1 - scaleOf.bottom) * height };
  const sample = t.settings.sample;
  const caption: CSSProperties = {
    fontFamily: `${captions ?? ""}${captions ? ", " : ""}"Noto Sans TC", sans-serif`,
    fontWeight: preset.weight,
    fontSize: em,
    letterSpacing: `${preset.tracking}em`,
    color: preset.text,
    ...(preset.stroke
      ? {
          WebkitTextStroke: `${preset.stroke.width * 2}em ${preset.stroke.color}`,
          paintOrder: "stroke fill",
        }
      : {}),
    ...(preset.shadow
      ? {
          textShadow: `0 ${preset.shadow.offset}em ${preset.shadow.blur}em ${rgba(preset.shadow.color, preset.shadow.opacity)}`,
        }
      : {}),
    ...(preset.plate
      ? {
          background: rgba(preset.plate.color, preset.plate.opacity),
          padding: `${preset.plate.padY}em ${preset.plate.padX}em`,
          borderRadius: `${preset.plate.radius}em`,
        }
      : {}),
  };
  const mark =
    brand.logo?.show && logo
      ? watermarkPlacement(
          { ...logo, corner: brand.logo.corner, size: brand.logo.size },
          {
            aspect,
            width,
            height,
          },
        )
      : null;
  const graphicsFace = `${graphics ?? '"Inter Variable"'}, "Noto Sans TC", sans-serif`;
  return (
    <div
      ref={frame}
      className="relative w-full overflow-hidden rounded-md bg-black"
      style={{ aspectRatio: `${width} / ${height}` }}
      role="img"
      aria-label={t.kits.previewLabel}
    >
      <div
        className="absolute top-0 left-0 origin-top-left overflow-hidden"
        style={{ ...WALL, width, height, transform: `scale(${scale})` }}
      >
        <div
          className="absolute flex items-stretch border border-white/16 bg-[rgba(13,14,17,0.84)] text-[#f5f6f8]"
          style={{
            left: safe.left,
            ...(aspect === "9:16" ? { top: safe.top } : { bottom: safe.bottom }),
            gap: 1.6 * u,
            padding: `${1.6 * u}px ${3 * u}px ${1.6 * u}px ${1.6 * u}px`,
            borderRadius: 2.4 * u,
            boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 0 ${4 * u}px ${rgba(tones.primary, 0.16)}`,
            fontFamily: graphicsFace,
          }}
        >
          <span
            className="flex-none rounded-full"
            style={{
              width: 1.1 * u,
              background: tones.primary,
              boxShadow: `0 0 ${1.6 * u}px ${tones.primary}`,
            }}
          />
          <span>
            <span
              className="block leading-tight font-extrabold whitespace-nowrap"
              style={{ fontSize: layout.type("name") }}
            >
              {t.kits.sampleName}
            </span>
            <span
              className="mt-[0.15em] block leading-snug font-bold whitespace-nowrap text-[#a9adb5]"
              style={{ fontSize: layout.type("role") }}
            >
              {t.kits.sampleRole}
            </span>
          </span>
        </div>
        <div
          className="absolute left-1/2 -translate-x-1/2 leading-[1.2] whitespace-nowrap"
          style={{ ...captionAt, ...caption }}
        >
          {sample.map((word, i) => (
            <span
              // The words never change order.
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed sample.
              key={i}
              style={{
                color:
                  preset.keyword && /\d/.test(word)
                    ? preset.keyword
                    : i === 1
                      ? preset.active
                      : preset.text,
              }}
            >
              {i > 0 ? t.settings.sampleGap : ""}
              {word}
            </span>
          ))}
        </div>
        {logoUrl && (
          // biome-ignore lint/performance/noImgElement: the kit's own file, sized as the renderer sizes it.
          <img
            src={logoUrl}
            alt=""
            className="absolute object-contain"
            onLoad={(event) => {
              const image = event.currentTarget;
              setLogo({
                url: logoUrl,
                width: image.naturalWidth || 1,
                height: image.naturalHeight || 1,
              });
            }}
            style={
              mark
                ? {
                    left: mark.x,
                    top: mark.y,
                    width: mark.width,
                    height: mark.height,
                    opacity: brand.logo?.opacity,
                  }
                : { visibility: "hidden" }
            }
          />
        )}
      </div>
    </div>
  );
}

/** The Brand kit page (Q196): the kits, one of them as a sample frame, and its settings. */
export function BrandKits({ onClose }: { onClose: () => void }) {
  const t = useT();
  const words = t.kits;
  const { list, reload } = useKits();
  const [chosen, setChosen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Brand | null>(null);
  const [aspect, setAspect] = useState<"16:9" | "9:16">("16:9");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const kit = list?.kits.find((each) => each.id === chosen) ?? null;

  // The first kit, or the default, until another is chosen.
  useEffect(() => {
    if (!list || (chosen && list.kits.some((each) => each.id === chosen))) return;
    setChosen(list.default ?? list.kits[0]?.id ?? null);
  }, [list, chosen]);
  useEffect(() => {
    setDraft(kit ? structuredClone(kit.brand) : null);
    setSure(false);
  }, [kit]);

  const send = async (url: string, init: RequestInit): Promise<Kit | null> => {
    setBusy(true);
    try {
      const response = await fetch(url, init);
      const body = (await response.json().catch(() => ({}))) as Kit & { error?: string };
      if (!response.ok) {
        setError(body.error ?? words.failed);
        return null;
      }
      setError(null);
      return body;
    } finally {
      setBusy(false);
    }
  };
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const create = async () => {
    const made = await send("/api/kits", json("POST", { name: name || words.untitled }));
    if (!made) return;
    setName("");
    setChosen(made.id);
    reload();
  };
  const save = async () => {
    if (!kit || !draft) return;
    if (await send(`/api/kits/${kit.id}`, json("PUT", draft))) reload();
  };
  const remove = async () => {
    if (!kit) return;
    if (!sure) {
      setSure(true);
      return;
    }
    if (await send(`/api/kits/${kit.id}`, { method: "DELETE" })) {
      setChosen(null);
      reload();
    }
  };
  const makeDefault = async (on: boolean) => {
    if (!kit) return;
    await send("/api/kits/default", json("PUT", { id: on ? kit.id : null }));
    reload();
  };
  /** Uploads a file; what the kit then holds replaces the draft's file, and the rest of the
   * draft stays as changed. */
  const upload = async (url: string, file: File, take: (saved: Brand, draft: Brand) => Brand) => {
    const saved = await send(url, { method: "PUT", body: file });
    if (saved && draft) setDraft(take(saved.brand, draft));
    reload();
  };

  const dirty = kit && draft && JSON.stringify(kit.brand) !== JSON.stringify(draft);
  const set = (changes: Partial<Brand>) => draft && setDraft({ ...draft, ...changes });

  return (
    <Workspace
      label={words.title}
      panel={
        <>
          <div className={SECTION}>
            <span className={LABEL}>{words.kits}</span>
            {list && list.kits.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {list.kits.map((each) => (
                  <li key={each.id}>
                    <button
                      type="button"
                      className="flex min-h-10 w-full items-center gap-2.5 rounded-lg border-(length:--stroke) border-transparent px-3 text-left text-[13px] text-steel transition-colors hover:bg-raised hover:text-foreground aria-pressed:border-foreground aria-pressed:font-semibold aria-pressed:text-foreground"
                      aria-pressed={each.id === chosen}
                      onClick={() => setChosen(each.id)}
                    >
                      <span
                        className="size-3.5 flex-none rounded-[4px] shadow-[inset_0_0_0_1px_rgb(12_13_16/0.15)]"
                        style={{ background: each.brand.colors.primary }}
                      />
                      <span className="min-w-0 flex-1 truncate">{each.brand.name}</span>
                      {each.id === list.default && (
                        <span className={LABEL_HINT}>{words.isDefault}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <Input
                className="flex-1"
                value={name}
                maxLength={60}
                placeholder={words.newName}
                aria-label={words.newName}
                onChange={(event) => setName(event.target.value)}
              />
              <Button type="button" variant="outline" disabled={busy} onClick={create}>
                <Plus aria-hidden="true" />
                {words.create}
              </Button>
            </div>
          </div>

          {error && (
            <div className="px-6 pb-5 max-md:px-4">
              <ErrorNote message={error} fallback={words.failed} />
            </div>
          )}

          {kit && draft && list && (
            <KitFields
              kit={kit}
              draft={draft}
              faces={list.faces}
              isDefault={list.default === kit.id}
              busy={busy}
              set={set}
              onDefault={makeDefault}
              onLogo={(file) =>
                upload(`/api/kits/${kit.id}/logo`, file, (saved, current) => ({
                  ...current,
                  ...(saved.logo
                    ? { logo: { ...(current.logo ?? saved.logo), file: saved.logo.file } }
                    : {}),
                }))
              }
              onRemoveLogo={async () => {
                const saved = await send(`/api/kits/${kit.id}/logo`, { method: "DELETE" });
                if (saved) {
                  const { logo: _, ...rest } = draft;
                  setDraft(rest);
                }
                reload();
              }}
              onFont={(use, file) =>
                upload(
                  `/api/kits/${kit.id}/fonts/${use}?name=${encodeURIComponent(file.name)}`,
                  file,
                  (saved, current) => ({
                    ...current,
                    fonts: { ...current.fonts, [use]: saved.fonts?.[use] },
                  }),
                )
              }
            />
          )}
        </>
      }
      foot={
        kit &&
        draft && (
          <>
            <div className="flex gap-2">
              <Button type="button" className="flex-1" disabled={!dirty || busy} onClick={save}>
                {dirty ? words.save : words.saved}
              </Button>
              <Button
                type="button"
                variant={sure ? "danger" : "outline"}
                disabled={busy}
                onClick={remove}
              >
                {sure ? words.sure : words.remove}
              </Button>
            </div>
            <p className={HELP}>{words.removeHelp}</p>
          </>
        )
      }
    >
      <div className="flex flex-col gap-6 px-10 py-9 max-md:px-4 max-md:py-6">
        <div className="flex flex-col items-start gap-3">
          <Button type="button" variant="link" size="inline" onClick={onClose}>
            <ArrowLeft aria-hidden="true" />
            {words.back}
          </Button>
          <TextAnimate as="h1" by="word" animation="caption" startOnView={false} className={TITLE}>
            {words.title}
          </TextAnimate>
          <p className="max-w-[64ch] text-sm leading-relaxed text-steel">{words.lede}</p>
        </div>
        {kit && draft ? (
          <section className="flex flex-col gap-4" aria-label={words.preview}>
            <Segments
              className="w-auto self-start"
              options={(["16:9", "9:16"] as const).map((each) => ({ value: each, label: each }))}
              value={aspect}
              onChange={setAspect}
            />
            <div className="grid place-items-center rounded-2xl border bg-well p-8 max-md:p-4">
              <div
                className={cn(
                  "viewfinder relative w-full [--inset:-10px]",
                  aspect === "9:16" && "w-[min(100%,calc(58vh*9/16))]",
                )}
              >
                <KitPreview kit={kit.id} brand={draft} aspect={aspect} />
              </div>
            </div>
            <p className={HELP}>{words.previewHelp}</p>
          </section>
        ) : (
          list && (
            <section className="hatch grid min-h-60 place-items-center rounded-2xl border p-8 text-center">
              <p className="max-w-[44ch] text-[13px] text-steel">{words.empty}</p>
            </section>
          )
        )}
      </div>
    </Workspace>
  );
}

const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const STYLES: DrawnStyle[] = ["bold", "creator", "minimal", "pop"];
const SUB = "text-xs text-steel";
/** A colour well and its name. */
const COLOUR = "flex items-center gap-2.5 text-[13px]";
const SWATCH =
  "h-7 w-9 flex-none cursor-pointer rounded-md border border-edge bg-card p-0.5 disabled:cursor-not-allowed disabled:opacity-50";
/** A labelled slider and its value. */
const RANGE =
  "grid grid-cols-[5.5em_minmax(0,1fr)_3.5em] items-center gap-2 text-[13px] text-steel";

/** A kit's settings, each section changing the draft. */
function KitFields({
  kit,
  draft,
  faces,
  isDefault,
  busy,
  set,
  onDefault,
  onLogo,
  onRemoveLogo,
  onFont,
}: {
  kit: Kit;
  draft: Brand;
  faces: KitList["faces"];
  isDefault: boolean;
  busy: boolean;
  set: (changes: Partial<Brand>) => void;
  onDefault: (on: boolean) => void;
  onLogo: (file: File) => void;
  onRemoveLogo: () => void;
  onFont: (use: "graphics" | "captions", file: File) => void;
}) {
  const t = useT();
  const words = t.kits;
  const tones = brandTones(draft.colors);
  const colour = (role: "primary" | "secondary" | "accent") => (
    <div className={COLOUR} key={role}>
      <input
        type="color"
        className={SWATCH}
        aria-label={words.colours[role]}
        value={draft.colors[role] ?? tones[role]}
        disabled={role !== "primary" && draft.colors[role] === undefined}
        onChange={(event) => set({ colors: { ...draft.colors, [role]: event.target.value } })}
      />
      <span className="flex-1">{words.colours[role]}</span>
      {role !== "primary" && (
        <label className={CHECK}>
          <input
            type="checkbox"
            checked={draft.colors[role] === undefined}
            onChange={(event) => {
              const { [role]: _, ...rest } = draft.colors;
              set({
                colors: event.target.checked ? rest : { ...draft.colors, [role]: tones[role] },
              });
            }}
          />
          {words.fromPrimary}
        </label>
      )}
    </div>
  );
  const font = (use: "graphics" | "captions") => {
    const current = draft.fonts?.[use];
    const own = kit.brand.fonts?.[use];
    const uploaded = own && "path" in own ? own : current && "path" in current ? current : null;
    const value = !current ? "noto-sans-tc" : "id" in current ? current.id : "file";
    return (
      <div className="flex flex-col gap-2" key={use}>
        <label className={LABEL} htmlFor={`kit-${use}`}>
          {use === "graphics" ? words.graphicsFont : words.captionsFont}
        </label>
        <NativeSelect
          id={`kit-${use}`}
          value={value}
          onChange={(event) => {
            const picked = event.target.value;
            const { [use]: _, ...rest } = draft.fonts ?? {};
            const face: BrandFont | undefined =
              picked === "file" && uploaded
                ? { path: uploaded.path }
                : picked === "noto-sans-tc"
                  ? undefined
                  : { id: picked as FaceId };
            set({ fonts: face ? { ...rest, [use]: face } : rest });
          }}
        >
          {faces.map((face) => (
            <option key={face.id} value={face.id}>
              {words.faceName(face.id, face.name)}
            </option>
          ))}
          {uploaded && (
            <option value="file">
              {words.uploaded(uploaded.path.replace(/^fonts\/|-[0-9a-f]{12}(?=\.\w+$)/g, ""))}
            </option>
          )}
        </NativeSelect>
        <label className="cursor-pointer self-start rounded-sm text-[13px] font-medium text-steel underline decoration-edge underline-offset-[3px] hover:text-foreground hover:decoration-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
          <input
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onFont(use, file);
            }}
          />
          {words.uploadFont}
        </label>
      </div>
    );
  };
  const custom = draft.captions;
  const setCaptions = (changes: Partial<BrandCaptions>) =>
    custom && set({ captions: { ...custom, ...changes } });
  const lights = custom && PRESETS[custom.style].active !== PRESETS[custom.style].text;
  const keywords = custom && PRESETS[custom.style].keyword !== undefined;
  const fieldset = cn(SECTION, "m-0 min-w-0 border-0 border-t");
  const legend = cn(LABEL, "float-left");

  return (
    <>
      <div className={cn(SECTION, "border-t")}>
        <label className={LABEL} htmlFor="kit-name">
          {words.name}
        </label>
        <Input
          id="kit-name"
          value={draft.name}
          maxLength={60}
          onChange={(event) => set({ name: event.target.value })}
        />
        <label className={CHECK}>
          <input
            type="checkbox"
            checked={isDefault}
            disabled={busy}
            onChange={(event) => onDefault(event.target.checked)}
          />
          {words.makeDefault}
        </label>
      </div>

      <fieldset className={fieldset}>
        <legend className={legend}>{words.coloursTitle}</legend>
        {(["primary", "secondary", "accent"] as const).map(colour)}
        <p className={HELP}>{words.coloursHelp}</p>
      </fieldset>

      <div className={cn(SECTION, "border-t")}>
        {font("graphics")}
        {font("captions")}
        <p className={HELP}>{words.fontNote}</p>
      </div>

      <fieldset className={fieldset}>
        <legend className={legend}>{words.logo}</legend>
        <div className="flex items-center gap-3">
          <label
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
            )}
          >
            <input
              type="file"
              accept=".png,.svg,image/png,image/svg+xml"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onLogo(file);
              }}
            />
            <Upload aria-hidden="true" />
            {draft.logo ? words.replaceLogo : words.uploadLogo}
          </label>
          {draft.logo && (
            <Button type="button" variant="link" size="inline" onClick={onRemoveLogo}>
              {words.removeLogo}
            </Button>
          )}
        </div>
        {draft.logo && (
          <>
            <label className={CHECK}>
              <input
                type="checkbox"
                checked={draft.logo.show}
                onChange={(event) =>
                  draft.logo && set({ logo: { ...draft.logo, show: event.target.checked } })
                }
              />
              {words.watermark}
            </label>
            <Segments
              className="flex-wrap"
              options={CORNERS.map((corner) => ({ value: corner, label: words.corners[corner] }))}
              value={draft.logo.corner}
              onChange={(corner) => draft.logo && set({ logo: { ...draft.logo, corner } })}
            />
            <label className={RANGE}>
              <span>{words.size}</span>
              <input
                type="range"
                min={5}
                max={30}
                value={Math.round(draft.logo.size * 100)}
                onChange={(event) =>
                  draft.logo &&
                  set({ logo: { ...draft.logo, size: Number(event.target.value) / 100 } })
                }
              />
              <span className="tabular-nums">{Math.round(draft.logo.size * 100)} %</span>
            </label>
            <label className={RANGE}>
              <span>{words.opacity}</span>
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(draft.logo.opacity * 100)}
                onChange={(event) =>
                  draft.logo &&
                  set({ logo: { ...draft.logo, opacity: Number(event.target.value) / 100 } })
                }
              />
              <span className="tabular-nums">{Math.round(draft.logo.opacity * 100)} %</span>
            </label>
          </>
        )}
        <p className={HELP}>{words.logoHelp}</p>
      </fieldset>

      <fieldset className={fieldset}>
        <legend className={legend}>{words.captions}</legend>
        <label className={CHECK}>
          <input
            type="checkbox"
            checked={custom !== undefined}
            onChange={(event) => set({ captions: event.target.checked ? CUSTOM : undefined })}
          />
          {words.useCaptions}
        </label>
        {custom && (
          <>
            <span className={SUB}>{words.startsFrom}</span>
            <Segments
              options={STYLES.map((style) => ({ value: style, label: t.captions[style].name }))}
              value={custom.style}
              onChange={(style) => setCaptions({ style })}
            />
            <span className={SUB}>{words.size}</span>
            <Segments
              options={(["S", "M", "L"] as const).map((size) => ({
                value: size,
                label: words.sizes[size],
              }))}
              value={custom.size}
              onChange={(size) => setCaptions({ size })}
            />
            <div className={COLOUR}>
              <input
                type="color"
                className={SWATCH}
                aria-label={words.text}
                value={custom.text}
                onChange={(event) => setCaptions({ text: event.target.value })}
              />
              <span className="flex-1">{words.text}</span>
            </div>
            {(lights || keywords) && (
              <div className={COLOUR}>
                <input
                  type="color"
                  className={SWATCH}
                  aria-label={words.highlight}
                  value={custom.highlight}
                  onChange={(event) => setCaptions({ highlight: event.target.value })}
                />
                <span className="flex-1">{keywords ? words.keywords : words.highlight}</span>
              </div>
            )}
            <span className={SUB}>{words.frame}</span>
            <Segments
              options={(["outline", "box"] as const).map((frame) => ({
                value: frame,
                label: words.frames[frame],
              }))}
              value={custom.frame}
              onChange={(frame) => setCaptions({ frame })}
            />
            <span className={SUB}>{words.position}</span>
            <Segments
              options={(["bottom", "middle", "top"] as const).map((position) => ({
                value: position,
                label: words.positions[position],
              }))}
              value={custom.position}
              onChange={(position) => setCaptions({ position })}
            />
            <span className={SUB}>{words.lines}</span>
            <Segments
              options={([1, 2] as const).map((lines) => ({
                value: lines,
                label: words.lineCount(lines),
              }))}
              value={custom.lines}
              onChange={(lines) => setCaptions({ lines })}
            />
          </>
        )}
        <p className={HELP}>{custom ? words.captionsHelp : words.captionsOff}</p>
      </fieldset>
    </>
  );
}
