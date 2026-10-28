import type { Metadata } from "next";

export const metadata: Metadata = { title: "Fineframe", robots: { index: false } };

// Supabase's sign-in for the app comes here, at a path without a language: pick one as `/`
// does and keep the query, which holds the authorization's id.
const PICK = `location.replace((/(^|,)zh/i.test((navigator.languages||[navigator.language]).join(","))?"/zh-tw":"/en")+"/authorize/"+location.search)`;

export default function AuthorizeLanguage() {
  return <script dangerouslySetInnerHTML={{ __html: PICK }} />;
}
