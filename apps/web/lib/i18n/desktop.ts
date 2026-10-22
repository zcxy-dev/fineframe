// The desktop app's own words, before and around the page: its loading screen and its dialogs.
// Nothing here imports anything: the app reads it before the page's server is up.
import type { Locale } from "./locale.ts";

const en = {
  starting: (name: string) => `Starting ${name}…`,
  stopped: (name: string) => `${name} stopped`,
  stoppedDetail: (code: number | null, log: string) =>
    `The editor's server stopped unexpectedly (exit code ${code}). Its output is in ${log}.`,
  notStarted: (name: string) => `${name} could not start`,
  installCommand: "Install Command Line Tool…",
  installSkill: "Install Agent Skill…",
  commandInstalled: "The fineframe command is installed",
  commandDetail: (path: string, remove: string | null, offPath: string | null) =>
    [
      "fineframe edit and fineframe render now work in a new terminal, with the same options as pnpm edit and pnpm render, and the keys saved here.",
      offPath ? `${offPath} is not on PATH yet: add it to PATH in your shell's profile.` : "",
      `Installed at ${path}`,
      remove
        ? `To remove it: ${remove}`
        : "To remove it, delete it and take its folder out of Path in your account's environment variables.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  skillInstalled: "The agent skill is installed",
  skillDetail: (installed: string[], kept: string[]) =>
    [
      "Claude Code, Codex and other agents can now edit with Fineframe: start a new session and ask one to edit a folder of footage. The skill runs the fineframe command, which this menu installs too.",
      installed.length > 0 ? `Installed in:\n${installed.join("\n")}` : "",
      kept.length > 0 ? `Left as it was:\n${kept.join("\n")}` : "",
      "To remove it, delete those folders.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  replace: (path: string) => `${path} already exists`,
  replaceDetail: "Fineframe did not install it. Replace it with Fineframe's?",
  replaceButton: "Replace",
  cancel: "Cancel",
  notInstalled: "Could not install it",
  signOut: "Sign Out",
};

export type DesktopMessages = typeof en;

export const DESKTOP: Record<Locale, DesktopMessages> = {
  en,
  "zh-TW": {
    starting: (name) => `${name} 啟動中…`,
    stopped: (name) => `${name} 已停止`,
    stoppedDetail: (code, log) => `編輯器的伺服器意外停止（結束代碼 ${code}）。輸出紀錄在 ${log}。`,
    notStarted: (name) => `${name} 無法啟動`,
    installCommand: "安裝命令列工具…",
    installSkill: "安裝 Agent 技能…",
    commandInstalled: "fineframe 指令已安裝",
    commandDetail: (path, remove, offPath) =>
      [
        "現在可以在新的終端機視窗使用 fineframe edit 和 fineframe render，選項與 pnpm edit、pnpm render 相同，並使用這裡儲存的金鑰。",
        offPath ? `${offPath} 還不在 PATH 裡：請在 shell 的設定檔把它加入 PATH。` : "",
        `安裝位置：${path}`,
        remove
          ? `移除方式：${remove}`
          : "移除方式：刪除這個檔案，並在帳戶的環境變數中把它的資料夾從 Path 移除。",
      ]
        .filter(Boolean)
        .join("\n\n"),
    skillInstalled: "Agent 技能已安裝",
    skillDetail: (installed, kept) =>
      [
        "Claude Code、Codex 和其他 agent 現在可以用 Fineframe 剪片：開一個新的工作階段，請它剪一個素材資料夾。技能會執行 fineframe 指令，這個選單也能安裝它。",
        installed.length > 0 ? `已安裝到：\n${installed.join("\n")}` : "",
        kept.length > 0 ? `保留原樣：\n${kept.join("\n")}` : "",
        "移除方式：刪除這些資料夾。",
      ]
        .filter(Boolean)
        .join("\n\n"),
    replace: (path) => `${path} 已經存在`,
    replaceDetail: "這不是 Fineframe 安裝的。要換成 Fineframe 的嗎？",
    replaceButton: "取代",
    cancel: "取消",
    notInstalled: "無法安裝",
    signOut: "登出",
  },
};
