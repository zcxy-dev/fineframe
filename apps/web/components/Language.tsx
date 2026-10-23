"use client";

import { Check, ChevronDown, Globe } from "lucide-react";
import { LOCALE_NAMES, LOCALES } from "../lib/i18n/locale.ts";
import { useLocale, useT } from "./I18n.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";

/** The language menu in the bar, as on the website: a globe with the page's language, opening
 * the languages, each named in itself. The choice is remembered. */
export function Language() {
  const t = useT();
  const { locale, choose } = useLocale();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`${t.header.language}: ${LOCALE_NAMES[locale]}`}
        className="inline-flex h-8.5 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-steel transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary data-[state=open]:bg-accent data-[state=open]:text-foreground"
      >
        <Globe className="size-4" aria-hidden="true" />
        <span lang={locale}>{LOCALE_NAMES[locale]}</span>
        <ChevronDown
          className="size-3.5 transition-transform duration-200 in-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {LOCALES.map((each) => (
          <DropdownMenuItem
            key={each}
            lang={each}
            aria-current={each === locale ? "true" : undefined}
            onSelect={() => choose(each)}
          >
            <span className="flex-1">{LOCALE_NAMES[each]}</span>
            {each === locale && <Check className="text-primary" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
