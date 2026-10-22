"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ErrorNote } from "./ErrorNote.tsx";
import styles from "./editor.module.css";
import { useT } from "./I18n.tsx";

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

/** Signs in through the website in the browser, says whether the account may edit with a link
 * to subscribe, and signs out. */
export function AccountDialog({ account, open, onClose, onChange, reload }: Props) {
  const t = useT();
  const words = t.account;
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [waiting, setWaiting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

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

  const close = () => dialog.current?.close();
  const signedIn = account?.gated && account.signedIn ? account : null;

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      onClose={() => {
        setWaiting(false);
        setError(null);
        onClose();
      }}
    >
      {account?.gated && (
        <div className={styles.dialogBody}>
          {!signedIn ? (
            <>
              <h2 id={`${id}-title`} className={styles.panelTitle}>
                {words.signInTitle}
              </h2>
              <p className={styles.dialogText}>{words.signInAbout}</p>
              {waiting && <p className={styles.help}>{words.waiting}</p>}
              {error && <ErrorNote message={error} fallback={words.notStarted} />}
              <div className={styles.dialogActions}>
                <button type="button" className={styles.button} onClick={close}>
                  {words.later}
                </button>
                <button
                  type="button"
                  className={`${styles.primary} ${styles.dialogPrimary}`}
                  onClick={() => void signIn()}
                >
                  {words.signIn}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 id={`${id}-title`} className={styles.panelTitle}>
                {signedIn.entitled
                  ? words.signedInAs(signedIn.email)
                  : signedIn.offline
                    ? words.offlineTitle
                    : words.subscribeTitle}
              </h2>
              {!signedIn.entitled && (
                <p className={styles.help}>{words.signedInAs(signedIn.email)}</p>
              )}
              <p className={styles.dialogText}>
                {signedIn.entitled
                  ? signedIn.offline
                    ? words.offline
                    : words.active
                  : signedIn.offline
                    ? words.offlineAbout
                    : words.subscribeAbout}
              </p>
              <div className={styles.dialogActions}>
                <button type="button" className={styles.button} onClick={() => void signOut()}>
                  {words.signOut}
                </button>
                {signedIn.entitled ? (
                  <a
                    className={`${styles.primary} ${styles.dialogPrimary}`}
                    href={account.account}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {words.manage}
                  </a>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={checking}
                      onClick={() => void checkAgain()}
                    >
                      {checking ? words.checking : words.checkAgain}
                    </button>
                    {!signedIn.offline && (
                      <a
                        className={`${styles.primary} ${styles.dialogPrimary}`}
                        href={account.pricing}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {words.subscribe}
                      </a>
                    )}
                  </>
                )}
              </div>
              <button type="button" className={styles.inlineButton} onClick={close}>
                {words.close}
              </button>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
