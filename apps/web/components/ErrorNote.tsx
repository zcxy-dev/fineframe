"use client";

import { type ReactNode, useId, useState } from "react";
import { explain } from "../lib/fixes.ts";
import styles from "./editor.module.css";
import { AlertIcon } from "./icons.tsx";

/** Something that failed, as a person reads it: what happened and what to do, with the program's
 * own message behind "Show details". `fallback` says what failed when the message cannot. */
export function ErrorNote({
  message,
  fallback,
  children,
}: {
  message: string;
  fallback: string;
  /** Actions that recover, under the explanation. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { summary, next, details } = explain(message, fallback);
  return (
    <div className={styles.error} role="alert">
      <AlertIcon width={16} height={16} />
      <div className={styles.errorBody}>
        <p className={styles.errorSummary}>{summary}</p>
        {next && <p className={styles.errorNext}>{next}</p>}
        {details && (
          <>
            <button
              type="button"
              className={styles.inlineButton}
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen(!open)}
            >
              {open ? "Hide details" : "Show details"}
            </button>
            <pre id={id} className={styles.errorDetails} hidden={!open}>
              {details}
            </pre>
          </>
        )}
        {children}
      </div>
    </div>
  );
}
