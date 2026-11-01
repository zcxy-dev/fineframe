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
  edge: "#868c96"
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
  display:
    fontSize: "clamp(44px, 5.6vw, 84px); zh clamp(48px, 6.6vw, 96px)"
    lineHeight: 1.02
    use: "the hero's headline and the closing card's"
  title:
    fontSize: "clamp(36px, 4.4vw, 60px)"
    lineHeight: 1.08
    use: "a page's h1, a home section's h2, the cut card's heading"
  heading:
    fontSize: "clamp(26px, 2.4vw, 34px)"
    lineHeight: 1.15
    use: "a section's h2 on an inner page, a feature card's h3, the sign-in heading, a download card's computer"
  subhead:
    fontSize: "clamp(19px, 1.6vw, 22px)"
    lineHeight: 1.3
    use: "a paper card's heading, a legal clause's heading"
  lede:
    fontSize: "clamp(17px, 1.3vw, 19px)"
    lineHeight: 1.6
    use: "the sentence under a title"
  body:
    fontSize: "17px; 16px on phones"
    lineHeight: "1.65; zh 1.8 with 0.02em tracking"
    use: "running text, inputs, 48 px buttons"
  small:
    fontSize: "15px"
    lineHeight: 1.55
    use: "secondary text, notes, the bar and the footer, labels, 40 px buttons"
  fine:
    fontSize: "13px"
    lineHeight: 1.5
    use: "hints, credits, the plans' terms, file names"
  slug:
    fontSize: "11px; zh 12px"
    fontWeight: 600
    letterSpacing: "0.1em; zh 0.16em"
    textTransform: uppercase
    use: "micro-labels (SLUG), and an amber dot before one that opens a section (EYEBROW)"
  faces: "Geist Variable for Latin and numbers, Noto Sans TC for Chinese; headings Geist 700 at -0.035em (subhead -0.015em), zh Noto Sans TC 900 at 0.01em with palt"
rounded:
  field: "8px: inputs, code, icon tiles"
  frame: "16px: notices, frames inside a card, the reel, the 9:16 clip"
  card: "24px: cards, the post, the player, the timeline"
  pill: "buttons, tags, status pills"
elevation:
  card: "0 1px 2px rgb(12 13 16 / 0.05), with a 1px line edge: a paper card"
  raised: "0 1px 2px rgb(12 13 16 / 0.04), 0 20px 44px -20px rgb(12 13 16 / 0.22), with the edge: a form, a plan, the post, the player, the floating button"
stroke: "1.5px (--stroke): outlines, icons and rules"
spacing:
  steps: "Tailwind's 4 px steps: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64"
  gutter: "clamp(16px, 4vw, 32px)"
  section: "clamp(80px, 9vw, 136px) above each home section"
  block: "clamp(48px, 6vw, 88px) between blocks on an inner page"
  head: "clamp(40px, 6vw, 88px) above an inner page's title"
  end: "clamp(64px, 8vw, 120px) under an inner page's last block"
  card: "clamp(24px, 2.6vw, 36px) inside a card"
  content: "1240px, 1360px from 1800px"
components:
  button-primary: "48 px amber pill, ink label; the page's one primary action"
  button-outline: "48 px paper pill, 1.5px edge that turns ink on hover; every other action"
  button-dark: "48 px ink pill, on an amber card"
  button-sm: "40 px, the same three"
  input: "48 px, 8 px radius, 1.5px edge (3.4:1 on paper), ink on hover and focus, the focus ring outside"
---

# Design system: Fineframe site

## Overview

**The feed.** The page speaks the language its visitors scroll every day: a light ground with bold colour cards, and a post at the top that plays a Reel. Everything that moves is the product at work: footage being cut into the finished video, filler words falling out of a sentence, music dropping under speech, clips landing on a timeline. Nothing moves for atmosphere alone: no gradients, light beams, grain or rotating words.

The site and the app share one token set, these values. `app/globals.css` holds them as CSS custom properties and Tailwind theme values (`bg-paper`, `text-ink-2`, `text-title`, `rounded-card`, `shadow-raised`, `pt-head`, …), with the fonts and the type rules; it clears Tailwind's own text sizes, radii and shadows, so a page can only reach for the scales below. `lib/styles.ts` holds the class lists several components share (`CARD`, `SLUG`, `EYEBROW`, `NOTICE`, …), `lib/cn.ts` the class merger that knows the scales, and `components/ui/` the button, the input and the label. Pages are styled with Tailwind's utilities. The home page's moving parts are in `components/home/home.css`, plain CSS with class names (`.hero`, `.post`, `.card`, `.tl`), because their scroll-driven animations and stacked states read better there than as utilities; it takes the same scales as `var(--text-title)`, `var(--radius-card)` and so on.

A value off these scales is a bug, with two exceptions: the wordmark, which is a logo, and the drawings of the app at work (the sample sentence, the timecode, the timeline's clips), which are pictures of another screen.

## Colours

- **Ground** #f3f4f6 under everything, **paper** #ffffff for cards and forms, divided by **line** #dfe2e7. **Edge** #868c96 outlines what a visitor operates, a field or an outlined button: 3.4:1 on paper and 3.1:1 on ground, so it meets WCAG 1.4.11; line is for what only divides.
- **Ink** #0c0d10 for headings and the floating button; **ink-2** #3d424b for text; **ink-3** #5d636d for small print. All at least 4.5:1 on ground and paper.
- **Amber** #ffb547, from the app's icon: the primary action and a whole card (the cut card, the closing call), with **amber-ink** #3a2a0c for text on it.
- **Graphite** #16181c and **steel** #c9cdd3 are the other two card colours, with **on-dark** text and **steel-ink** text on them.
- **Cut** #d4472f marks what the edit removes (struck filler words), the timeline's playhead and errors.

## Typography

Geist (variable) sets Latin text and numbers; Noto Sans TC sets Chinese. English headings take Geist 700 at -0.035em, a subhead -0.015em; Chinese headings take Noto Sans TC 900 with `palt`, and SemiBold (600) at `heading` and `subhead`, where Black clogs. Text is 400, labels and buttons 600. `scripts/fonts.ts` cuts both families to the characters the site's source uses and writes them, with their rules, at build time.

**The scale** has eight sizes and the slug, as Tailwind's `text-*` (front matter for the values). Each step is at least a fifth larger than the one under it, so two sizes never sit close enough to look like a mistake:

- `display`: the hero's headline and the closing card's, nowhere else.
- `title`: a page's h1 and a home section's h2. One per screen.
- `heading`: a section's heading on an inner page, a feature card's, the sign-in page's.
- `subhead`: a card's heading, a legal clause's.
- `lede`: the sentence under a title or a section's heading.
- `body`: running text, fields and 48 px buttons.
- `small`: secondary text, notes, labels, the bar, the footer and 40 px buttons.
- `fine`: hints under a field, credits, the plans' terms, file names.

**The slug** (`SLUG`, as the app's) is the micro-label: 11 px semibold capitals at 0.1em in the ground's small-print colour (ink-3, on-dark-2 on graphite, amber-ink on amber); Chinese, which has no capitals, at 12 px and 0.16em. It names a block that has no heading of its own (a footer column, what stays on the computer, a field group) or, as the **eyebrow** (`EYEBROW`, after a 6 px amber dot), the section a heading opens, as the bar names it. It never repeats the heading under it, never stands over a page's h1, and never labels a field: field labels are sentence case.

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
- **Plans** (`components/Plans.tsx`), the same on the home page, the pricing page and the account page: two raised cards, each with its name, price, billing line, a full-width button and the terms under it beside a shield. The yearly plan, which costs less, is ringed in amber with its saving on an amber tag and the amber button; monthly's is outlined. Until a checkout can open, the button's place holds "Opening soon", flat on ground. What both include is a paper card of four, each on an icon tile. The hero's button, the bar's and the floating one lead to the plans. **FAQ** (`components/Faq.tsx`) on `<details>`, on the home and pricing pages.
- **Pricing page:** a centred two-line heading and lede, then, in one 1000 px column, the plans, what both include, the three steps after subscribing (numbered: they happen in order), what Claude costs beside refunds, and the FAQ. **Close:** an amber card with See plans and the download, and what running the app needs.
- **Inner pages** open with `PageHead` and set their content on paper cards (`CARD` in `lib/styles.ts`); legal pages and the credits use `components/Legal.tsx`.
- **Sign-in, sign-up, reset and authorize** stand on their own (`components/account/AccountFrame.tsx`): a quiet bar with the wordmark and the other language, then one 440 px column with the centred heading (`heading`) and its one-line lede, the form on a raised card, and the way to the other form under it; a hairline footer holds the year and the terms, privacy and refund links. Nothing else leads away. In the card: Google's button (outlined, with Google's own multicolour "G", as its guidelines ask), a rule with "or", the fields with their labels above and hints under them, any error (cut-edged, and the fields it concerns `aria-invalid`), the amber submit, and the line saying what continuing agrees to, which covers Google too. Only the button at work says "One moment…". The password field has a toggle that shows what is typed. **Link sent** (sign-up, reset): the card becomes an amber mail tile, "Check your inbox", where the link went, and a way on: another address, home or back to sign in. The reset page's lede says what the step asks; a link that has expired says so over the email field. The **account page** keeps the page's width: the subscription (who is signed in, the status on a pill with its dot, then managing billing and signing out under a rule) beside the download, and, until the account has a plan, the plans under them.
- **Buttons** (`components/ui/button.tsx`): pills, 48 px or 40 px (`sm`), in three styles. Amber for the page's one primary action; outlined, a paper pill with an edge that turns ink on hover, for every other action, the bar's Sign in included; ink on an amber card. They lift a pixel on hover. There is no other button style: a choice that is not an action is a link.
- **Fields** (`components/ui/input.tsx`): 48 px, the 8 px radius, a 1.5 px edge that turns ink on hover and focus, with the site's focus ring (2 px of ink, 2 px off the field). An error turns the edge cut and says what went wrong under the field. Labels (`components/ui/label.tsx`) are `small` semibold over their field.
- **Surfaces:** the ground; a paper card on it (`CARD`: a 1 px line edge, the `card` shadow, 24 px corners, the `card` padding); a raised card that stands off it (`CARD` and `RAISED`: the `raised` shadow), for a form on its own, a plan, the post and the player. Inside paper, a note or a tile sits on ground (`NOTICE`, 16 px corners). The colour cards (amber, graphite, steel) carry no edge or shadow: their colour is the edge. Cards never nest.
- **Focus:** one ring everywhere, 2 px of ink 3 px off the element, following its corners; on graphite (`.on-dark`) it turns light.
- **Footage** is credited beside it in a short form; the full credits are on `/credits/`.
- **Share card** (`app/[locale]/og.png/route.tsx`, 1200 × 630, one per language): the wordmark, the hero's headline and lede and an amber-dotted `FINEFRAME.APP` on the ground, and on the right the post with a frame of the finished Reel over its credit. Every page shares its language's card; `/` shares the English one.

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
