"use client";

import type { ReactNode } from "react";
import { cn, SEGMENT, SEGMENTS } from "../lib/styles.ts";

/** Options as one segmented control of pressed buttons: the chosen one in steel. */
export function Segments<T extends string | number | boolean>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly { value: T; label: ReactNode; describedBy?: string | undefined }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn(SEGMENTS, className)}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={SEGMENT}
          aria-pressed={option.value === value}
          aria-describedby={option.describedBy}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
