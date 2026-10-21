// The desktop app: the page's server on a free loopback port, the page in the app's own window,
// and everything the server started stopped when the app quits. Its menu installs the `fineframe`
// command and the agent skill.
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
  nativeTheme,
  session,
  shell,
} from "electron";
import {
  installCommand,
  installSkill,
  repointLauncher,
  skillFolders,
  type Target,
} from "./install.ts";
import { type Places, type Server, startServer } from "./server.ts";

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

/** The app's words in the page's language: the one chosen on the page, whose cookie the page's
 * server shares on any port, or else the system's, which the page is told as well. */
async function words() {
  const languages = app.getPreferredSystemLanguages();
  const { defaultSession } = session;
  defaultSession.setUserAgent(defaultSession.getUserAgent(), languages.join(","));
  const [saved] = await defaultSession.cookies
    .get({ url: "http://127.0.0.1", name: LOCALE_COOKIE })
    .catch(() => []);
  return DESKTOP[resolveLocale(saved ? `${saved.name}=${saved.value}` : null, languages)];
}

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

/** A message over the window, or alone when there is none; the button chosen. */
async function show(options: MessageBoxOptions): Promise<number> {
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return response;
}

/** Asks before replacing what is at `path`, which the app did not install. */
const confirmReplace = (t: Words) => async (path: string) =>
  (await show({
    type: "question",
    message: t.replace(path),
    detail: t.replaceDetail,
    buttons: [t.replaceButton, t.cancel],
    defaultId: 1,
    cancelId: 1,
  })) === 0;

async function installCommandFromMenu(t: Words): Promise<void> {
  try {
    const installed = await installCommand(target(), {
      confirm: confirmReplace(t),
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

async function installSkillFromMenu(t: Words): Promise<void> {
  try {
    const skill = join(places().editor, "skills", "video-editor");
    const installed: string[] = [];
    const kept: string[] = [];
    for (const folder of skillFolders(homedir())) {
      ((await installSkill(skill, folder, confirmReplace(t))) ? installed : kept).push(folder);
    }
    await show({ type: "info", message: t.skillInstalled, detail: t.skillDetail(installed, kept) });
  } catch (error) {
    dialog.showErrorBox(t.notInstalled, (error as Error).message);
  }
}

/** The two install items, first in the app's menu on macOS (after About) and in File elsewhere;
 * the command only from an installed app, whose resources it runs. */
function addInstallItems(t: Words): void {
  const menu = Menu.getApplicationMenu();
  const first = menu?.items[0]?.submenu;
  if (!menu || !first) return;
  let at = process.platform === "darwin" ? 2 : 0;
  const add = (item: MenuItem) => first.insert(at++, item);
  if (app.isPackaged) {
    add(
      new MenuItem({
        id: "install-command",
        label: t.installCommand,
        click: () => void installCommandFromMenu(t),
      }),
    );
  }
  add(
    new MenuItem({
      id: "install-skill",
      label: t.installSkill,
      click: () => void installSkillFromMenu(t),
    }),
  );
  add(new MenuItem({ type: "separator" }));
  Menu.setApplicationMenu(menu);
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
    // The page's own background, dark unless the system is light.
    backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.on("closed", () => {
    window = null;
  });
  const t = await words();
  addInstallItems(t);
  // An installed command follows the app when it moves, or to a newer AppImage.
  if (app.isPackaged) {
    void repointLauncher(target()).catch((error: Error) =>
      console.error(`Could not update the fineframe command: ${error.message}`),
    );
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
    await window.loadURL(server.url);
  } catch (error) {
    if (stopping) return;
    dialog.showErrorBox(t.notStarted(NAME), (error as Error).message);
    app.quit();
  }
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

/** The window while the page's server starts, saying `text`. */
const startingPage = (
  text: string,
) => `<!doctype html><html><head><meta charset="utf-8"><title>${NAME}</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;
color:#a1a1aa;background:${BACKGROUND.dark}}
@media (prefers-color-scheme:light){body{color:#52525b;background:${BACKGROUND.light}}}</style></head>
<body>${text}</body></html>`;
