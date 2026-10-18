/** The page's background, dark and light: the one source for `--bg`, the browser's theme colour
 * and the desktop window behind the page. */
export const BACKGROUND = { dark: "#1c1d21", light: "#f6f6f4" } as const;

/** `--bg` for each colour scheme, as the root layout puts it in the page's head. */
export const backgroundCss =
  `:root{--bg:${BACKGROUND.dark}}` +
  `@media (prefers-color-scheme: light){:root{--bg:${BACKGROUND.light}}}`;
