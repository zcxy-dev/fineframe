import assert from "node:assert/strict";
import { test } from "node:test";
import { svgProblem } from "./logo.ts";

const svg = (inner: string, attributes = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attributes}>${inner}</svg>`;

test("an SVG logo of shapes, text, gradients and references inside it passes", () => {
  assert.equal(
    svgProblem(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><text x="1" y="8">A</text><use href="#g"/>',
      ),
    ),
    null,
  );
});

test("an SVG logo that runs a script, holds HTML or reaches another file is refused", () => {
  for (const unsafe of [
    svg("<script>fetch('https://x.example')</script>"),
    svg('<rect width="1" height="1"/>', ' onload="fetch(1)"'),
    svg("<foreignObject><div>x</div></foreignObject>"),
    svg('<image href="https://x.example/a.png"/>'),
    svg('<use href="https://x.example/a.svg#x"/>'),
    svg('<use xlink:href="other.svg#x"/>'),
    svg('<rect fill="url(https://x.example/p)"/>'),
    svg("<style>@import url(https://x.example/a.css);</style>"),
    svg('<a href="javascript:alert(1)"><rect/></a>'),
    `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${svg("<text>&x;</text>")}`,
    "<html><body>not a logo</body></html>",
  ]) {
    assert.ok(svgProblem(unsafe), unsafe);
  }
  assert.match(svgProblem(`<svg>${" ".repeat(2 * 1024 * 1024)}</svg>`) ?? "", /larger than 2 MB/);
});
