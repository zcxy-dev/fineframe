import { en } from "../content/en.ts";
import { zhTw } from "../content/zh-tw.ts";
import type { Device } from "./device.ts";
import type { Locale } from "./site.ts";

/**
 * Text in a `Rich` string: `[label](href)` is a link and `[[text]]` a placeholder the owner
 * still has to fill in, shown marked on the page.
 */
type Rich = string;

/** A heading set on two lines, each kept whole. */
export type Lines = [string, string];

export type LegalPage = {
  title: string;
  description: string;
  intro: Rich[];
  /** When the page last changed, shown under its introduction. */
  updated?: string;
  sections: { heading: string; body: Rich[]; list?: Rich[] }[];
};

export type Content = {
  languageName: string;
  skip: string;
  nav: {
    home: string;
    examples: string;
    features: string;
    pricing: string;
    faq: string;
    download: string;
    account: string;
    signIn: string;
    getStarted: string;
    /** The link to this page in the other language. */
    language: string;
  };
  footer: {
    tagline: string;
    product: string;
    account: string;
    signUp: string;
    legal: string;
    terms: string;
    privacy: string;
    refund: string;
    credits: string;
    rights: string;
  };
  home: {
    /** The page's whole title. */
    title: string;
    description: string;
    hero: {
      title: Lines;
      lede: string;
      /** The main button, which leads to the plans. */
      plans: string;
      /** The download buttons' label on a phone or tablet, which lead to the download page. */
      phone: string;
      watch: string;
      /** The computers it runs on, or the visitor's computer's requirement once known; the price. */
      facts: [string, string];
      /** The post's line, and the label of the edit it plays. */
      post: string;
      /** What the post's bar says while the edit is made, and once it is done. */
      steps: [string, string, string, string, string];
      credit: string;
      pause: string;
      play: string;
    };
    features: {
      title: Lines;
      lede: string;
      cut: {
        title: Lines;
        body: string;
        /** The sample line, each word with whether it is a filler the edit cuts. */
        words: [string, boolean][];
        sample: string;
        target: string;
        result: string;
      };
      captions: { title: Lines; body: string; credit: string };
      music: { title: Lines; body: string; voice: string; music: string };
      more: string;
    };
    formats: {
      title: Lines;
      lede: string;
      spec: [string, string][];
      /** The timeline's tracks: picture, captions, names and titles, music. */
      tracks: [string, string, string, string];
      name: string;
      nameTitle: string;
      credit: string;
    };
    privacy: {
      title: Lines;
      lede: string;
      stays: { title: string; items: string[] };
      sent: { title: string; items: string[] };
      more: Rich;
    };
    pricing: {
      title: Lines;
      lede: string;
      cost: Rich;
      more: Rich;
    };
    faq: { title: string; items: { q: string; a: Rich }[] };
    close: { title: Lines };
  };
  download: {
    title: string;
    description: string;
    lede: Rich;
    /** Under the download buttons: what running the app needs. */
    needs: Rich;
    /** On a phone or tablet: the installers are for a computer. */
    phone: string;
    share: string;
    copied: string;
    table: { computer: string; installer: string; get: string };
    platforms: {
      id: Exclude<Device, "mobile">;
      name: string;
      requirement: string;
      file: string;
      /** The download buttons' label on this computer. */
      button: string;
      steps: Rich[];
      /** How the app updates on this computer. */
      update: Rich;
    }[];
    firstOpenTitle: string;
    firstOpen: Rich[];
    verifyTitle: string;
    /** How the app updates on each computer, where the visitor's is not known. */
    update: Rich;
    verify: Rich[];
  };
  pricing: {
    title: string;
    /** The page's heading; `title` names it in the tab and the bar. */
    heading: Lines;
    description: string;
    lede: Rich;
    /** `save`: the tag on the plan that costs less. */
    plans: { name: string; price: string; period: string; billing: string; save?: string }[];
    /** What the plan buttons say until purchases open. */
    checkout: string;
    /** Under each plan's button. */
    terms: string;
    afterTitle: string;
    after: Rich[];
    includedTitle: string;
    included: string[];
    keyTitle: string;
    key: Rich[];
    refundTitle: string;
    refund: Rich[];
  };
  legal: {
    terms: LegalPage;
    privacy: LegalPage;
    refund: LegalPage;
    credits: LegalPage;
  };
  checkout: { subscribe: string; subscribed: Rich; failed: string };
  auth: {
    email: string;
    password: string;
    google: string;
    or: string;
    working: string;
    /** The password field's toggle that shows what is typed. */
    show: string;
    /** Under every form that can create an account, Google's included. */
    agree: Rich;
    /** After a link is sent: start again with another address, or go home. */
    again: string;
    home: string;
    signIn: {
      title: string;
      /** Under the heading. */
      lede: string;
      description: string;
      submit: string;
      forgot: string;
      switchPrompt: string;
      switchLink: string;
      /** Above the form when a plan sent the visitor here; `{plan}` is the plan's name. */
      forPlan: string;
    };
    signUp: {
      title: string;
      lede: string;
      description: string;
      submit: string;
      passwordHint: string;
      switchPrompt: string;
      switchLink: string;
      /** What the form becomes once the link is sent; `{email}` is the address it went to. */
      sentTitle: string;
      sent: string;
      forPlan: string;
      /** `{email}` as in `sent`, `{plan}` as in `forPlan`. */
      sentPlan: string;
    };
    reset: {
      title: string;
      description: string;
      lede: string;
      submit: string;
      /** As in sign-up. */
      sentTitle: string;
      sent: string;
      /** Under the heading once the link is opened, instead of `lede`. */
      newLede: string;
      /** When the link has expired or was used already. */
      expired: string;
      newPassword: string;
      save: string;
      back: string;
    };
    errors: {
      invalid: string;
      unconfirmed: string;
      weak: string;
      leaked: string;
      address: string;
      rate: string;
      generic: string;
    };
  };
  account: {
    title: string;
    description: string;
    signedInAs: string;
    signOut: string;
    subscriptionTitle: string;
    statusTitle: string;
    plans: { monthly: string; yearly: string };
    /** In each, `{date}` is a date. */
    status: {
      none: string;
      noneNote: string;
      /** Under `none` until purchases open. */
      soon: string;
      active: string;
      renews: string;
      cancelled: string;
      until: string;
      pastDue: string;
      pastDueNote: string;
      paused: string;
      ended: string;
      confirming: string;
    };
    /** The plans' card, shown while the account has no plan. */
    choose: string;
    manage: string;
    manageNote: string;
    downloadTitle: string;
    downloadBody: string;
    download: string;
  };
  authorize: {
    title: string;
    description: string;
    /** `{email}` is the signed-in account. */
    lede: string;
    /** What the app gets from the account. */
    shares: string;
    /** Once purchases open, for an account with no plan. */
    noPlan: Rich;
    allow: string;
    deny: string;
    switch: string;
    done: string;
    invalid: string;
  };
  notFound: { title: string; body: string; home: string };
};

const CONTENT: Record<Locale, Content> = { en, "zh-tw": zhTw };

export function content(locale: Locale): Content {
  return CONTENT[locale];
}
