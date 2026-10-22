import { resolve } from "node:path";
import {
  accountStatus,
  readSupabase,
  SITE,
  type SignIn,
  signOut,
  siteLocale,
  startSignIn,
} from "../../../lib/account.ts";
import { checkOrigin, errorResponse } from "../../../lib/http.ts";
import { localeOf, messagesOf } from "../../../lib/i18n/messages.ts";
import { JobError } from "../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

/** The account's file, which the desktop app gives; none elsewhere, where nothing is checked. */
const file = () => process.env.VIDEO_EDITOR_ACCOUNT_FILE;
const supabase = () => readSupabase(resolve(process.cwd(), "../.."));
const gated = () => file() !== undefined && process.env.FINEFRAME_DEV_ENTITLED !== "1";

/** The sign-in waiting for the browser, if any; one at a time. */
const pending = globalThis as { videoEditorSignIn?: SignIn };

/** Whether edits need an account here and, if so, who is signed in and whether they may edit;
 * with the website's pricing and account pages in the page's language. */
export async function GET(request: Request): Promise<Response> {
  const path = file();
  if (!path || !gated()) return Response.json({ gated: false });
  const site = `${SITE}/${siteLocale(localeOf(request))}`;
  return Response.json({
    gated: true,
    ...(await accountStatus(path, await supabase())),
    pricing: `${site}/pricing/`,
    account: `${site}/account/`,
  });
}

/** Starts a sign-in: the page opens the address it answers in the browser, then asks GET until
 * the browser has come back. */
export async function POST(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const path = file();
    const project = await supabase();
    if (!path || !project) throw new JobError((t) => t.server.noSignIn, 400);
    const t = messagesOf(request);
    pending.videoEditorSignIn?.cancel();
    const signIn = await startSignIn(path, project, localeOf(request), {
      done: t.account.landingDone,
      failed: t.account.landingFailed,
    });
    pending.videoEditorSignIn = signIn;
    return Response.json({ url: signIn.url });
  } catch (error) {
    return errorResponse(error, request);
  }
}

/** Signs out. */
export async function DELETE(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const path = file();
    if (path) await signOut(path, await supabase());
    return GET(request);
  } catch (error) {
    return errorResponse(error, request);
  }
}
