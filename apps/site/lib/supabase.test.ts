import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { en } from "../content/en.ts";
import { errorText, nextPath, nextPlan, paddleBilled, signUpHref } from "./supabase.ts";

const rejected = (code: string) => new AuthApiError("rejected", 400, code);

test("an address Supabase will not take asks for another, not for a retry", () => {
  for (const code of ["email_address_invalid", "email_address_not_authorized"]) {
    assert.equal(errorText(en.auth.errors, rejected(code)), en.auth.errors.address);
  }
  assert.equal(errorText(en.auth.errors, rejected("unexpected_failure")), en.auth.errors.generic);
});

test("a leaked password asks for a different one, not a longer one", () => {
  // As supabase-js throws Auth's `weak_password` error, with its `weak_password.reasons`.
  const weak = (reasons: AuthWeakPasswordError["reasons"]) =>
    new AuthWeakPasswordError("weak", 422, reasons);
  assert.equal(errorText(en.auth.errors, weak(["pwned"])), en.auth.errors.leaked);
  assert.equal(errorText(en.auth.errors, weak(["length", "pwned"])), en.auth.errors.leaked);
  assert.equal(errorText(en.auth.errors, weak(["length"])), en.auth.errors.weak);
  assert.equal(errorText(en.auth.errors, weak([])), en.auth.errors.weak);
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

test("only a subscription Paddle bills offers its customer portal", () => {
  const row = {
    status: "active",
    plan: "yearly",
    current_period_end: null,
    cancel_at: null,
  } as const;
  assert.equal(
    paddleBilled({ ...row, paddle_customer_id: "ctm_01aaaaaaaaaaaaaaaaaaaaaaaa" }),
    true,
  );
  assert.equal(paddleBilled({ ...row, paddle_customer_id: "comp" }), false);
});
