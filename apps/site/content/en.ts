import type { Content } from "../lib/content.ts";
import { DOWNLOADS } from "../lib/site.ts";

const BUYER = "https://www.paddle.com/legal/buyer-terms";
const CONTACT =
  "If you have any questions, contact us at [support@fineframe.app](mailto:support@fineframe.app).";
const UPD = "Last updated 29 October 2026.";
const SELLER =
  "The Fineframe app and this website are developed and provided by Fineframe (“we”, “us”).";

export const en: Content = {
  languageName: "English",
  skip: "Skip to content",
  nav: {
    home: "Fineframe home",
    examples: "Examples",
    features: "Features",
    pricing: "Pricing",
    faq: "FAQ",
    download: "Download",
    account: "Account",
    signIn: "Sign in",
    getStarted: "See plans",
    language: "Language",
    menu: "Menu",
    close: "Close the menu",
  },
  footer: {
    tagline: "Shoot it, post it. Fineframe does the edit in between.",
    product: "Product",
    account: "Account",
    signUp: "Create an account",
    legal: "Legal",
    terms: "Terms of service",
    privacy: "Privacy policy",
    refund: "Refund policy",
    credits: "Credits",
    rights: "© 2026 Fineframe",
  },
  home: {
    title: "Fineframe | Shoot it, post it",
    description:
      "Fineframe edits your footage on your own computer: the cuts, captions and music, even when you switch between Mandarin and English. For Mac, Windows and Linux.",
    hero: {
      title: ["Shoot it", "Post it"],
      lede: "Fineframe does the edit in between: the cuts, captions and music, even when you switch between Mandarin and English.",
      plans: "See plans and pricing",
      phone: "Downloads for your computer",
      watch: "Watch an edit",
      facts: ["Mac (Apple silicon) · Windows · Linux", "US$15 a month or US$120 a year"],
      post: "A 22-minute talk, cut to 50 seconds",
      steps: [
        "Transcribing",
        "Picking the best takes",
        "Framing for vertical",
        "Checking every cut",
        "Done · 0:50 · 9:16",
      ],
      legend: ["Kept", "Cut"],
      credit: "Footage: NASA, public domain. Not an endorsement.",
      pause: "Pause",
      play: "Play",
    },
    features: {
      title: ["From the first cut", "to the final mix"],
      lede: "All of it is in the app today.",
      cut: {
        title: ["Ums and pauses out", "right on length"],
        body: "Fineframe keeps your best takes, lands within 5 % of the length you pick and checks every cut against the words around it.",
        words: [
          ["So,", true],
          ["um,", true],
          ["today", false],
          ["I", false],
          ["want", false],
          ["to", false],
          ["uh,", true],
          ["walk", false],
          ["you", false],
          ["through", false],
          ["my", false],
          ["setup", false],
        ],
        sample: "Example",
        target: "Target",
        result: "Cut",
      },
      captions: {
        title: ["Captions", "that keep up"],
        body: "Traditional Chinese for Taiwan, and no slips when you switch languages.",
        credit: "Footage: 极客湾Geekerwan, CC BY 3.0. Not affiliated.",
      },
      music: {
        title: ["Music that drops", "when you talk"],
        body: "The music dips under every line and comes back in the gaps. The built-in library is CC0.",
        voice: "Voice",
        music: "Music",
      },
      alsoTitle: "Also in the app",
      also: [
        {
          title: "Several shorts",
          body: "Up to 10 shorts from one long video, each from one stretch of it, with a title, a description and hashtags.",
        },
        {
          title: "Your editing app",
          body: "Export the finished edit as a timeline for Final Cut Pro, DaVinci Resolve or Premiere Pro, with its music, captions and graphics.",
        },
        {
          title: "Brand kits",
          body: "A logo watermark, up to three colours, your fonts and caption style, kept as named kits.",
        },
        {
          title: "Names and titles",
          body: "Animated titles, name cards, chapters and callouts, placed where the speech calls for them.",
        },
        {
          title: "B-roll",
          body: "Cutaways to stock footage and to the pages the speaker names, from free sources.",
        },
        {
          title: "Links as footage",
          body: "Paste a public video’s link from YouTube or another site, and it comes in at up to 1080p.",
        },
      ],
    },
    formats: {
      title: ["Vertical for Reels", "wide for YouTube"],
      lede: "Same footage, pick the shape. This one is an astronaut interview cut to a 59-second YouTube video.",
      spec: [
        ["Length", "0:59 · 16:9"],
        ["Captions", "Word by word"],
        ["Names and titles", "Added for you"],
        ["Music", "Built-in CC0 library"],
        ["Your part", "Pick a length and a shape"],
      ],
      tracks: ["Video", "Captions", "Names and titles", "Music"],
      name: "Christina Koch",
      nameTitle: "Meet Christina Koch",
      credit: "Footage: NASA, public domain. Not an endorsement.",
    },
    privacy: {
      title: ["Edited on your computer", "with no video uploaded"],
      lede: "Analysis and rendering run on your own machine. Claude plans the edit on your own Anthropic key and gets mainly these three things, never your video files.",
      stays: {
        title: "Stays on your computer",
        items: ["Your video files", "Their analysis", "Your projects and brand kits"],
      },
      sent: {
        title: "Goes to Claude",
        items: ["The transcript", "Details of each file", "Frames around each cut"],
      },
      more: "[Everything the app sends, and where](/privacy/)",
    },
    pricing: {
      title: ["One full app", "US$15 a month"],
      lede: "Monthly and yearly are the same full app: only the billing period differs. Buying needs a free Fineframe account.",
      cost: "Claude is billed apart, on your own Anthropic API key: about US$0.20 to 0.60 for an edit of a minute or less, and US$1 to 1.20 for five minutes. The app estimates it before every edit.",
      more: "[Full pricing](/pricing/)",
    },
    faq: {
      title: "Before you buy",
      items: [
        {
          q: "What do I need to start?",
          a: "A supported computer, a Fineframe plan and your own [Anthropic API key](https://console.anthropic.com/settings/keys). The first time it opens, the app installs its analysis, about 2 GB.",
        },
        {
          q: "Which computers does it run on?",
          a: "Macs with Apple silicon (M1 or later), Windows 10 or 11 on x64, and Linux on x86-64. Intel Macs are not supported.",
        },
        {
          q: "What if my computer has little memory?",
          a: "With less than 12 GB, speech is transcribed on OpenRouter with your own key, for about US$0.03 an hour of footage. The app tells you, and you can choose either way.",
        },
        {
          q: "Which languages does it understand?",
          a: "Mandarin, English and speech that switches between them. Chinese captions come out in Traditional Chinese for Taiwan, and the app itself is in English and Traditional Chinese.",
        },
        {
          q: "Can I change the edit?",
          a: "Yes. Cut words from the transcript, switch the caption style, and keep each version. Or export the edit to Final Cut Pro, DaVinci Resolve or Premiere Pro and finish it there.",
        },
        {
          q: "Can I get a refund?",
          a: "There is no free trial. A plan’s first payment can be refunded within 14 days, once per customer; renewals are not. See the [refund policy](/refund/).",
        },
      ],
    },
    close: { title: ["Shoot the next one", "Skip the edit"] },
  },
  download: {
    title: "Download Fineframe",
    description:
      "Installers for Macs with Apple silicon, Windows and Linux. Nothing else to install.",
    lede: "Download the installer, with no Node, no Python and no command line to set up. The first time it opens, the app asks you to sign in with the account that has your plan and for your Anthropic API key, and installs its analysis, about 2 GB.",
    others: "For another computer:",
    needs: "Needs an active Fineframe plan to run. [See plans](/pricing/)",
    phone: "Fineframe runs on a computer. Open this page there, or send yourself the link.",
    share: "Send the link",
    copied: "Link copied",
    table: { computer: "Computer", installer: "Installer", get: "Download" },
    platforms: [
      {
        id: "mac",
        name: "macOS",
        requirement: "Needs Apple silicon (M1 or later)",
        file: "Fineframe-mac-arm64.dmg",
        button: "Download for Mac",
        steps: [
          "Open the DMG and drag Fineframe into Applications.",
          "The app is not yet signed with an Apple Developer ID, so the first time you open it, macOS says it cannot check the app for malicious software. Choose **Done**.",
          "Open **System Settings → Privacy & Security**, scroll to Security and choose **Open Anyway** next to the message about Fineframe, then confirm with your password. After that it opens normally.",
          "Macs with an Intel processor are not supported: the libraries the analysis runs on no longer publish builds for them.",
        ],
        update:
          "The app tells you when a new version is out, with its download: install it over the old one. Your keys and downloads stay.",
      },
      {
        id: "windows",
        name: "Windows",
        requirement: "Windows 10 or 11 (x64)",
        file: "Fineframe-win-x64.exe",
        button: "Download for Windows",
        steps: [
          "Open the installer. It installs Fineframe for your user alone, with no administrator needed, and opens it.",
          "The installer is not yet signed, so Microsoft Defender SmartScreen may say “Windows protected your PC”. Choose **More info**, check that the app is Fineframe, then choose **Run anyway**.",
        ],
        update:
          "The app updates itself: it downloads a new version in the background and installs it when you restart or quit. Your keys and downloads stay.",
      },
      {
        id: "linux",
        name: "Linux",
        requirement: "Linux (x86-64)",
        file: "Fineframe-linux-x86_64.AppImage",
        button: "Download for Linux",
        steps: [
          "Make the AppImage executable with `chmod +x Fineframe-*.AppImage`, then run it.",
          "AppImages need FUSE 2: on Ubuntu 24.04, `sudo apt install libfuse2t64`.",
        ],
        update:
          "The app updates itself: it downloads a new version in the background and installs it when you restart or quit. Your keys and downloads stay.",
      },
    ],
    firstOpenTitle: "The first time it opens",
    firstOpen: [
      "Sign in to your Fineframe account in your browser: the one with your plan.",
      "Paste your [Anthropic API key](https://console.anthropic.com/settings/keys), and the app checks it.",
      "Meanwhile the app installs its analysis once, about 2 GB of Python and PyTorch, with the progress in the window.",
      "Your first edit downloads the rest, each with its own progress bar: the speech model, FFmpeg, the effects renderer, and yt-dlp for the first link you import.",
      "With less than 12 GB of memory, speech is transcribed on OpenRouter instead, with your [OpenRouter API key](https://openrouter.ai/settings/keys), for about US$0.03 an hour of footage. The app tells you, and you can choose either way.",
    ],
    verifyTitle: "Updates and checksums",
    update:
      "On Windows and Linux the app updates itself: it downloads a new version in the background and installs it when you restart or quit. On a Mac it tells you when a new version is out, with its download: install it over the old one. Your keys and downloads stay either way.",
    verify: [
      `[SHA256SUMS](${DOWNLOADS}/SHA256SUMS) lists each installer’s SHA-256, so you can check the one you downloaded.`,
    ],
  },
  pricing: {
    title: "Pricing",
    heading: ["One full app", "Two ways to pay"],
    description: "Fineframe is US$15 a month or US$120 a year, the same full app either way.",
    lede: "Every feature is in both plans. Pay month to month, or once a year for less.",
    plans: [
      { name: "Monthly", price: "US$15", period: "/ month", billing: "Billed monthly" },
      {
        name: "Yearly",
        price: "US$10",
        period: "/ month",
        billing: "US$120 billed yearly",
        save: "Save 33%",
      },
    ],
    checkout: "Opening soon",
    trust: [
      "Checkout by Paddle",
      "Cancel anytime",
      "First payment refundable within 14 days",
      "Invoices in your account",
    ],
    afterTitle: "After you subscribe",
    after: [
      "[Download Fineframe](/download/) for your computer.",
      "Open it and sign in with this account.",
      "Paste your [Anthropic API key](https://console.anthropic.com/settings/keys) and make your first edit.",
    ],
    includedTitle: "Everything in both plans",
    included: [
      "Fineframe for Macs with Apple silicon, Windows and Linux",
      "Edits from 15 seconds to an hour, at 9:16, 1:1 or 16:9",
      "Several shorts from one video, brand kits, motion graphics and B-roll",
      "Analysis and rendering on your own computer",
    ],
    keyTitle: "What Claude costs",
    key: "Fineframe plans and checks each edit with Claude on your own Anthropic API key, so Anthropic bills you directly for what each edit uses. None of it passes through Fineframe, and the app estimates it before every edit.",
    keyRows: [
      ["An edit of a minute or less", "about US$0.20 to 0.60"],
      ["A five-minute edit", "US$1 to 1.20"],
    ],
    faqTitle: "Questions about paying",
    faq: [
      {
        q: "Is there a free trial?",
        a: "No. If Fineframe is not right for you, a plan’s first payment can be refunded within 14 days, once per customer; renewals are not. See the [refund policy](/refund/).",
      },
      {
        q: "Who takes the payment?",
        a: "Paddle.com, our online reseller and the Merchant of Record for every order. It handles the payment, billing and invoices, and we never see your card details.",
      },
      {
        q: "Can I switch plans or cancel?",
        a: "Yes, at any time. In your [account](/account/), Manage billing opens Paddle’s customer portal, where you change your plan or payment method, see your invoices or cancel. After you cancel, Fineframe works until the end of the period you paid for.",
      },
      {
        q: "Do I need an account to buy?",
        a: "Yes, a free Fineframe account. You subscribe with it, and you sign in to the app with it.",
      },
      {
        q: "Can I use it on more than one computer?",
        a: "Yes. While your subscription is active, you may install and use Fineframe on your own computers.",
      },
      {
        q: "Which computers does it run on?",
        a: "Macs with Apple silicon (M1 or later), Windows 10 or 11 on x64, and Linux on x86-64. Intel Macs are not supported.",
      },
    ],
  },
  contents: "On this page",
  legal: {
    terms: {
      title: "Terms of service",
      description: "The terms for using Fineframe and fineframe.app.",
      intro: ["These terms apply to the Fineframe app and to this website."],
      updated: UPD,
      sections: [
        { heading: "About us", body: [SELLER, CONTACT] },
        {
          heading: "Your licence",
          body: [
            "While your subscription is active, you may install and use Fineframe on your own computers. Fineframe is licensed to you, not sold, and the licence is personal: you may not copy, resell or redistribute the app, or decompile or reverse engineer it, except where the law allows this despite these terms.",
          ],
        },
        {
          heading: "Subscriptions and payment",
          body: [
            "Both plans give you the same full app; only the billing period and the price differ. Plans are billed monthly or yearly in US dollars, at the prices on the [pricing page](/pricing/), in advance, and renew until you cancel. Cancelling stops the next renewal; the app keeps working until the end of the period you paid for.",
            `Fineframe is sold through Paddle.com, our online reseller and the Merchant of Record for every order. Paddle handles the payment, billing, taxes and invoices, and its [Buyer Terms](${BUYER}) apply to your purchase.`,
            "A change of price applies from your next renewal, and we tell you before it does.",
          ],
        },
        {
          heading: "Refunds",
          body: [
            "Fineframe has no free plan and no free trial. A plan’s first payment can be refunded within 14 days, once per customer, and renewals are not refunded; the [refund policy](/refund/) says how to ask.",
          ],
        },
        {
          heading: "Your API keys and other services",
          body: [
            "Fineframe uses your own Anthropic API key to plan and check each edit, and, if you give them, your OpenRouter, Pexels or Pixabay keys. You pay those services directly, under their own terms. Their charges are not part of your subscription, and we do not refund them. The [privacy policy](/privacy/) says what the app sends to each.",
          ],
        },
        {
          heading: "Your footage and your videos",
          body: [
            "Your footage, and the videos Fineframe makes from it, are yours. You must have the right to use everything you give the app: footage, linked videos, music, logos and fonts.",
          ],
        },
        {
          heading: "Open-source components",
          body: [
            "Fineframe downloads and runs open-source components, such as FFmpeg and its speech and analysis models, each under its own licence, which the app’s notices list.",
          ],
        },
        {
          heading: "No warranty",
          body: [
            "Fineframe is provided as it is. Automatic edits can contain mistakes: watch a video before you publish it.",
          ],
        },
        {
          heading: "Liability",
          body: [
            "As far as the law allows, our total liability to you is limited to what you paid us for Fineframe in the 12 months before the claim.",
          ],
        },
        {
          heading: "Changes to these terms",
          body: [
            "We post any new version of these terms here with its date. A material change applies from your next renewal.",
          ],
        },
        {
          heading: "Governing law",
          body: ["These terms are governed by the laws of Taiwan (Republic of China)."],
        },
      ],
    },
    privacy: {
      title: "Privacy policy",
      description: "What the Fineframe app and fineframe.app send, to whom, and when.",
      intro: [
        "Fineframe edits your videos on your own computer. This policy says what the app and this website send, to whom, and when.",
      ],
      updated: UPD,
      sections: [
        { heading: "About us", body: [SELLER, CONTACT] },
        {
          heading: "This website",
          body: [
            "fineframe.app sets no cookies and runs no analytics or tracking. It is hosted on Cloudflare Pages: like any web host, Cloudflare receives the technical details every request carries, such as your IP address and browser, to serve the page.",
            "When you sign in, the site keeps your session in your browser’s local storage, not in a cookie, until you sign out.",
            "The installers download from downloads.fineframe.app, and the example videos play from this site; Cloudflare serves both, as above.",
          ],
        },
        {
          heading: "Your account",
          body: [
            "Your Fineframe account holds your email address and either a hash of your password or, when you sign in with Google, the name, email address and picture Google shares. It also holds when you signed up and last signed in, and its sign-in records note the IP address each sign-in came from. Once you subscribe, it also holds your subscription’s status, plan and renewal date, which Paddle sends us.",
            "The account is held by Supabase, our account provider, in Tokyo, under [Supabase’s privacy policy](https://supabase.com/privacy). The app signs in to it only to check that you may use Fineframe; it sends us no usage data, footage or keys.",
          ],
        },
        {
          heading: "Payments",
          body: [
            `Fineframe is sold through Paddle.com, the Merchant of Record for every order. When you subscribe, Paddle collects your payment and billing details to take the payment, charge the right tax and send the invoice, under its own [privacy notice](https://www.paddle.com/legal/privacy). We never see your card details.`,
          ],
        },
        {
          heading: "What stays on your computer",
          body: [
            "Your footage, its analysis, your edits, projects and brand kits stay on your computer, where the analysis and rendering run. No video file is uploaded, and no audio leaves your computer unless you use cloud speech.",
            "Your API keys are kept in a file only your user can read, in the app’s folder. Each key is sent only to its own service.",
          ],
        },
        {
          heading: "Anthropic (Claude)",
          body: ["The app sends Anthropic, with your Anthropic API key:"],
          list: [
            "**To plan an edit:** each file’s transcript with its name, length, frame size, shot changes, pauses, loudness peaks and audio events; the people’s names you list; what you tell Claude you want; and for music you offer, each track’s file name, length, tempo, the loudness of its sections and its licence name.",
            "**To find the moments for several shorts:** the same of every file except the names, and what you ask of the shorts.",
            "**To write the motion graphics:** the edit’s words with their timing, its size and length, where the captions and faces are in the picture, where the picture changes, and where B-roll and other overlays already are; for a graphic that fails its checks, a picture of it as drawn, its code, what is wrong with it and the words said around it.",
            "**To check the cuts:** for every cut, a picture of eight frames and the waveform of the two seconds around it, with the words on either side.",
            "**For callouts on a screen recording:** one frame for each callout planned, with the line said over it.",
            "**For transcript correction, if you turn it on:** the transcript, the video’s title (by default the file name) and your names and terms.",
            "**To check your key:** a request for the planning model’s details, which costs nothing.",
          ],
        },
        {
          heading: "OpenRouter",
          body: [
            "With your OpenRouter API key, and only with cloud speech, which you choose, or which the app offers when your computer has too little memory for the local speech model: the speech, as audio in chunks of at most 30 seconds, for the model’s provider to transcribe. Checking your OpenRouter key reads the key’s own details.",
          ],
        },
        {
          heading: "B-roll",
          body: [
            "A rich edit, the default, sends nothing of your video for its B-roll, but fetches from the web:",
          ],
          list: [
            "**Web pages the speaker names:** the app opens each page Claude picks from the transcript in a headless Chrome, with a fresh profile each time, and captures it, so that site sees a visit from your computer. It never fills a form, logs in or accepts a consent banner.",
            "**Stock footage:** the search words Claude writes go to Pexels or Pixabay with your own key, and the clip it picks downloads from there.",
          ],
        },
        {
          heading: "Links you import",
          body: [
            "The app fetches the video from the site the link names, with yt-dlp, which it downloads from GitHub and keeps current. Nothing of yours is sent; the site sees the request from your computer.",
          ],
        },
        {
          heading: "Downloads on first use",
          body: [
            "The app downloads its components from their publishers: Python and the analysis’s packages, the speech and analysis models from Hugging Face, FFmpeg from GitHub, Chrome Headless Shell from Google and icons from npm. These requests carry nothing of your videos.",
          ],
        },
        {
          heading: "Your data and your rights",
          body: [
            "The only personal data we hold is your account. To see it or have it deleted, write to [support@fineframe.app](mailto:support@fineframe.app) from the account’s email address. For the data Anthropic, OpenRouter, Pexels or Pixabay hold, ask them. Questions about this policy: [support@fineframe.app](mailto:support@fineframe.app).",
          ],
        },
        {
          heading: "Changes to this policy",
          body: ["We post any new version of this policy here with its date."],
        },
      ],
    },
    refund: {
      title: "Refund policy",
      description:
        "A plan’s first payment can be refunded within 14 days, once per customer, through Paddle.",
      intro: [
        "Fineframe has no free plan and no free trial. This policy says when a payment for a plan is refunded.",
      ],
      updated: UPD,
      sections: [
        {
          heading: "14 days on a first payment",
          body: [
            "If Fineframe is not right for you, ask within 14 days of the first payment for a plan, and that payment is refunded in full. You don’t need to give a reason.",
          ],
        },
        {
          heading: "One refund per customer",
          body: [
            "Each customer can get this refund once. A later subscription, on either plan, is not refunded again.",
          ],
        },
        {
          heading: "How to ask",
          body: [
            "Fineframe is sold through Paddle.com, the Merchant of Record for every order, so refunds go through Paddle: find your order at [paddle.net](https://paddle.net) and ask there. The refund goes back to the way you paid, and your subscription ends when it is made.",
          ],
        },
        {
          heading: "Renewals",
          body: [
            "Renewals are not refunded. Cancel before a renewal to stop it; the app keeps working until the end of the period you paid for.",
          ],
        },
        {
          heading: "Other services",
          body: [
            "What you pay Anthropic, OpenRouter or any other service on your own keys is between you and them; we cannot refund it.",
          ],
        },
        {
          heading: "Your rights under the law",
          body: [
            `As the Merchant of Record, Paddle also applies its [Buyer Terms](${BUYER}), and the consumer law where you live still applies; either may give you more than this policy does.`,
          ],
        },
        { heading: "About us", body: [SELLER, CONTACT] },
      ],
    },
    credits: {
      title: "Credits",
      description: "Where the footage on fineframe.app comes from.",
      intro: [
        "The home page plays clips of edits Fineframe made from the three videos below, each used under its licence. None of the people or organisations in them endorses Fineframe.",
      ],
      sections: [
        {
          heading: "Don Pettit in the Cupola",
          body: [
            "The footage and the finished Reel at the top of the home page: NASA, “[NASA Astronaut Don Pettit Talks with the Everyday Astronaut](https://images.nasa.gov/details/iss072m263521849_NASA_Astronaut_Don_Pettit_Talks_with_the_Everyday_Astronaut_241217)”, 17 December 2024, in the public domain. NASA does not endorse Fineframe.",
          ],
        },
        {
          heading: "Christina Koch’s Artemis II interview",
          body: [
            "The YouTube edit: NASA, “[Christina Koch Artemis II Crew Announcement Resource Reel](https://images.nasa.gov/details/jsc2023m000095_Christina_Koch_Artemis_II_Crew_Announcement_Resource_Reel-social)”, 3 April 2023, in the public domain. NASA does not endorse Fineframe.",
          ],
        },
        {
          heading: "极客湾Geekerwan’s interview",
          body: [
            "The captions clip: 极客湾Geekerwan, “[采访vivo & MediaTek研发大佬：蓝厂与天玑合作背后的故事](https://www.youtube.com/watch?v=_G4e2p1p-is)”, 4 January 2025, under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) ([file on Wikimedia Commons](https://commons.wikimedia.org/wiki/File:%E9%87%87%E8%AE%BFvivo_%26_MediaTek%E7%A0%94%E5%8F%91%E5%A4%A7%E4%BD%AC%EF%BC%9A%E8%93%9D%E5%8E%82%E4%B8%8E%E5%A4%A9%E7%8E%91%E5%90%88%E4%BD%9C%E8%83%8C%E5%90%8E%E7%9A%84%E6%95%85%E4%BA%8B.webm)). Fineframe cut it to a 44-second vertical edit, captioned it in Traditional Chinese and added music and graphics. Geekerwan, vivo and MediaTek are not affiliated with Fineframe.",
          ],
        },
      ],
    },
  },
  checkout: {
    subscribe: "Subscribe",
    subscribed: "You are subscribed. Manage it from your [account](/account/).",
    failed: "The checkout could not open. Try again in a moment.",
  },
  auth: {
    email: "Email",
    password: "Password", // betterleaks:allow: a field label, not a password
    google: "Continue with Google",
    or: "or",
    working: "One moment…",
    show: "Show password",
    agree:
      "By continuing, you agree to the [terms of service](/terms/) and the [privacy policy](/privacy/).",
    again: "Use a different email",
    home: "Back to the home page",
    signIn: {
      title: "Sign in",
      lede: "Use the account your plan is on.",
      description: "Sign in to your Fineframe account.",
      submit: "Sign in",
      forgot: "Forgot your password?",
      switchPrompt: "New to Fineframe?",
      switchLink: "Create an account",
      forPlan: "Sign in, and the checkout for the {plan} opens.",
    },
    signUp: {
      title: "Create an account",
      lede: "One account for your plan and for the app.",
      description: "Create a Fineframe account to subscribe and sign in to the app.",
      submit: "Create account",
      passwordHint: "At least 8 characters.",
      switchPrompt: "Already have an account?",
      switchLink: "Sign in",
      sentTitle: "Check your inbox",
      sent: "We sent a link to {email}. Open it to confirm your address, and you are signed in.",
      forPlan:
        "Create your account, and the checkout for the {plan} opens once you confirm your email.",
      sentPlan:
        "We sent a link to {email}. Open it to confirm your address, and the checkout for the {plan} opens.",
    },
    reset: {
      title: "Reset your password",
      description: "Get a link to choose a new password for your Fineframe account.",
      lede: "Enter your account’s email, and we will send you a link to choose a new password.",
      submit: "Send the link",
      sentTitle: "Check your inbox",
      sent: "If an account uses {email}, a link to reset its password is on its way.",
      newLede: "Choose a new password for your account.",
      expired: "This link has expired or was used already. Enter your email for a new one.",
      newPassword: "New password", // betterleaks:allow: a field label, not a password
      save: "Save the password",
      back: "Back to sign in",
    },
    errors: {
      invalid: "The email or the password is wrong.",
      unconfirmed: "Confirm your email first: open the link we sent you.",
      weak: "Choose a longer password, of at least 8 characters.",
      leaked: "This password has appeared in a data breach. Choose a different one.",
      address: "This email address can't be used. Try another one.",
      rate: "Too many attempts. Wait a minute and try again.",
      generic: "Something went wrong. Try again.",
    },
  },
  account: {
    title: "Account",
    description: "Your Fineframe subscription, billing and downloads.",
    signedInAs: "Signed in as",
    signOut: "Sign out",
    subscriptionTitle: "Subscription",
    statusTitle: "Status",
    plans: { monthly: "Monthly plan", yearly: "Yearly plan" },
    status: {
      none: "No subscription",
      noneNote: "Fineframe needs an active plan to run.",
      active: "Active",
      renews: "Renews on {date}.",
      cancelled: "Cancelled",
      until: "Fineframe works until {date}.",
      pastDue: "Payment past due",
      pastDueNote:
        "The last payment did not go through. Update your payment method to keep Fineframe working.",
      paused: "Paused",
      ended: "Ended",
      confirming: "Payment received. Confirming your subscription…",
    },
    choose: "Choose a plan",
    manage: "Manage billing",
    manageNote:
      "Change your plan or payment method, see your invoices or cancel, in Paddle’s customer portal.",
    downloadTitle: "Download",
    downloadBody: "Install Fineframe, open it, and sign in with this account.",
    download: "Download Fineframe",
  },
  authorize: {
    title: "Sign in to the app",
    description: "Sign in to the Fineframe app on this computer.",
    lede: "The Fineframe app on this computer asks to sign in as {email}.",
    shares:
      "The app gets this account’s email address and whether its plan is active, never your password.",
    noPlan: "This account has no plan yet. [Choose one](/pricing/) to use Fineframe.",
    allow: "Sign in to the app",
    deny: "Cancel",
    switch: "Use another account",
    done: "Done. You can go back to the app.",
    invalid: "This sign-in request has expired. Start again from the app.",
  },
  notFound: {
    title: "Page not found",
    body: "There is no page at this address.",
    home: "Go to the home page",
  },
};
