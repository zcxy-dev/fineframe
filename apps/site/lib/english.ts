/**
 * English with its last two words joined, so a paragraph's last line is never one word. A
 * hyphen in them does not break either. Text of fewer than four words is left as it is, and
 * Chinese, which has no spaces, too.
 */
export function lastTwo(text: string): string {
  const words = text.split(" ");
  if (words.length < 4) return text;
  const tail = words.splice(-2).join("\u00a0").replaceAll("-", "\u2011");
  return [...words, tail].join(" ");
}
