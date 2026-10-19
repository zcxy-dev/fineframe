"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ErrorNote } from "./ErrorNote.tsx";
import styles from "./editor.module.css";
import { useT } from "./I18n.tsx";
import { LockIcon } from "./icons.tsx";

/** Where to get each service's key, and the name the dialog calls it by; the rest is in each
 * language's words. */
const SITES = {
  anthropic: {
    link: "https://console.anthropic.com/settings/keys",
    site: "console.anthropic.com",
    name: "Anthropic",
  },
  openrouter: {
    link: "https://openrouter.ai/settings/keys",
    site: "openrouter.ai",
    name: "OpenRouter",
  },
  pexels: { link: "https://www.pexels.com/api/", site: "pexels.com/api", name: "Pexels" },
  pixabay: { link: "https://pixabay.com/api/docs/", site: "pixabay.com/api/docs", name: "Pixabay" },
} as const;

interface Props {
  /** Whose key it asks for. */
  service: keyof typeof SITES;
  open: boolean;
  /** Whether a key is saved already, so this one replaces it. */
  replacing: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Asks for an API key, has the server check it with its service, and saves it there. The page
 * never gets the key back. */
export function KeyDialog({ service, open, replacing, onClose, onSaved }: Props) {
  const t = useT();
  const words = t.keys;
  const text = { ...SITES[service], ...words[service] };
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
        body: JSON.stringify({ key, service }),
      });
      const reply = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(reply.error ?? words.notSaved);
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
          {replacing ? words.replace(text.name) : text.title}
        </h2>
        <p className={styles.dialogText}>
          {text.about}{" "}
          <a href={text.link} target="_blank" rel="noreferrer">
            {text.site}
          </a>
          {text.end}
        </p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-key`}>
            {words.key}
          </label>
          <input
            id={`${id}-key`}
            className={styles.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={text.placeholder}
            value={key}
            aria-invalid={state.error !== undefined}
            autoFocus
            onChange={(event) => setKey(event.target.value)}
          />
        </div>
        {state.error && <ErrorNote message={state.error} fallback={words.fallback} />}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.button} onClick={() => dialog.current?.close()}>
            {replacing ? words.cancel : words.later}
          </button>
          <button
            type="submit"
            className={`${styles.primary} ${styles.dialogPrimary}`}
            disabled={state.checking || key.trim() === ""}
          >
            {state.checking ? words.checking(text.name) : words.save}
          </button>
        </div>
        <p className={styles.note}>
          <LockIcon width={14} height={14} />
          <span>{words.stored(text.name)}</span>
        </p>
      </form>
    </dialog>
  );
}
