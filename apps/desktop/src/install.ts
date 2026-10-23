// What the app's menu installs: the `fineframe` command, which runs cli.ts with the app's own
// binary as Node, and the agent skill, copied into Claude Code's and Codex's skills folders and
// updated with the app. Only Node's own modules, so it is tested without Electron.
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";

/** The app as the command starts it. */
export interface Target {
  /** The app's executable, or on Linux the AppImage, which mounts the rest only while it runs. */
  program: string;
  /** The app's own folder for the user (Places.data); the launcher is in its bin/. */
  data: string;
}

/** Imports cli.ts from the app's resources, wherever the system mounted them. */
const BOOT =
  "import(require('url').pathToFileURL(require('path').join(process.resourcesPath,'app.asar','src','cli.ts')).href)";

/**
 * The AppImage's own start script puts --no-sandbox first unless the arguments have it, and Node
 * refuses it there: on Linux it goes after the "--", where cli.ts takes it off again.
 */
export const NO_SANDBOX = "--no-sandbox";

const MOVED = "the Fineframe app is not at";
const AGAIN = "Install it or open it once, and it sets this command up again.";

/** `text` as one word for sh, inside single quotes. */
const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
/** `text` in a .cmd file, where cmd.exe expands `%…%` even inside quotes. */
const cmdText = (text: string) => text.replaceAll("%", "%%");
/** `text` as cmd.exe's echo prints it unquoted: its command separators and redirections too. */
const cmdEcho = (text: string) => cmdText(text).replace(/[\^&|<>()]/g, "^$&");

/**
 * The launcher: it says so if the app is gone, and otherwise runs the app's binary as Node on
 * cli.ts, passing its arguments on as they are. A .cmd on Windows, a shell script elsewhere.
 */
export function launcher(target: Target, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return `${[
      "@echo off",
      "rem Fineframe's command line. The Fineframe app wrote this, and writes it again when it moves.",
      `if exist "${cmdText(target.program)}" goto run`,
      `echo ${cmdEcho(`fineframe: ${MOVED} ${target.program}. ${AGAIN}`)} 1>&2`,
      "exit /b 1",
      ":run",
      "setlocal",
      `set "VIDEO_EDITOR_DATA=${cmdText(target.data)}"`,
      "set ELECTRON_RUN_AS_NODE=1",
      `"${cmdText(target.program)}" -e "${BOOT}" -- %*`,
      "exit /b %ERRORLEVEL%",
    ].join("\r\n")}\r\n`;
  }
  return `${[
    "#!/bin/sh",
    "# Fineframe's command line. The Fineframe app wrote this, and writes it again when it moves.",
    `app=${shellQuote(target.program)}`,
    'if [ ! -x "$app" ]; then',
    `  echo "fineframe: ${MOVED} $app. ${AGAIN}" >&2`,
    "  exit 1",
    "fi",
    `VIDEO_EDITOR_DATA=${shellQuote(target.data)} ELECTRON_RUN_AS_NODE=1 exec "$app" -e "${BOOT}" -- ${platform === "linux" ? `${NO_SANDBOX} ` : ""}"$@"`,
  ].join("\n")}\n`;
}

/** Where the launcher is: in the app's folder, which the command on PATH points at. */
export const launcherPath = (data: string, platform: NodeJS.Platform = process.platform) =>
  join(data, "bin", platform === "win32" ? "fineframe.cmd" : "fineframe");

async function writeLauncher(target: Target, platform: NodeJS.Platform): Promise<string> {
  const path = launcherPath(target.data, platform);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, launcher(target, platform));
  await chmod(path, 0o755);
  return path;
}

/**
 * Writes the launcher again when it was installed and points elsewhere: the app moved, or a newer
 * AppImage was opened. Returns whether it did.
 */
export async function repointLauncher(
  target: Target,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const current = await readFile(launcherPath(target.data, platform), "utf8").catch(() => null);
  if (current === null || current === launcher(target, platform)) return false;
  await writeLauncher(target, platform);
  return true;
}

export interface Installed {
  /** The command: a link on PATH to the launcher, or on Windows the launcher in a folder on Path. */
  path: string;
  /** What removes it on macOS and Linux; on Windows, null: its folder leaves Path in the settings. */
  remove: string | null;
  /** The folder to add to PATH for a new terminal to find it, when ~/.local/bin is not on it. */
  offPath: string | null;
}

const same = (a: string, b: string, platform: NodeJS.Platform) =>
  platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
const onPath = (folder: string, path: string | undefined, platform: NodeJS.Platform) =>
  (path ?? "").split(delimiter).some((entry) => entry !== "" && same(entry, folder, platform));

/** Adds `folder` to the user's own Path, keeping the rest as it is, and tells Windows it changed. */
function addToUserPath(folder: string): void {
  const script = [
    "$folder = $env:FINEFRAME_FOLDER",
    "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
    "$path = $key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')",
    "$entries = @($path -split ';' | Where-Object { $_ })",
    "if (-not ($entries | Where-Object { $_.TrimEnd('\\') -ieq $folder.TrimEnd('\\') })) {",
    "  $key.SetValue('Path', (($entries + $folder) -join ';'), 'ExpandString')",
    "}",
    "$key.Close()",
    // Explorer, and the terminals it opens next, read Path again on this message.
    `Add-Type -Namespace Fineframe -Name Native -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'`,
    "$result = [UIntPtr]::Zero",
    "[void][Fineframe.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)",
  ].join("\n");
  const run = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, FINEFRAME_FOLDER: folder },
    encoding: "utf8",
    windowsHide: true,
  });
  if (run.status !== 0) throw new Error(`Could not add ${folder} to Path: ${run.stderr.trim()}`);
}

/** Links /usr/local/bin/fineframe to `script` with macOS's administrator prompt; false if declined. */
function linkAsAdministrator(script: string): boolean {
  const run = spawnSync(
    "osascript",
    [
      "-e",
      "on run argv",
      "-e",
      'do shell script "mkdir -p /usr/local/bin && ln -sfn " & quoted form of (item 1 of argv) & " /usr/local/bin/fineframe" with administrator privileges',
      "-e",
      "end run",
      script,
    ],
    { encoding: "utf8" },
  );
  if (run.status === 0) return true;
  // -128: the person cancelled the prompt.
  if (run.stderr.includes("-128")) return false;
  throw new Error(run.stderr.trim());
}

const denied = (error: unknown) =>
  ["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "");

/**
 * Installs the `fineframe` command, or updates it in place:
 * - Linux: a link in ~/.local/bin to the launcher;
 * - macOS: the same in ~/.local/bin when that is on PATH, or else in /usr/local/bin, which every
 *   macOS shell has on PATH (from /etc/paths), with the administrator's prompt only when the
 *   folder is not writable. The link stays put when the app moves: the launcher changes;
 * - Windows: the launcher's own folder, added to the user's Path.
 * Replaces anything else at the link's place only when `confirm` says so; null if not installed.
 */
export async function installCommand(
  target: Target,
  options: {
    confirm: (path: string) => Promise<boolean>;
    home: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  },
): Promise<Installed | null> {
  const { confirm, home, env = process.env, platform = process.platform } = options;
  const script = await writeLauncher(target, platform);
  if (platform === "win32") {
    addToUserPath(dirname(script));
    return { path: script, remove: null, offPath: null };
  }
  const local = join(home, ".local", "bin");
  const folder =
    platform === "darwin" && !onPath(local, env.PATH, platform) ? "/usr/local/bin" : local;
  const link = join(folder, "fineframe");
  const there = await lstat(link).catch(() => null);
  const ours = there?.isSymbolicLink() && (await readlink(link)) === script;
  const result = async (): Promise<Installed> => {
    const writable = await access(folder, constants.W_OK).then(
      () => true,
      () => false,
    );
    return {
      path: link,
      remove: `${writable ? "" : "sudo "}rm ${shellQuote(link)}`,
      offPath: folder === local && !onPath(local, env.PATH, platform) ? local : null,
    };
  };
  if (ours) return result();
  if (there && !(await confirm(link))) return null;
  try {
    await mkdir(folder, { recursive: true });
    await rm(link, { force: true });
    await symlink(script, link);
  } catch (error) {
    if (folder !== "/usr/local/bin" || !denied(error)) throw error;
    if (!linkAsAdministrator(script)) return null;
  }
  return result();
}

/** Where the skill goes: Claude Code's skills folder and the one Codex reads. */
export const skillFolders = (home: string) => [
  join(home, ".claude", "skills", "video-editor"),
  join(home, ".agents", "skills", "video-editor"),
];

/** A file in each copy the app installed, which it replaces without asking. */
const MARK = ".installed-by-fineframe";

/** Whether `to` is a copy the app installed: a folder with MARK in it, never a link. */
async function ours(to: string): Promise<boolean> {
  const there = await lstat(to).catch(() => null);
  return (
    !!there?.isDirectory() &&
    (await access(join(to, MARK)).then(
      () => true,
      () => false,
    ))
  );
}

/** The files under `folder`, by their path in it. */
async function filesIn(folder: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const name of await readdir(folder, { recursive: true })) {
    const path = join(folder, name);
    if ((await stat(path)).isFile()) files.set(name, await readFile(path));
  }
  return files;
}

/**
 * The skill as the app installs it, by path: the editor's `skills/video-editor`, and beside it the
 * editor's own files it names (`packages/…`), so an agent reads those of the version it runs.
 */
async function skillFiles(editor: string): Promise<Map<string, Buffer>> {
  const files = await filesIn(join(editor, "skills", "video-editor"));
  for (const [name, content] of [...files]) {
    if (!name.endsWith(".md")) continue;
    for (const [, named = ""] of content
      .toString("utf8")
      .matchAll(/`(packages\/[\w./-]+\.\w+)`/g)) {
      const path = join(...named.split("/"));
      files.set(path, await readFile(join(editor, path)));
    }
  }
  return files;
}

async function writeSkill(to: string, files: Map<string, Buffer>): Promise<void> {
  for (const [name, content] of files) {
    await mkdir(dirname(join(to, name)), { recursive: true });
    await writeFile(join(to, name), content);
  }
  await writeFile(
    join(to, MARK),
    "Installed by the Fineframe app, which installs the skill again over this folder when it is updated or from its menu.\n",
  );
}

/**
 * Copies the skill of the editor in `editor` to `to`, over a copy the app installed, or over
 * anything else there only when `confirm` says so. A link there goes, never what it points at.
 * Returns whether it was installed.
 */
export async function installSkill(
  editor: string,
  to: string,
  confirm: (path: string) => Promise<boolean>,
): Promise<boolean> {
  const files = await skillFiles(editor);
  if (await lstat(to).catch(() => null)) {
    if (!(await ours(to)) && !(await confirm(to))) return false;
    await rm(to, { recursive: true, force: true });
  }
  await writeSkill(to, files);
  return true;
}

/**
 * Installs the skill again over a copy the app installed that differs from the editor's, as after
 * the app updated; leaves anything else at `to` as it is. Returns whether it did.
 */
export async function refreshSkill(editor: string, to: string): Promise<boolean> {
  if (!(await ours(to))) return false;
  const files = await skillFiles(editor);
  const installed = await filesIn(to);
  installed.delete(MARK);
  const same =
    installed.size === files.size &&
    [...files].every(([name, content]) => installed.get(name)?.equals(content));
  if (same) return false;
  await rm(to, { recursive: true, force: true });
  await writeSkill(to, files);
  return true;
}
