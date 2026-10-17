// Regenerates the code generated from the schemas: the TypeScript types in src/generated and the
// Python models vework validates its media and music indexes with. With --check it writes nothing and fails
// when a checked-in file differs, so a schema cannot change without the code built from it.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const here = new URL("../", import.meta.url);
const worker = new URL("../../worker/", here);
const check = process.argv.includes("--check");

const files = new Map<URL, string>();
for (const name of ["media-index", "music-index", "progress", "project"]) {
  const schema = fileURLToPath(new URL(`${name}.schema.json`, here));
  const types = await compileFromFile(schema, {
    bannerComment: `// Generated from ${name}.schema.json by \`pnpm gen\`; do not edit.`,
    unknownAny: true,
  });
  files.set(new URL(`src/generated/${name}.ts`, here), types);
}
for (const name of ["media-index", "music-index"]) {
  const model = execFileSync(
    "uv",
    [
      "run",
      "--frozen",
      "--no-group",
      "ml",
      "datamodel-codegen",
      "--input",
      fileURLToPath(new URL(`${name}.schema.json`, here)),
      "--input-file-type",
      "jsonschema",
      "--output-model-type",
      "pydantic_v2.BaseModel",
      "--target-python-version",
      "3.12",
      "--use-annotated",
      "--use-union-operator",
      "--use-standard-collections",
      "--field-constraints",
      "--use-double-quotes",
      "--disable-timestamp",
      "--collapse-root-models",
      // vework validates plain JSON values strictly, which an Enum member would never match.
      "--enum-field-as-literal",
      "all",
      "--custom-file-header",
      `# Generated from packages/schema/${name}.schema.json by \`pnpm gen\`; do not edit.`,
      // Run from worker/, ruff formats the model with the worker's own settings.
      "--formatters",
      "ruff-format",
      "ruff-check",
    ],
    { cwd: worker, encoding: "utf8" },
  );
  files.set(new URL(`src/vework/${name.replace("-", "_")}.py`, worker), model);
}

const stale = [];
for (const [url, text] of files) {
  const current = await readFile(url, "utf8").catch(() => undefined);
  if (current === text) continue;
  if (check) stale.push(fileURLToPath(url));
  else await writeFile(url, text);
}
if (stale.length > 0) {
  console.error(`Out of date with the schemas; run \`pnpm gen\`:\n  ${stale.join("\n  ")}`);
  process.exit(1);
}
