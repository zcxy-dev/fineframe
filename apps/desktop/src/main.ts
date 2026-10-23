// The desktop app: the page's server on a free loopback port, the page in the app's own window,
// and everything the server started stopped when the app quits. Its menu, in the page's language,
// installs the `fineframe` command and the agent skill, and signs out of the account the page signs
// in. An installed app updates itself (updates.ts), and the command and skill it installed with it.
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  MenuItem,
  type MessageBoxOptions,
  session,
  shell,
} from "electron";
import {
  installCommand,
  installSkill,
  refreshSkill,
  repointLauncher,
  skillFolders,
  type Target,
} from "./install.ts";
import { accountFile, type Places, type Server, startServer } from "./server.ts";
import { type Notice, watchUpdates } from "./updates.ts";

const NAME = "Fineframe";
app.setName(NAME);

/** Packaged, the editor and uv are in the app's resources; from a clone, the repository is the
 * editor and uv comes from PATH. */
function places(): Places {
  const packaged = app.isPackaged;
  return {
    editor: packaged
      ? join(process.resourcesPath, "editor")
      : fileURLToPath(new URL("../../../", import.meta.url)),
    bin: packaged ? join(process.resourcesPath, "bin") : null,
    data: app.getPath("userData"),
    log: join(app.getPath("logs"), "server.log"),
  };
}

// The page's background and the app's own words, from the editor's own copy of the page.
const web = (path: string) => pathToFileURL(join(places().editor, "apps", "web", "lib", path)).href;
const { BACKGROUND }: typeof import("../../web/lib/theme.ts") = await import(web("theme.ts"));
const { DESKTOP }: typeof import("../../web/lib/i18n/desktop.ts") = await import(
  web("i18n/desktop.ts")
);
const { LOCALE_COOKIE, resolveLocale }: typeof import("../../web/lib/i18n/locale.ts") =
  await import(web("i18n/locale.ts"));
const { signOut }: typeof import("../../web/lib/account.ts") = await import(web("account.ts"));

/** The app's words in the page's language: the one chosen on the page, whose cookie the page's
 * server shares on any port, or else the system's, which the page is told as well. */
async function words() {
  const languages = app.getPreferredSystemLanguages();
  const { defaultSession } = session;
  defaultSession.setUserAgent(defaultSession.getUserAgent(), languages.join(","));
  const [saved] = await defaultSession.cookies
    .get({ url: "http://127.0.0.1", name: LOCALE_COOKIE })
    .catch(() => []);
  return wordsFor(saved ?? null, languages);
}

const wordsFor = (cookie: Electron.Cookie | null, languages: string[]) =>
  DESKTOP[resolveLocale(cookie ? `${cookie.name}=${cookie.value}` : null, languages)];

let starting: Promise<Server> | null = null;
let window: BrowserWindow | null = null;
let stopping: Promise<void> | null = null;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  void app.whenReady().then(open);
}

/** The app as the `fineframe` command starts it: on Linux the AppImage, wherever it is now. */
const target = (): Target => ({
  program: process.env.APPIMAGE ?? process.execPath,
  data: app.getPath("userData"),
});

type Words = Awaited<ReturnType<typeof words>>;
/** The app's words now: the page's language changes them while the app runs. */
let t: Words;

/** A message over the window, or alone when there is none; the button chosen. */
async function show(options: MessageBoxOptions): Promise<number> {
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return response;
}

/** Asks before replacing what is at `path`, which the app did not install. */
const confirmReplace = async (path: string) =>
  (await show({
    type: "question",
    message: t.replace(path),
    detail: t.replaceDetail,
    buttons: [t.replaceButton, t.cancel],
    defaultId: 1,
    cancelId: 1,
  })) === 0;

async function installCommandFromMenu(): Promise<void> {
  try {
    const installed = await installCommand(target(), {
      confirm: confirmReplace,
      home: homedir(),
    });
    if (!installed) return;
    await show({
      type: "info",
      message: t.commandInstalled,
      detail: t.commandDetail(installed.path, installed.remove, installed.offPath),
    });
  } catch (error) {
    dialog.showErrorBox(t.notInstalled, (error as Error).message);
  }
}

async function installSkillFromMenu(): Promise<void> {
  try {
    const installed: string[] = [];
    const kept: string[] = [];
    for (const folder of skillFolders(homedir())) {
      ((await installSkill(places().editor, folder, confirmReplace)) ? installed : kept).push(
        folder,
      );
    }
    await show({ type: "info", message: t.skillInstalled, detail: t.skillDetail(installed, kept) });
  } catch (error) {
    dialog.showErrorBox(t.notInstalled, (error as Error).message);
  }
}

/** Signs out of the account, then shows the page again, which asks to sign in. */
async function signOutFromMenu(): Promise<void> {
  await signOut(accountFile(places()));
  if (window && !window.webContents.getURL().startsWith("data:")) window.webContents.reload();
}

/** The system's menu as it was, before the app's own items went in. */
let systemMenu: Menu | null = null;

/** The two install items and signing out, first in the app's menu on macOS (after About) and in
 * File elsewhere, in the app's words now; the command only from an installed app, whose
 * resources it runs. Set again, from the system's menu, when the words change. */
function setMenu(): void {
  systemMenu ??= Menu.getApplicationMenu();
  const [top, ...rest] = systemMenu?.items ?? [];
  if (!top?.submenu) return;
  const ours = [
    ...(app.isPackaged
      ? [
          new MenuItem({
            id: "install-command",
            label: t.installCommand,
            click: () => void installCommandFromMenu(),
          }),
        ]
      : []),
    new MenuItem({
      id: "install-skill",
      label: t.installSkill,
      click: () => void installSkillFromMenu(),
    }),
    new MenuItem({ type: "separator" }),
    new MenuItem({ id: "sign-out", label: t.signOut, click: () => void signOutFromMenu() }),
    new MenuItem({ type: "separator" }),
  ];
  const items = [...top.submenu.items];
  items.splice(process.platform === "darwin" ? 2 : 0, 0, ...ours);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ label: top.label, submenu: Menu.buildFromTemplate(items) }, ...rest]),
  );
}

/** The menu and the dialogs follow the page when it switches language. */
function followLanguage(): void {
  session.defaultSession.cookies.on("changed", (_event, cookie, _cause, removed) => {
    if (cookie.name !== LOCALE_COOKIE || removed) return;
    t = wordsFor(cookie, app.getPreferredSystemLanguages());
    setMenu();
  });
}

async function open(): Promise<void> {
  window = new BrowserWindow({
    title: NAME,
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 600,
    // Linux takes the window's icon from the window itself; macOS and Windows from the app's.
    icon:
      process.platform === "linux"
        ? fileURLToPath(new URL("../assets/icons/512x512.png", import.meta.url))
        : undefined,
    // The page's own background.
    backgroundColor: BACKGROUND,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.on("closed", () => {
    window = null;
  });
  t = await words();
  setMenu();
  followLanguage();
  if (app.isPackaged) {
    // An installed command follows the app when it moves, or to a newer AppImage.
    void repointLauncher(target()).catch((error: Error) =>
      console.error(`Could not update the fineframe command: ${error.message}`),
    );
    // An installed skill follows the app's updates.
    for (const folder of skillFolders(homedir())) {
      void refreshSkill(places().editor, folder).catch((error: Error) =>
        console.error(`Could not update the agent skill in ${folder}: ${error.message}`),
      );
    }
  }
  void window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(startingPage(t.starting(NAME)))}`,
  );
  try {
    const where = places();
    starting = startServer(where, process.execPath);
    const server = await starting;
    console.log(`${NAME} is serving ${server.url}`);
    // Quit while it started.
    if (stopping || !window) return;
    void server.exited.then((code) => {
      if (stopping) return;
      dialog.showErrorBox(t.stopped(NAME), t.stoppedDetail(code, where.log));
      app.quit();
    });
    keepToPage(window, server.url);
    if (app.isPackaged) await update(window);
    await window.loadURL(server.url);
  } catch (error) {
    if (stopping) return;
    dialog.showErrorBox(t.notStarted(NAME), (error as Error).message);
    app.quit();
  }
}

/** The page's address that restarts the app into a downloaded update (components/UpdateNotice). */
const RESTART = "fineframe:restart";

/**
 * Checks for updates, and tells the page of one: as `window.fineframeUpdate` with an event, again
 * after each load. Going to RESTART installs a downloaded one and opens it.
 */
async function update(window: BrowserWindow): Promise<void> {
  const { autoUpdater } = (await import("electron-updater")).default;
  let notice: Notice | null = null;
  const tell = () => {
    if (!notice || window.isDestroyed()) return;
    void window.webContents
      .executeJavaScript(
        `window.fineframeUpdate = ${JSON.stringify(notice)}; window.dispatchEvent(new Event("fineframe:update"));`,
      )
      .catch(() => {});
  };
  window.webContents.on("did-finish-load", tell);
  window.webContents.on("will-navigate", (event, target) => {
    if (target !== RESTART || notice?.kind !== "ready") return;
    event.preventDefault();
    // The updated app starts before this one has quit: it must not hand over to this one.
    app.releaseSingleInstanceLock();
    autoUpdater.quitAndInstall();
  });
  watchUpdates(autoUpdater, process.platform, (found) => {
    notice = found;
    tell();
  });
}

/** The window shows only the editor's page: links elsewhere open in the system's browser. */
function keepToPage(window: BrowserWindow, url: string): void {
  const own = (target: string) => URL.parse(target)?.origin === new URL(url).origin;
  const external = (target: string) => {
    if (/^https?:/.test(target)) void shell.openExternal(target);
  };
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!own(target)) external(target);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (own(target)) return;
    event.preventDefault();
    external(target);
  });
}

app.on("window-all-closed", () => app.quit());

// Quitting waits for the server and everything it started to stop, even while it starts.
app.on("before-quit", (event) => {
  if (!starting) return;
  event.preventDefault();
  stopping ??= starting
    .then(
      (server) => server.stop(),
      () => {},
    )
    .finally(() => {
      starting = null;
      app.quit();
    });
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => app.quit());

/** The window while the page's server starts: `text` in viewfinder corners over an amber line
 * running along a track, in the page's colours. */
const startingPage = (
  text: string,
) => `<!doctype html><html><head><meta charset="utf-8"><title>${NAME}</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:${BACKGROUND};color:#b4b9c1;
font:500 14px/1.5 system-ui,-apple-system,"Segoe UI","PingFang TC","Microsoft JhengHei",sans-serif}
main{display:grid;gap:16px;justify-items:center;padding:28px 44px;--c:rgb(255 255 255/.42);
background:linear-gradient(var(--c) 0 0) 0 0/14px 1.5px,linear-gradient(var(--c) 0 0) 0 0/1.5px 14px,
linear-gradient(var(--c) 0 0) 100% 0/14px 1.5px,linear-gradient(var(--c) 0 0) 100% 0/1.5px 14px,
linear-gradient(var(--c) 0 0) 0 100%/14px 1.5px,linear-gradient(var(--c) 0 0) 0 100%/1.5px 14px,
linear-gradient(var(--c) 0 0) 100% 100%/14px 1.5px,linear-gradient(var(--c) 0 0) 100% 100%/1.5px 14px;
background-repeat:no-repeat}
i{display:block;width:160px;height:2px;border-radius:1px;background:rgb(255 255 255/.08);overflow:hidden}
i::after{content:"";display:block;width:40%;height:100%;background:#ffb547;
animation:run 1.4s cubic-bezier(.16,1,.3,1) infinite}
@keyframes run{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){i::after{animation:none;width:100%;opacity:.5}}</style></head>
<body><main>${text}<i></i></main></body></html>`;
