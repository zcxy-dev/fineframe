import { Fragment, type ReactNode } from "react";
import { lastTwo } from "../lib/english.ts";
import type { Locale } from "../lib/site.ts";
import { phrases } from "../lib/typeset.ts";

// `[label](href)` a link, `[[text]]` a placeholder, `**text**` strong and `` `text` `` code.
const TOKEN = /\[\[(.+?)\]\]|\[(.+?)\]\((.+?)\)|\*\*(.+?)\*\*|`(.+?)`/g;

/**
 * Chinese set in phrases a line breaks only between; English with its last two words kept
 * together unless the text goes on after it (`end` false).
 */
export function Phrases({
  text,
  locale,
  end = true,
}: {
  text: string;
  locale: Locale;
  end?: boolean;
}): ReactNode {
  if (locale !== "zh-tw") return end ? lastTwo(text) : text;
  // A phrase's trailing space stays outside it, where a line may break: WebKit draws a
  // no-wrap phrase twice when it ends in a space before a `<wbr>`.
  return phrases(text).map((phrase, i, all) => {
    const core = phrase.trimEnd();
    const space = phrase.slice(core.length);
    return (
      <Fragment key={`${i}${phrase}`}>
        {i > 0 && !all[i - 1]?.endsWith(" ") && <wbr />}
        <span className="w">{core}</span>
        {space}
      </Fragment>
    );
  });
}

/**
 * A line of text from the content files, with its links, placeholders, emphasis and code,
 * set so that Chinese breaks only between phrases and English never ends on one word.
 */
export function Rich({ text, locale }: { text: string; locale: Locale }): ReactNode {
  const parts: ReactNode[] = [];
  const matches = [...text.matchAll(TOKEN)];
  let last = 0;
  for (const [n, match] of matches.entries()) {
    const [whole, placeholder, label, target, strong, code] = match;
    let before = text.slice(last, match.index);
    // A link or emphasis that ends the text, but for a mark, keeps its last two words
    // together, or its one word with the word before.
    const ending =
      n === matches.length - 1 &&
      text.length - (match.index + whole.length) <= 2 &&
      locale === "en";
    const inner = label ?? strong;
    let shown = inner;
    if (ending && inner) {
      if (inner.includes(" ")) shown = inner.replace(/ (?=\S+$)/, "\u00a0");
      else before = before.replace(/ $/, "\u00a0");
    }
    if (before) parts.push(<Phrases key={`t${last}`} text={before} locale={locale} end={false} />);
    const key = match.index;
    if (placeholder) {
      parts.push(
        <span key={key} className="rounded-md border border-dashed border-ink-3 px-1.5 py-px">
          {placeholder}
        </span>,
      );
    } else if (label && target) {
      // Paths inside the site are written without the locale, which is added here.
      const external = /^(https?|mailto):/.test(target);
      parts.push(
        <a key={key} href={external ? target : `/${locale}${target}`}>
          <Phrases text={shown ?? label} locale={locale} end={false} />
        </a>,
      );
    } else if (strong) {
      parts.push(
        <strong key={key}>
          <Phrases text={shown ?? strong} locale={locale} end={false} />
        </strong>,
      );
    } else if (code) {
      // A command is set whole, may start a line, and keeps the mark after it.
      const mark = /^[^\s\w]{1,2}$/.test(text.slice(match.index + whole.length))
        ? text.slice(match.index + whole.length)
        : "";
      parts.push(
        <Fragment key={key}>
          <wbr />
          <span className="w">
            <code>{code}</code>
            {mark}
          </span>
        </Fragment>,
      );
      last = match.index + whole.length + mark.length;
      continue;
    }
    last = match.index + whole.length;
  }
  const rest = text.slice(last);
  if (rest) parts.push(<Phrases key="end" text={rest} locale={locale} />);
  return parts;
}
