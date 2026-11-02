"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "../Icon.tsx";
import { Button } from "../ui/button.tsx";
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
 * The hero's post, a window of the app marked as a sample: 22:42 of source footage is cut on a
 * line of segments as its timecode counts down to 0:50, a 9:16 frame follows the speaker, the
 * camera pushes into it and the finished Reel plays, while the steps beside it fill as each is
 * done and say what it does. Picking a step replays the edit from it; Start over replays it all.
 * Under reduced motion the finished Reel stands still until its button plays it, and picking a
 * step only says what it does.
 */
export function Reel({
  post,
  steps,
  details,
  sample,
  reset,
  hint,
  legend,
  credit,
  pause,
  play,
}: {
  post: string;
  steps: string[];
  details: string[];
  sample: string;
  reset: string;
  hint: string;
  legend: [string, string];
  credit: ReactNode;
  pause: string;
  play: string;
}) {
  const reel = useRef<HTMLDivElement>(null);
  const src = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const cutline = useRef<HTMLDivElement>(null);
  const segs = useRef<HTMLDivElement>(null);
  const bars = useRef<HTMLOListElement>(null);
  const detail = useRef<HTMLParagraphElement>(null);
  const tc = useRef<HTMLSpanElement>(null);
  const vsrc = useRef<HTMLVideoElement>(null);
  const out = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const control = useRef<{ toggle: () => void; jump: (step: number) => void }>({
    toggle: () => {},
    jump: () => {},
  });

  useEffect(() => {
    const rl = reel.current;
    const sr = src.current;
    const bx = box.current;
    const cl = cutline.current;
    const sg = segs.current;
    const dt = detail.current;
    const t = tc.current;
    const vs = vsrc.current;
    const o = out.current;
    if (!rl || !sr || !bx || !cl || !sg || !dt || !t || !vs || !o) return;
    const bar = [...(bars.current?.children ?? [])] as HTMLElement[];
    const fillTo = (i: number, p: number) => bar[i]?.style.setProperty("--p", String(p));
    /** Marks step `i` as the one shown, or none. */
    const point = (i: number) =>
      bar.forEach((b, j) => {
        if (j === i) b.firstElementChild?.setAttribute("aria-current", "step");
        else b.firstElementChild?.removeAttribute("aria-current");
      });
    /** Marks the steps before `i` done and `i` running, and says what it does; 4 is the end. */
    const say = (i: number) => {
      bar.forEach((b, j) => {
        b.dataset.state = j < i ? "done" : j === i ? "active" : "pending";
      });
      point(i);
      dt.textContent = details[i] ?? steps[i] ?? "";
    };
    let run = 0;
    let isPaused = false;

    if (still()) {
      for (let i = 0; i < bar.length; i++) fillTo(i, 1);
      say(4);
      setPaused(true);
      control.current.jump = (i) => {
        say(4);
        if (i < 4) {
          point(i);
          dt.textContent = details[i] ?? "";
        }
      };
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

    // Both stop once a newer run has started, so a step picked mid-run starts clean.
    const fill = (i: number, ms: number) =>
      new Promise<void>((done) => {
        const me = run;
        const t0 = performance.now();
        const step = (now: number) => {
          if (me !== run) return done();
          const p = Math.min(1, (now - t0) / ms);
          fillTo(i, p);
          if (p < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    const count = (from: number, to: number, ms: number) => {
      const me = run;
      const t0 = performance.now();
      const step = (now: number) => {
        if (me !== run) return;
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
    /** Plays the edit, from step `from`: the steps before it stand done at once. */
    const frame = async (me: number, from = 0) => {
      const live = () => me === run && !isPaused;
      const skip = (i: number) => i < from;
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
      if (skip(0)) fillTo(0, 1);
      else await fill(0, 1400);
      if (!live()) return;
      sg.classList.add("marked");
      say(1);
      if (skip(1)) {
        sg.classList.add("closed");
        t.textContent = "0:50";
        fillTo(1, 1);
      } else {
        await wait(500);
        if (!live()) return;
        sg.classList.add("closed");
        count(22 * 60 + 42, 50, 1600);
        await fill(1, 1700);
      }
      if (!live()) return;
      say(2);
      if (skip(2)) {
        bx.style.setProperty("--bx", "44%");
        sr.style.transform = zoom();
        cl.style.opacity = "0";
        fillTo(2, 1);
        say(3);
      } else {
        bx.style.opacity = "1";
        await wait(500);
        if (!live()) return;
        bx.style.setProperty("--bx", "45.5%");
        await wait(900);
        if (!live()) return;
        bx.style.setProperty("--bx", "44%");
        await wait(600);
        if (!live()) return;
        cl.style.opacity = "0";
        sr.style.transition = "transform 1.1s cubic-bezier(.7,0,.2,1)";
        sr.style.transform = zoom();
        fill(2, 1500);
        await wait(1000);
        if (!live()) return;
      }
      o.currentTime = 0;
      await o.play().catch(() => {});
      if (!live()) return;
      o.style.opacity = "1";
      await wait(500);
      if (!live()) return;
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
    const start = (from = 0) => {
      rl.classList.add("running");
      poster(vs);
      load(vs);
      load(o);
      run++;
      frame(run, from);
    };
    control.current.jump = (i) => {
      isPaused = false;
      setPaused(false);
      vs.pause();
      o.pause();
      start(i);
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
    const begin = () => (window.requestIdleCallback ?? setTimeout)(() => start());
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
  }, [steps, details]);

  return (
    <figure className="post" id="post">
      <div className="bar">
        <div className="who">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <div>
            <b>Fineframe</b>
            <small>{post}</small>
          </div>
        </div>
        <span className="tag">{sample}</span>
        <Button variant="outline" size="sm" type="button" onClick={() => control.current.jump(0)}>
          <Icon name="reset" />
          {reset}
        </Button>
      </div>
      <div className="panes">
        <div className="rail">
          <ol className="steps" ref={bars}>
            {steps.slice(0, 4).map((step, i) => (
              <li key={step} data-state="done">
                <button type="button" onClick={() => control.current.jump(i)}>
                  <span className="n">{i + 1}</span>
                  {step}
                </button>
              </li>
            ))}
          </ol>
          <p className="detail" ref={detail}>
            {steps[4]}
          </p>
          <p className="hint">{hint}</p>
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
              data-src-md="/media/hero-source-md.mp4"
              data-md-w="1280"
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
              <span className="legend">
                <i className="keep" />
                {legend[0]}
                <i className="drop" />
                {legend[1]}
              </span>
              <span className="time" ref={tc}>
                22:42
              </span>
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
            data-src-md="/media/hero-edit-md.mp4"
            data-md-w="720"
            width={1080}
            height={1920}
          />
          <button
            className="pp"
            type="button"
            aria-label={paused ? play : pause}
            onClick={() => control.current.toggle()}
          >
            <Icon name={paused ? "play" : "pause"} className="size-3.5" />
          </button>
        </div>
      </div>
      <figcaption className="credit">{credit}</figcaption>
    </figure>
  );
}
