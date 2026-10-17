import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { projectSchema } from "@video-editor/schema";
import { catalog } from "./catalog.ts";

type Node = Record<string, unknown>;

const defs = (projectSchema as { $defs: Record<string, Node> }).$defs;

/** The node itself, through a `$ref`, and the branches of `allOf`, `anyOf` and `oneOf`. */
function variants(node: Node): Node[] {
  const ref = node.$ref;
  if (typeof ref === "string") return variants(defs[ref.replace("#/$defs/", "")] ?? {});
  const branches = ["allOf", "anyOf", "oneOf"].flatMap((key) => (node[key] as Node[]) ?? []);
  return [node, ...branches.flatMap(variants)];
}

/** Every object node of the schema, each `$defs` entry and the root among them. */
function objects(node: Node, seen = new Set<Node>()): Node[] {
  if (seen.has(node)) return [];
  seen.add(node);
  const children = [
    ...Object.values((node.properties as Record<string, Node>) ?? {}),
    ...(node.items ? [node.items as Node] : []),
    ...["allOf", "anyOf", "oneOf"].flatMap((key) => (node[key] as Node[]) ?? []),
  ];
  return [node, ...children.flatMap((child) => objects(child, seen))];
}

/** The node at `path` below `node`, or undefined when a key is not one of its properties. */
function resolve(node: Node, path: string[]): Node | undefined {
  const [key, ...rest] = path;
  if (key === undefined) return node;
  const name = key.replace(/\[\w*\]$/, "");
  for (const variant of variants(node)) {
    let child = (variant.properties as Record<string, Node> | undefined)?.[name];
    if (!child) continue;
    if (key.endsWith("]")) child = variants(child).find((v) => v.items)?.items as Node;
    const found = child && resolve(child, rest);
    if (found) return found;
  }
  return undefined;
}

const templateParams = new Set(
  Object.values(catalog).flatMap((template) =>
    Object.keys((template.params as { properties: object }).properties),
  ),
);

test("every project.json path the agent skill names is in the schema or the effects catalog", async () => {
  const skill = new URL("../../../skills/video-editor/", import.meta.url);
  const recipes = (
    await Promise.all(
      ["SKILL.md", "references/recipes.md"].map((file) => readFile(new URL(file, skill), "utf8")),
    )
  ).join("\n");
  // Dotted names in backticks, such as `captions.lines[].words`; file names are not paths.
  const paths = [...recipes.matchAll(/`([a-z]\w*(?:\[\w*\])?(?:\.[a-z]\w*(?:\[\w*\])?)+)`/gi)]
    .map((match) => match[1] ?? "")
    .filter((path) => !/\.(json|md|ts|srt|txt|mp4)$/.test(path));
  assert.ok(paths.length > 10, `only ${paths.length} paths found`);
  const nodes = [...objects(projectSchema as Node), ...Object.values(defs)];
  const missing = paths.filter((path) => {
    const [first, ...rest] = path.split(".");
    if (first === "params") return rest.length !== 1 || !templateParams.has(rest[0] ?? "");
    return !nodes.some((node) => resolve(node, path.split(".")));
  });
  assert.deepEqual(missing, []);
});
