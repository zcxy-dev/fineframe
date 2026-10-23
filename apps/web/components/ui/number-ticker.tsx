"use client";

import { cn } from "cn";
import { useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { type ComponentPropsWithoutRef, useEffect, useRef } from "react";

// Magic UI's number ticker, changed for a number that keeps changing: each new value counts on
// from the last one shown, and with reduced motion it is simply written.

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number;
}

const format = (value: number) => String(Math.round(value));

export function NumberTicker({ value, className, ...props }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(value);
  const springValue = useSpring(motionValue, { damping: 30, stiffness: 100, restDelta: 0.5 });
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      if (ref.current) ref.current.textContent = format(value);
      motionValue.jump(value);
    } else motionValue.set(value);
  }, [motionValue, reduce, value]);

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) ref.current.textContent = format(latest);
      }),
    [springValue],
  );

  return (
    <span ref={ref} className={cn("inline-block tabular-nums", className)} {...props}>
      {/* The first render shows the number itself, so it reads right before it counts. */}
      {format(motionValue.get())}
    </span>
  );
}
