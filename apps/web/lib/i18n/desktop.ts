// The desktop app's own words, before and around the page: its loading screen and its dialogs.
// Nothing here imports anything: the app reads it before the page's server is up.
import type { Locale } from "./locale.ts";

const en = {
  starting: (name: string) => `Starting ${name}…`,
  stopped: (name: string) => `${name} stopped`,
  stoppedDetail: (code: number | null, log: string) =>
    `The editor's server stopped unexpectedly (exit code ${code}). Its output is in ${log}.`,
  notStarted: (name: string) => `${name} could not start`,
};

export type DesktopMessages = typeof en;

export const DESKTOP: Record<Locale, DesktopMessages> = {
  en,
  "zh-TW": {
    starting: (name) => `${name} 啟動中…`,
    stopped: (name) => `${name} 已停止`,
    stoppedDetail: (code, log) => `編輯器的伺服器意外停止（結束代碼 ${code}）。輸出紀錄在 ${log}。`,
    notStarted: (name) => `${name} 無法啟動`,
  },
};
