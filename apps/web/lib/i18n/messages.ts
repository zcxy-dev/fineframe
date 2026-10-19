// Each language's words, and the one a request to the server asks for.
import { en, type Messages } from "./en.ts";
import { acceptedLanguages, type Locale, resolveLocale } from "./locale.ts";
import { zhTW } from "./zh-TW.ts";

export type { Messages };
export { en };

export const MESSAGES: Record<Locale, Messages> = { en, "zh-TW": zhTW };

/** The language a request asks for: the one its page saved, or else its browser's. */
export function localeOf(request: Request): Locale {
  return resolveLocale(
    request.headers.get("cookie"),
    acceptedLanguages(request.headers.get("accept-language")),
  );
}

/** The words for the language a request asks for. */
export function messagesOf(request: Request): Messages {
  return MESSAGES[localeOf(request)];
}
