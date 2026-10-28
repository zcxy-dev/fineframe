import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError } from "@supabase/supabase-js";
import { en } from "../content/en.ts";
import { errorText } from "./supabase.ts";

const rejected = (code: string) => new AuthApiError("rejected", 400, code);

test("an address Supabase will not take asks for another, not for a retry", () => {
  for (const code of ["email_address_invalid", "email_address_not_authorized"]) {
    assert.equal(errorText(en.auth.errors, rejected(code)), en.auth.errors.address);
  }
  assert.equal(errorText(en.auth.errors, rejected("unexpected_failure")), en.auth.errors.generic);
});
