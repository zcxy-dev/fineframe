import type { ReactNode } from "react";
import { lastTwo } from "../../lib/english.ts";
import { Icon } from "../Icon.tsx";

/**
 * What a form becomes once its link is on the way: a mail tile, what to do next, and the ways
 * on from here.
 */
export function Sent({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  /** The ways on: starting again with another address, going back. */
  children: ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-5 text-center" role="status">
      <span className="grid size-12 place-items-center rounded-frame bg-amber text-ink">
        <Icon name="mail" className="size-6" />
      </span>
      <div className="grid gap-2">
        <h2 className="text-subhead">{title}</h2>
        <p className="text-ink-2">{lastTwo(text)}</p>
      </div>
      <div className="grid w-full gap-3">{children}</div>
    </div>
  );
}
