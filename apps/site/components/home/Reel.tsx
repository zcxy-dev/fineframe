"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "../Icon.tsx";
import { clock, load, poster, still, wait, watch } from "./media.ts";

/** The source's stretches on the cut line: `true` kept, `false` cut out, each with its share. */
const SEGMENTS: [number, boolean][] = [
  [5, false],
  [2, true],
  [3, false],
  [3, true],
  [6, false],
  [2, true],
  [4, false],
  [3, true],
  [5, false],
  [2, true],
  [6, false],
];

/**
 * The hero's post: 22:42 of source footage is cut on a line of segments as its timecode counts
 * down to 0:50, a 9:16 frame follows the speaker, the camera pushes into it and the finished
 * Reel plays, while the four bars above fill as each step of the edit is done. Under reduced
 * motion the finished Reel stands still until its button plays it.
 */
export function Reel({
  post,
  steps,
  credit,
  pause,
  play,
}: {
  post: string;
  steps: string[];
  credit: ReactNode;
  pause: string;
  play: string;
}) {
  const reel = useRef<HTMLDivElement>(null);
  const src = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const cutline = useRef<HTMLDivElement>(null);
  const segs = useRef<HTMLDivElement>(null);
  const bars = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const tc = useRef<HTMLSpanElement>(null);
  const vsrc = useRef<HTMLVideoElement>(null);
  const out = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const control = useRef<{ toggle: () => void }>({ toggle: () => {} });

  useEffect(() => {
    const rl = reel.current;
    const sr = src.current;
    const bx = box.current;
    const cl = cutline.current;
    const sg = segs.current;
    const st = status.current;
    const t = tc.current;
    const vs = vsrc.current;
    const o = out.current;
    if (!rl || !sr || !bx || !cl || !sg || !st || !t || !vs || !o) return;
    const bar = [...(bars.current?.children ?? [])] as HTMLElement[];
    const fillTo = (i: number, p: number) => bar[i]?.style.setProperty("--p", String(p));
    const say = (i: number) => {
      st.textContent = steps[i] ?? "";
    };
    let run = 0;
    let isPaused = false;

    if (still()) {
      for (let i = 0; i < bar.length; i++) fillTo(i, 1);
      setPaused(true);
      control.current.toggle = () => {
        load(o);
        o.style.opacity = "1";
        o.loop = true;
        const playing = !o.paused;
        if (playing) o.pause();
        else o.play().catch(() => {});
        setPaused(playing);
      };
      return;
    }

    const fill = (i: number, ms: number) =>
      new Promise<void>((done) => {
        const t0 = performance.now();
        const step = (now: number) => {
          const p = Math.min(1, (now - t0) / ms);
          fillTo(i, p);
          if (p < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    const count = (from: number, to: number, ms: number) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / ms);
        t.textContent = clock(from + (to - from) * (1 - (1 - p) ** 3));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    /** The transform that makes the framing box fill the reel. */
    const zoom = () => {
      const s = rl.clientHeight / sr.clientHeight;
      return `translate(${-bx.offsetLeft * s}px, ${-sr.offsetTop}px) scale(${s})`;
    };
    const frame = async (me: number) => {
      const live = () => me === run && !isPaused;
      for (let i = 0; i < bar.length; i++) fillTo(i, 0);
      sg.className = "segs";
      bx.style.opacity = "0";
      bx.style.setProperty("--bx", "34.4%");
      sr.style.transition = "none";
      sr.style.transform = "none";
      sr.style.opacity = "1";
      cl.style.transition = "opacity .4s";
      cl.style.opacity = "1";
      o.style.opacity = "0";
      t.textContent = "22:42";
      vs.currentTime = 0;
      vs.play().catch(() => {});
      say(0);
      await fill(0, 1400);
      if (!live()) return;
      sg.classList.add("marked");
      say(1);
      await wait(500);
      sg.classList.add("closed");
      count(22 * 60 + 42, 50, 1600);
      await fill(1, 1700);
      if (!live()) return;
      say(2);
      bx.style.opacity = "1";
      await wait(500);
      bx.style.setProperty("--bx", "45.5%");
      await wait(900);
      bx.style.setProperty("--bx", "44%");
      await wait(600);
      if (!live()) return;
      cl.style.opacity = "0";
      sr.style.transition = "transform 1.1s cubic-bezier(.7,0,.2,1)";
      sr.style.transform = zoom();
      fill(2, 1500);
      await wait(1000);
      o.currentTime = 0;
      await o.play().catch(() => {});
      o.style.opacity = "1";
      await wait(500);
      sr.style.opacity = "0";
      vs.pause();
      say(3);
      await fill(3, 1600);
      if (!live()) return;
      say(4);
      await new Promise((done) => o.addEventListener("ended", done, { once: true }));
      await wait(600);
      if (live()) frame(me);
    };
    const start = () => {
      rl.classList.add("running");
      poster(vs);
      load(vs);
      load(o);
      run++;
      frame(run);
    };
    control.current.toggle = () => {
      isPaused = !isPaused;
      setPaused(isPaused);
      if (isPaused) {
        run++;
        vs.pause();
        o.pause();
      } else start();
    };
    // The footage waits until the page has loaded, so the first paint never waits for it.
    const begin = () => (window.requestIdleCallback ?? setTimeout)(start);
    if (document.readyState === "complete") begin();
    else addEventListener("load", begin, { once: true });
    const stop = watch(rl, (seen) => {
      if (isPaused) return;
      if (!seen) {
        o.pause();
        vs.pause();
      } else if (o.style.opacity === "1") o.play().catch(() => {});
    });
    return () => {
      run++;
      stop();
      removeEventListener("load", begin);
    };
  }, [steps]);

  return (
    <figure className="post" id="post">
      <div className="who">
        <img src="/icon.svg" alt="" width={32} height={32} />
        <div>
          <b>Fineframe</b>
          <small>{post}</small>
        </div>
      </div>
      <div className="reel" ref={reel}>
        <img
          className="poster"
          src="/media/hero-edit.webp"
          alt=""
          width={1080}
          height={1920}
          fetchPriority="high"
        />
        <div className="src" ref={src}>
          <video
            ref={vsrc}
            muted
            playsInline
            loop
            preload="none"
            data-src="/media/hero-source.mp4"
            data-src-sm="/media/hero-source-sm.mp4"
            data-sm-w="640"
            data-zoom="1.6"
            data-poster="/media/hero-source.webp"
            width={1920}
            height={1080}
          />
          <span className="box" ref={box}>
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="cutline" ref={cutline}>
          <div className="tc">
            <span ref={tc}>22:42</span>
          </div>
          <div className="segs" ref={segs}>
            {SEGMENTS.map(([grow, keep], i) => (
              <i
                key={i}
                className={keep ? "keep" : "drop"}
                style={{ "--g": grow } as CSSProperties}
              />
            ))}
          </div>
        </div>
        <video
          ref={out}
          className="out"
          muted
          playsInline
          preload="none"
          data-src="/media/hero-edit.mp4"
          data-src-sm="/media/hero-edit-sm.mp4"
          data-sm-w="432"
          width={1080}
          height={1920}
        />
        <div className="hud">
          <div className="bars" ref={bars}>
            <i />
            <i />
            <i />
            <i />
          </div>
          <p className="status" ref={status} aria-live="off">
            {steps[4]}
          </p>
        </div>
        <button
          className="pp"
          type="button"
          aria-label={paused ? play : pause}
          onClick={() => control.current.toggle()}
        >
          <Icon name={paused ? "play" : "pause"} className="size-3.5" />
        </button>
      </div>
      <figcaption className="credit">{credit}</figcaption>
    </figure>
  );
}
