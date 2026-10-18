"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ErrorNote } from "./ErrorNote.tsx";
import styles from "./editor.module.css";
import { LockIcon } from "./icons.tsx";

/** What the dialog says for each service's key. */
const TEXT = {
  anthropic: {
    title: "Connect Claude",
    about:
      "Claude plans each edit and checks its cuts with your Anthropic API key, billed to your Anthropic account. Create one at",
    link: "https://console.anthropic.com/settings/keys",
    site: "console.anthropic.com",
    placeholder: "sk-ant-…",
    name: "Anthropic",
  },
  openrouter: {
    title: "Connect OpenRouter",
    about:
      "OpenRouter hears the speech with your OpenRouter API key, billed to your OpenRouter account at about US$0.03 an hour of footage. Create one at",
    link: "https://openrouter.ai/settings/keys",
    site: "openrouter.ai",
    placeholder: "sk-or-…",
    name: "OpenRouter",
  },
  pexels: {
    title: "Connect Pexels",
    about:
      "Optional: with your free Pexels API key, Claude can show stock footage from Pexels in the edit. Without it, the edit shows cards and web pages instead. Get one at",
    link: "https://www.pexels.com/api/",
    site: "pexels.com/api",
    placeholder: "Pexels API key",
    name: "Pexels",
  },
  pixabay: {
    title: "Connect Pixabay",
    about:
      "Optional: with your free Pixabay API key, Claude can show stock footage from Pixabay in the edit. Without it, the edit shows cards and web pages instead. Get one at",
    link: "https://pixabay.com/api/docs/",
    site: "pixabay.com/api/docs",
    placeholder: "Pixabay API key",
    name: "Pixabay",
  },
} as const;

interface Props {
  /** Whose key it asks for. */
  service: keyof typeof TEXT;
  open: boolean;
  /** Whether a key is saved already, so this one replaces it. */
  replacing: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Asks for an API key, has the server check it with its service, and saves it there. The page
 * never gets the key back. */
export function KeyDialog({ service, open, replacing, onClose, onSaved }: Props) {
  const text = TEXT[service];
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
          {replacing ? `Replace your ${text.name} API key` : text.title}
        </h2>
        <p className={styles.dialogText}>
          {text.about}{" "}
          <a href={text.link} target="_blank" rel="noreferrer">
            {text.site}
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
            placeholder={text.placeholder}
            value={key}
            aria-invalid={state.error !== undefined}
            autoFocus
            onChange={(event) => setKey(event.target.value)}
          />
        </div>
        {state.error && (
          <ErrorNote message={state.error} fallback="The key could not be checked." />
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
            {state.checking ? `Checking with ${text.name}…` : "Check and save"}
          </button>
        </div>
        <p className={styles.note}>
          <LockIcon width={14} height={14} />
          <span>
            Saved on this computer in a file only your user can read. It is sent to {text.name} and
            nowhere else, and this page never shows it again.
          </span>
        </p>
      </form>
    </dialog>
  );
}
