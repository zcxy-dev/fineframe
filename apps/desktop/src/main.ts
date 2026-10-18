// The desktop app: the page's server on a free loopback port, the page in the app's own window,
// and everything the server started stopped when the app quits.
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, nativeTheme, shell } from "electron";
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

// The page's background, from the editor's own copy of the page.
const theme = pathToFileURL(join(places().editor, "apps", "web", "lib", "theme.ts")).href;
const { BACKGROUND }: typeof import("../../web/lib/theme.ts") = await import(theme);

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
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(STARTING)}`);
  try {
    const where = places();
    starting = startServer(where, process.execPath);
    const server = await starting;
    console.log(`${NAME} is serving ${server.url}`);
    // Quit while it started.
    if (stopping || !window) return;
    void server.exited.then((code) => {
      if (stopping) return;
      dialog.showErrorBox(
        `${NAME} stopped`,
        `The editor's server stopped unexpectedly (exit code ${code}). Its output is in ${where.log}.`,
      );
      app.quit();
    });
    keepToPage(window, server.url);
    await window.loadURL(server.url);
  } catch (error) {
    if (stopping) return;
    dialog.showErrorBox(`${NAME} could not start`, (error as Error).message);
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

const STARTING = `<!doctype html><html><head><meta charset="utf-8"><title>${NAME}</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;
color:#a1a1aa;background:${BACKGROUND.dark}}
@media (prefers-color-scheme:light){body{color:#52525b;background:${BACKGROUND.light}}}</style></head>
<body>Starting ${NAME}…</body></html>`;
