"use client";

import { type ComponentProps, useState } from "react";
import { Icon } from "../Icon.tsx";
import { Input } from "./input.tsx";

/** A password field with a toggle, inside its right end, that shows what is typed. */
function PasswordInput({ show, ...props }: ComponentProps<"input"> & { show: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pr-12" />
      <button
        type="button"
        className="absolute top-1 right-1 grid size-10 place-items-center rounded-field text-ink-3 transition-colors hover:text-ink aria-pressed:text-ink"
        aria-label={show}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        <Icon name={visible ? "eyeOff" : "eye"} className="size-5" />
      </button>
    </div>
  );
}

export { PasswordInput };
