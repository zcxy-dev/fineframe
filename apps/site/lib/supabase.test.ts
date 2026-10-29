import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError } from "@supabase/supabase-js";
import { en } from "../content/en.ts";
import { errorText, nextPath, nextPlan, signUpHref } from "./supabase.ts";

const rejected = (code: string) => new AuthApiError("rejected", 400, code);

test("an address Supabase will not take asks for another, not for a retry", () => {
  for (const code of ["email_address_invalid", "email_address_not_authorized"]) {
    assert.equal(errorText(en.auth.errors, rejected(code)), en.auth.errors.address);
  }
  assert.equal(errorText(en.auth.errors, rejected("unexpected_failure")), en.auth.errors.generic);
});

test("after signing in, only a page of this site is gone to", () => {
  const at = (next: string) =>
    nextPath("en", {
      search: `?next=${encodeURIComponent(next)}`,
      origin: "https://fineframe.app",
    });
  assert.equal(at("/en/download/?from=app#mac"), "/en/download/?from=app#mac");
  for (const next of [
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "https://evil.example/",
    "evil.example",
  ]) {
    assert.equal(at(next), "/en/account/", next);
  }
  assert.equal(nextPath("en", { search: "", origin: "https://fineframe.app" }), "/en/account/");
});

test("a plan's button sends a new buyer to sign up, which names the plan", () => {
  const search = new URL(signUpHref("en", "/en/pricing/?plan=yearly"), "https://fineframe.app")
    .search;
  assert.equal(nextPlan({ search }), "yearly");
  assert.equal(
    nextPlan({ search: `?next=${encodeURIComponent("/en/pricing/?plan=free")}` }),
    undefined,
  );
  assert.equal(nextPlan({ search: "?next=%2Fen%2Faccount%2F" }), undefined);
  assert.equal(nextPlan({ search: "" }), undefined);
});
