import { createCn } from "cn/config";

/**
 * `cn`, told the site's scales (app/globals.css), so it merges `text-small` with a text size
 * rather than with a colour.
 */
export const cn = createCn({
  extend: {
    theme: {
      text: ["display", "title", "heading", "subhead", "lede", "body", "small", "fine", "slug"],
      tracking: ["slug"],
      radius: ["field", "frame", "card"],
      shadow: ["card", "raised"],
    },
  },
});
