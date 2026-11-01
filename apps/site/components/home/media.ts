// What the home page's moving parts share: whether to hold still, loading a video only when
// it is needed, and watching an element come on and off the screen.

/** Whether the visitor asked for reduced motion: then nothing plays by itself. */
export const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Gives a video its source the first time it is needed: the small copy (`data-src-sm`) on
 * phones and wherever it is sharp enough, else the medium copy (`data-src-md`, for a Retina
 * desktop) where that is, else the full one. Sharp enough: at least the pixels the video is
 * shown at (`data-sm-w`, `data-md-w` pixels wide, against its width times `data-zoom` when it
 * is shown enlarged), the medium copy within a tenth of them.
 */
export function load(video: HTMLVideoElement) {
  const d = video.dataset;
  if (d.loaded) return;
  d.loaded = "1";
  const phone = matchMedia("(max-width: 760px)").matches;
  const need =
    (video.clientWidth || video.parentElement?.clientWidth || 0) *
    devicePixelRatio *
    Number(d.zoom || 1);
  if (d.srcSm && (phone || need <= Number(d.smW))) video.src = d.srcSm;
  else if (d.srcMd && need <= Number(d.mdW) * 1.1) video.src = d.srcMd;
  else video.src = d.src ?? "";
}

/** Shows a video's first frame, from `data-poster`, once it comes near the screen. */
export function poster(video: HTMLVideoElement) {
  if (video.dataset.poster && !video.poster) video.poster = video.dataset.poster;
}

/** Calls `on(visible)` as `el` comes onto and leaves the screen; returns the stop. */
export function watch(el: Element, on: (visible: boolean) => void, margin = "0px") {
  const observer = new IntersectionObserver(([entry]) => on(Boolean(entry?.isIntersecting)), {
    rootMargin: margin,
    threshold: 0.15,
  });
  observer.observe(el);
  return () => observer.disconnect();
}

/** A promise that settles after `ms`. */
export const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** m:ss, rounded to the second first, so 59.6 s reads 1:00 and never 0:60. */
export function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A looping video that loads as it comes near and plays only while on screen; under reduced
 * motion it waits for a click, with the browser's controls.
 */
export function loop(video: HTMLVideoElement): () => void {
  const stops = [
    watch(video, (near) => near && poster(video), "600px"),
    watch(video, (near) => near && !still() && load(video), "300px"),
  ];
  if (still()) {
    video.controls = true;
    const play = () => {
      if (video.dataset.loaded) return;
      load(video);
      video.play().catch(() => {});
    };
    video.addEventListener("play", play, { once: true });
    stops.push(() => video.removeEventListener("play", play));
  } else {
    stops.push(watch(video, (seen) => (seen ? video.play().catch(() => {}) : video.pause())));
  }
  return () => {
    for (const stop of stops) stop();
  };
}
