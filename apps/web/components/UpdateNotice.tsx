"use client";

import { useEffect, useState } from "react";
import styles from "./editor.module.css";
import { useT } from "./I18n.tsx";

/** What the desktop app says of its update: downloaded and ready to install on a restart, or, on
 * a Mac, which cannot install it by itself, out and downloadable from `url`. */
type Update =
  | { kind: "ready"; version: string }
  | { kind: "available"; version: string; url: string };

/** The desktop app's update, which it sets on the window and announces with this event. */
const EVENT = "fineframe:update";
const current = () => (window as { fineframeUpdate?: Update }).fineframeUpdate ?? null;

/** A small notice of the desktop app's update, until dismissed; nothing elsewhere. */
export function UpdateNotice() {
  const t = useT();
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setUpdate(current());
    const changed = () => {
      setUpdate(current());
      setDismissed(false);
    };
    window.addEventListener(EVENT, changed);
    return () => window.removeEventListener(EVENT, changed);
  }, []);
  if (!update || dismissed) return null;
  return (
    <div className={styles.updateNotice} role="status">
      <span>
        {update.kind === "ready"
          ? t.update.ready(update.version)
          : t.update.available(update.version)}
      </span>
      {update.kind === "ready" ? (
        // The app restarts into the update when the window goes here.
        <a className={styles.primary} href="fineframe:restart">
          {t.update.restart}
        </a>
      ) : (
        <a className={styles.primary} href={update.url} target="_blank" rel="noreferrer">
          {t.update.download}
        </a>
      )}
      <button type="button" className={styles.inlineButton} onClick={() => setDismissed(true)}>
        {t.update.dismiss}
      </button>
    </div>
  );
}
