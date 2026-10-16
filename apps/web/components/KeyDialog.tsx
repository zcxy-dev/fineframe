"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./editor.module.css";
import { AlertIcon, LockIcon } from "./icons.tsx";

interface Props {
  open: boolean;
  /** Whether a key is saved already, so this one replaces it. */
  replacing: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Asks for the Anthropic API key, has the server check it with Anthropic, and saves it there.
 * The page never gets the key back. */
export function KeyDialog({ open, replacing, onClose, onSaved }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState("");
  const [state, setState] = useState<{ checking: boolean; error?: string }>({ checking: false });

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const save = async () => {
    setState({ checking: true });
    try {
      const response = await fetch("/api/key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const reply = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(reply.error ?? "The key could not be saved");
      setKey("");
      setState({ checking: false });
      onSaved();
    } catch (error) {
      setState({ checking: false, error: (error as Error).message });
    }
  };

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      onClose={() => {
        setKey("");
        setState({ checking: false });
        onClose();
      }}
    >
      <form
        className={styles.dialogBody}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id={`${id}-title`} className={styles.panelTitle}>
          {replacing ? "Replace your API key" : "Connect Claude"}
        </h2>
        <p className={styles.dialogText}>
          Claude plans each edit and checks its cuts with your Anthropic API key, billed to your
          Anthropic account. Create one at{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            console.anthropic.com
          </a>
          .
        </p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-key`}>
            API key
          </label>
          <input
            id={`${id}-key`}
            className={styles.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={key}
            aria-invalid={state.error !== undefined}
            autoFocus
            onChange={(event) => setKey(event.target.value)}
          />
        </div>
        {state.error && (
          <p className={styles.error} role="alert">
            <AlertIcon width={16} height={16} />
            {state.error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.button} onClick={() => dialog.current?.close()}>
            {replacing ? "Cancel" : "Later"}
          </button>
          <button
            type="submit"
            className={`${styles.primary} ${styles.dialogPrimary}`}
            disabled={state.checking || key.trim() === ""}
          >
            {state.checking ? "Checking with Anthropic…" : "Check and save"}
          </button>
        </div>
        <p className={styles.note}>
          <LockIcon width={14} height={14} />
          <span>
            Saved on this computer in the repository's .env, readable only by your user. It is sent
            to Anthropic and nowhere else, and this page never shows it again.
          </span>
        </p>
      </form>
    </dialog>
  );
}
