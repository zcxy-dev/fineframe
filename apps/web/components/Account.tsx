"use client";

import { useCallback, useEffect, useState } from "react";
import { HELP } from "../lib/styles.ts";
import { ErrorNote } from "./ErrorNote.tsx";
import { useT } from "./I18n.tsx";
import { Button } from "./ui/button.tsx";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog.tsx";

/** What /api/account says: in the desktop app, who is signed in and whether they may edit, with
 * the website's pricing and account pages; elsewhere, that edits need no account. */
export type Account =
  | { gated: false }
  | ({ gated: true; pricing: string; account: string } & (
      | { signedIn: false }
      | { signedIn: true; email: string; entitled: boolean; offline: boolean }
    ));

/** Whether `account` lets a new edit or plan start; null until known. */
export function mayEdit(account: Account | null): boolean | null {
  if (!account) return null;
  return !account.gated || (account.signedIn && account.entitled);
}

/** The account as the server last said, and a way to ask. */
export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const reload = useCallback(
    () =>
      fetch("/api/account")
        .then((response) => response.json() as Promise<Account>)
        .then((found) => {
          setAccount(found);
          return found;
        }),
    [],
  );
  return { account, setAccount, reload };
}

interface Props {
  account: Account | null;
  open: boolean;
  onClose: () => void;
  onChange: (account: Account) => void;
  reload: () => Promise<Account>;
}

const TEXT = "text-[13px] leading-relaxed text-steel";

/** Signs in through the website in the browser, says whether the account may edit with a link
 * to subscribe, and signs out. */
export function AccountDialog({ account, open, onClose, onChange, reload }: Props) {
  const t = useT();
  const words = t.account;
  const [waiting, setWaiting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Says what holds now, as the billing switch or the subscription may have changed.
  useEffect(() => {
    if (open) void reload().catch(() => {});
  }, [open, reload]);

  // Asks until the browser has come back signed in.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void reload()
        .then((found) => {
          if (found.gated && found.signedIn) setWaiting(false);
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  const signIn = async () => {
    setError(null);
    try {
      const response = await fetch("/api/account", { method: "POST" });
      const reply = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !reply.url) throw new Error(reply.error ?? words.notStarted);
      // The desktop app opens it in the system's browser.
      window.open(reply.url, "_blank", "noopener");
      setWaiting(true);
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  const checkAgain = async () => {
    setChecking(true);
    await reload().catch(() => {});
    setChecking(false);
  };

  const signOut = async () => {
    const response = await fetch("/api/account", { method: "DELETE" });
    if (response.ok) onChange((await response.json()) as Account);
  };

  const close = () => {
    setWaiting(false);
    setError(null);
    onClose();
  };
  const gated = account?.gated ? account : null;
  const signedIn = gated?.signedIn ? gated : null;

  return (
    <Dialog open={open && gated !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent onInteractOutside={(event) => event.preventDefault()}>
        {!signedIn ? (
          <>
            <DialogTitle>{words.signInTitle}</DialogTitle>
            <p className={TEXT}>{words.signInAbout}</p>
            {waiting && <p className={HELP}>{words.waiting}</p>}
            {error && <ErrorNote message={error} fallback={words.notStarted} />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={close}>
                {words.later}
              </Button>
              <Button type="button" className="flex-1" onClick={() => void signIn()}>
                {words.signIn}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogTitle>
              {signedIn.entitled
                ? words.signedInAs(signedIn.email)
                : signedIn.offline
                  ? words.offlineTitle
                  : words.subscribeTitle}
            </DialogTitle>
            {!signedIn.entitled && <p className={HELP}>{words.signedInAs(signedIn.email)}</p>}
            <p className={TEXT}>
              {signedIn.entitled
                ? signedIn.offline
                  ? words.offline
                  : words.entitled
                : signedIn.offline
                  ? words.offlineAbout
                  : words.subscribeAbout}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void signOut()}>
                {words.signOut}
              </Button>
              {signedIn.entitled ? (
                <Button asChild className="flex-1">
                  <a href={signedIn.account} target="_blank" rel="noreferrer">
                    {words.manage}
                  </a>
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={checking}
                    onClick={() => void checkAgain()}
                  >
                    {checking ? words.checking : words.checkAgain}
                  </Button>
                  {!signedIn.offline && (
                    <Button asChild className="flex-1">
                      <a href={signedIn.pricing} target="_blank" rel="noreferrer">
                        {words.subscribe}
                      </a>
                    </Button>
                  )}
                </>
              )}
            </div>
            <Button
              type="button"
              variant="link"
              size="inline"
              className="self-start"
              onClick={close}
            >
              {words.close}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
