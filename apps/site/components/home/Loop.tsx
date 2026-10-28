"use client";

import { useEffect, useRef } from "react";
import { loop } from "./media.ts";

/** A muted loop of a finished edit that loads as it comes near and plays while on screen. */
export function Loop({
  src,
  poster,
  width,
  height,
  label,
}: {
  src: string;
  poster: string;
  width: number;
  height: number;
  label: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => (video.current ? loop(video.current) : undefined), []);
  return (
    <video
      ref={video}
      muted
      playsInline
      loop
      preload="none"
      data-src={src}
      data-poster={poster}
      width={width}
      height={height}
      aria-label={label}
    />
  );
}
