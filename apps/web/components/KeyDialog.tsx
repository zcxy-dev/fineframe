"use client";

import { LockKeyhole } from "lucide-react";
import { useId, useState } from "react";
import { HELP, LABEL } from "../lib/styles.ts";
import { ErrorNote } from "./ErrorNote.tsx";
import { useT } from "./I18n.tsx";
import { Button } from "./ui/button.tsx";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";

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
  const [key, setKey] = useState("");
  const [state, setState] = useState<{ checking: boolean; error?: string }>({ checking: false });

  const close = () => {
    setKey("");
    setState({ checking: false });
    onClose();
  };

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
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        // Only "Later" or Escape closes it, as a click beside it may be a slip.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogTitle>{replacing ? words.replace(text.name) : text.title}</DialogTitle>
          <p className="text-[13px] leading-relaxed text-steel">
            {text.about}{" "}
            <a className="text-foreground" href={text.link} target="_blank" rel="noreferrer">
              {text.site}
            </a>
            {text.end}
          </p>
          <div className="flex flex-col gap-2">
            <label className={LABEL} htmlFor={`${id}-key`}>
              {words.key}
            </label>
            <Input
              id={`${id}-key`}
              className="h-10"
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
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={close}>
              {replacing ? words.cancel : words.later}
            </Button>
            <Button type="submit" className="flex-1" disabled={state.checking || key.trim() === ""}>
              {state.checking ? words.checking(text.name) : words.save}
            </Button>
          </div>
          <p className={`flex gap-2 border-t pt-4 ${HELP}`}>
            <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{words.stored(text.name)}</span>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
