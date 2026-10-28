import { content } from "../lib/content.ts";
import { DOWNLOADS, href, type Locale } from "../lib/site.ts";
import { Icon } from "./Icon.tsx";

/**
 * A download button for the visitor's device (`data-show`): on a computer it downloads that
 * computer's installer; on a phone or tablet, labelled `phone`, and wherever the device is not
 * known, labelled `label`, it leads to the download page. The bar's has no icon.
 */
export function Download({
  locale,
  label,
  phone,
  className,
  icon = true,
}: {
  locale: Locale;
  label: string;
  phone?: string;
  className: string;
  icon?: boolean;
}) {
  const page = href(locale, "/download/");
  const mark = icon && <Icon name="download" />;
  return (
    <>
      <a data-show={phone ? "any" : "any mobile"} className={className} href={page}>
        {mark}
        {label}
      </a>
      {phone && (
        <a data-show="mobile" className={className} href={page}>
          {mark}
          {phone}
        </a>
      )}
      {content(locale).download.platforms.map((platform) => (
        <a
          key={platform.id}
          data-show={platform.id}
          className={className}
          href={`${DOWNLOADS}/${platform.file}`}
        >
          {mark}
          {platform.button}
        </a>
      ))}
    </>
  );
}
