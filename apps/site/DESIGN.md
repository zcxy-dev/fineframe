---
name: Fineframe site
description: Shoot it, post it. A light feed of bold colour cards, where what moves is footage and the app's own screens.
colors:
  ground: "#f3f4f6"
  paper: "#ffffff"
  ink: "#0c0d10"
  ink-2: "#3d424b"
  ink-3: "#5d636d"
  line: "#dfe2e7"
  amber: "#ffb547"
  amber-hover: "#ffc46d"
  amber-ink: "#3a2a0c"
  steel: "#c9cdd3"
  steel-ink: "#262a31"
  graphite: "#16181c"
  on-dark: "#f2f3f5"
  on-dark-2: "#b4b9c1"
  cut: "#d4472f"
typography:
  hero:
    fontFamily: "Noto Sans TC 900 in Chinese; Geist 700 in English"
    fontSize: "clamp(56px, 7.4vw, 112px); en clamp(48px, 5.6vw, 84px); 50px on phones"
    letterSpacing: "zh 0.01em with palt; en -0.035em"
  section:
    fontSize: "clamp(36px, 4.4vw, 64px)"
  card:
    fontSize: "clamp(24px, 2.2vw, 32px); the cut card clamp(32px, 3.4vw, 50px)"
  body:
    fontFamily: "Geist Variable, Noto Sans TC"
    fontSize: "17px, 16px on phones; lede clamp(17px, 1.3vw, 19px)"
    lineHeight: "1.65; zh 1.8 with 0.02em tracking"
rounded:
  cards: "24px (--r-card)"
  post: "30px, its reel 20px"
  buttons: "pills"
stroke: "1.5px (--stroke): outlines, icons and rules"
spacing:
  gutter: "clamp(16px, 4vw, 32px)"
  section: "clamp(88px, 10vw, 150px) above each home section"
  content: "1240px, 1360px from 1800px"
---

# Design system: Fineframe site

## Overview

**The feed.** The page speaks the language its visitors scroll every day: a light ground with bold colour cards, and a post at the top that plays a Reel. Everything that moves is the product at work: footage being cut into the finished video, filler words falling out of a sentence, music dropping under speech, clips landing on a timeline. Nothing moves for atmosphere alone: no gradients, light beams, grain or rotating words.

The site and the app share one token set, these values. `app/globals.css` holds them as CSS custom properties and Tailwind colours (`bg-paper`, `text-ink-2`, `bg-amber`, …), with the fonts and the type rules. Pages are styled with Tailwind's utilities. The home page's moving parts are in `components/home/home.css`, plain CSS with class names (`.hero`, `.post`, `.card`, `.tl`), because their scroll-driven animations and stacked states read better there than as utilities.

## Colours

- **Ground** #f3f4f6 under everything, **paper** #ffffff for cards and forms, divided by **line** #dfe2e7.
- **Ink** #0c0d10 for headings and the floating button; **ink-2** #3d424b for text; **ink-3** #5d636d for small print. All at least 4.5:1 on ground and paper.
- **Amber** #ffb547, from the app's icon: the primary action and a whole card (the cut card, the closing call), with **amber-ink** #3a2a0c for text on it.
- **Graphite** #16181c and **steel** #c9cdd3 are the other two card colours, with **on-dark** text and **steel-ink** text on them.
- **Cut** #d4472f marks what the edit removes (struck filler words), the timeline's playhead and errors.

## Typography

Geist (variable) sets Latin text and numbers; Noto Sans TC sets Chinese. English headings take Geist 700 at -0.035em; Chinese headings take Noto Sans TC 900 with `palt`. Text is 400, labels and buttons 600. `scripts/fonts.ts` cuts both families to the characters the site's source uses and writes them, with their rules, at build time.

Line breaks are part of the design, on every page and at every width:

- **Headings** have no punctuation. A two-line heading is written as its two lines (`Lines` in `lib/content.ts`), each kept whole (`.ln`).
- **Chinese** breaks only between phrases, never inside a word (`lib/typeset.ts`): BudouX finds the phrases, a break stays only where ICU's dictionary also ends a word, numbers stay with their units and names stay whole. Each phrase is a `.w` span with a `<wbr>` between. No last line is one character, or one character and a mark.
- **English** keeps its last two words together (`lib/english.ts`), so no last line is one word.
- A space separates Chinese from Latin text (`content/content.test.ts` checks it).
- No `text-wrap: pretty`: WebKit draws some Chinese lines twice with it.

## Layout and components

- **Bar** (`components/Frame.tsx`): sticky, translucent ground; the wordmark, the home page's sections (from 1081 px), the other language as a link with a globe, Sign in (or Account once signed in) outlined as a pill from 640 px and a link on phones, and the amber See plans, which the pricing, sign-in and account pages leave out.
- **Download buttons** (`components/Download.tsx`) know the visitor's device (`lib/device.ts`, set on `<html data-device>` before the first paint): on a Mac, Windows or Linux computer they download its installer, named for it, with its requirement on the line under them; on a phone or tablet they lead to the download page. Where the device is not known (no JavaScript, crawlers, other systems) they lead there too and the page lists all three computers.
- **Download page:** on a computer, only that computer's card, with its steps and how it updates; elsewhere the three side by side.
- **Hero:** the headline and lede on the left, the buttons and the platforms under them, and on the right the **post** (`components/home/Reel.tsx`). On phones the order is headline, post, buttons, so the first screen shows the edit.
- **Feature cards:** the cut card largest in amber, captions on graphite with its 9:16 clip, music on steel; on phones they scroll sideways and snap.
- **YouTube section:** the 16:9 edit, its spec list, and the edit's four-track timeline (`components/home/WideEdit.tsx`).
- **Privacy:** a graphite card: the heading across it, then what stays on the computer, and, on amber, what goes to Claude.
- **Plans** (`components/Plans.tsx`), the same on the home page, the pricing page and the account page: two raised paper cards, each with its name, price, billing line, a full-width button and the terms under it beside a shield. The yearly plan, which costs less, is ringed in amber with its saving on an amber tag and the amber button; monthly's is outlined. Until a checkout can open, the button's place holds "Opening soon", flat on ground. What both include is a paper card of four, each on an icon tile. The hero's button, the bar's and the floating one lead to the plans. **FAQ** (`components/Faq.tsx`) on `<details>`, on the home and pricing pages.
- **Pricing page:** a centred two-line heading and lede, then, in one 1000 px column, the plans, what both include, the three steps after subscribing (numbered: they happen in order), what Claude costs beside refunds, and the FAQ. **Close:** an amber card with See plans and the download, and what running the app needs.
- **Inner pages** open with `PageHead` and set their content on paper cards (`CARD` in `lib/styles.ts`); legal pages and the credits use `components/Legal.tsx`.
- **Sign-in, sign-up, reset and authorize** stand in one 460 px column: the app's icon, the centred heading, and the form on a raised card (`RAISED`: a line ring and a soft shadow). The **account page** keeps the page's width: the subscription (who is signed in, the status on a pill with its dot, then managing billing and signing out under a rule) beside the download, and, until the account has a plan, the plans under them.
- **Buttons** (`components/ui/button.tsx`): pills, amber, ink-outlined or ink; they lift a pixel on hover.
- **Footage** is credited beside it in a short form; the full credits are on `/credits/`.

## Motion

- **The post:** the 22:42 source plays as amber cut marks land on its cut line, the cut stretches close up and the timecode counts to 0:50; a 9:16 frame follows the speaker, the camera pushes into it and the finished Reel plays. Four bars above fill with each step. It starts after the page has loaded, and a button pauses it.
- **The cut card:** fillers turn red, are struck through and close up out of the sentence as the length counts from 1:12 to 1:00.
- **The music card:** the voice on top, the music under it dropping while someone talks, flowing left.
- **Scroll:** the post lifts away, the cards fly in, the YouTube player straightens, the timeline's clips land on their tracks, and what goes to Claude comes in line by line (CSS scroll timelines). Where a browser has no scroll timelines, everything stands as it ends.
- **Floating See plans:** on phones, a black pill across the bottom while neither the post, the hero's buttons, the closing call nor the footer is on screen.
- Video loads only when needed: posters as a video comes near, sources as it is about to show, the small copy on phones and wherever it is sharp enough. Loops play only on screen.
- **Reduced motion:** nothing moves. The post shows the finished Reel with its bars full and plays it only from its button; the cut card shows the cut sentence; the music holds still; the clips show their first frame with the browser's controls; the scroll pieces stand as they end.

## Do's and don'ts

- Do show the product working: footage, finished edits and the app's own screens.
- Do give each section one idea, and say each thing once.
- Do keep the home page to these three source videos, each used once: Don Pettit's talk (the post), 极客湾Geekerwan's interview (captions) and Christina Koch's interview (YouTube).
- Don't animate text alone, or add atmosphere: gradients, beams, grain, glows.
- Don't add stock imagery, logos, testimonials, user counts or numbers the app has not measured.
- Don't label the drawn timeline or the sample sentence as anything but what they are: the sample is marked as one.
