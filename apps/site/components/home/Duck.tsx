"use client";

import { useEffect, useRef } from "react";
import { still, watch } from "./media.ts";

/** How loud the voice is at `x`: phrases of speech, with quiet between them. */
function voiceAt(x: number): number {
  const t = x / 90;
  const phrase = Math.sin(t * 0.9) + Math.sin(t * 0.37 + 1) > 0.2;
  return phrase ? 0.35 + 0.65 * Math.abs(Math.sin(x * 0.61) * Math.cos(x * 0.23)) : 0.04;
}

/**
 * The music card's picture: speech on the top lane, and the music under it dropping while
 * someone talks and coming back in the gaps, flowing left while on screen. Under reduced
 * motion it holds still.
 */
export function Duck({ voice, music }: { voice: string; music: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue("--ink").trim();
    const amber = css.getPropertyValue("--amber").trim();
    const size = () => {
      const r = el.getBoundingClientRect();
      el.width = Math.round(r.width * devicePixelRatio);
      el.height = Math.round(r.height * devicePixelRatio);
    };
    const draw = (shift: number) => {
      const { width: W, height: H } = el;
      const d = devicePixelRatio;
      ctx.clearRect(0, 0, W, H);
      const step = 7 * d;
      let level = 1;
      for (let i = 0; i < Math.ceil(W / step); i++) {
        const x = i + shift;
        const v = voiceAt(x);
        level += ((v > 0.1 ? 0.28 : 1) - level) * 0.18;
        const vh = v * H * 0.36;
        ctx.fillStyle = ink;
        ctx.fillRect(i * step, H * 0.22 - vh / 2, 3.5 * d, Math.max(2 * d, vh));
        const mh = (0.45 + 0.55 * Math.abs(Math.sin(x * 0.37))) * level * H * 0.36;
        ctx.fillStyle = amber;
        ctx.globalAlpha = 0.45 + 0.55 * level;
        ctx.fillRect(i * step, H * 0.74 - mh / 2, 3.5 * d, Math.max(2 * d, mh));
        ctx.globalAlpha = 1;
      }
    };
    let shift = 0;
    const resize = () => {
      size();
      draw(shift);
    };
    resize();
    addEventListener("resize", resize);
    if (still()) return () => removeEventListener("resize", resize);
    let on = false;
    let last = 0;
    const tick = (now: number) => {
      if (!on) return;
      if (now - last > 60) {
        shift += 0.5;
        last = now;
        draw(shift);
      }
      requestAnimationFrame(tick);
    };
    const stop = watch(el, (seen) => {
      on = seen;
      if (seen) requestAnimationFrame(tick);
    });
    return () => {
      on = false;
      stop();
      removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="duck" aria-hidden="true">
      <span className="lbl v">{voice}</span>
      <span className="lbl m">{music}</span>
      <canvas ref={canvas} width={600} height={160} />
    </div>
  );
}
