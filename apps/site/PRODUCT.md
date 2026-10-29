# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Creators who have footage and want a finished video without editing it by hand. The first market is Taiwanese and Mandarin-speaking creators, who often speak Mandarin and English in the same video. Visitors arrive deciding whether to subscribe to a desktop app and bring their own Anthropic API key.

## Product Purpose
fineframe.app sells and explains Fineframe, a proprietary desktop app for macOS on Apple silicon, Windows and Linux that edits footage into a finished video automatically: cut, captioned, framed, graded, scored and animated. The site's job is to make that offer clear and believable and to sell the subscription. It also carries the legal pages, accounts (Supabase) and the Paddle checkout.

## Positioning
The edit is made end to end with no timeline to touch: analysis and rendering run on the user's own computer, Claude plans the edit and checks every cut on the user's own key, and it is built for Mandarin, English and speech that switches between them, with captions in Taiwan Traditional Chinese.

## Operating Context
- There is no free plan and no free trial. Two plans, US$15 a month and US$120 a year, are the same full app; buying needs a free account. Until purchases open (`app_config.billing_enabled`), the plans say "Opening soon". Anyone can download the installers; the app needs an active plan to run.
- The user pays Anthropic directly for Claude: about US$0.20 to 0.60 for an edit of a minute or less, US$1 to 1.20 for five minutes.
- The site is a static Next.js export on Cloudflare Pages, in English and Traditional Chinese at equal quality.

## Capabilities and Constraints
- Every product claim must be true of the app on its `main` branch: the app repository's README and merged pull requests are the source. Features not merged are not claimed.
- No tracking or analytics, no cookies of the site's own; fonts are self-hosted.
- Media files stay within Cloudflare Pages' 25 MiB per-file limit.

## Brand Commitments
The name is Fineframe. Its icon (`public/icon.svg`) is graphite and steel with one amber line; the site and the app share one light token set ([DESIGN.md](DESIGN.md)): ink on a light ground, with amber #ffb547, graphite and steel. The owner asked for a professional site: its design is Fineframe's own, with the price stated plainly, the product shown working, and English and Traditional Chinese at equal quality. (Inferred from the owner's brief as relayed; not from an interview.)

## Evidence on Hand
- In `public/media/`, from edits Fineframe made: Don Pettit's 22-minute talk from the space station's Cupola and the opening of the 9:16 short made of it (the hero's post), and a loop of the 59 s 16:9 edit of Christina Koch's Artemis II interview (the YouTube section), both public-domain NASA videos, shown with a short credit and the line that NASA does not endorse Fineframe; and a loop of the 44 s 9:16 edit of 极客湾Geekerwan's CC BY 3.0 Mandarin interview (the captions card), shown with its credit and the line that it is not affiliated. The full credits are on `/credits/`.
- Pictures the home page draws of what the app does (a sample sentence with its fillers cut, marked as a sample; the music lowered under speech; the YouTube edit's timeline).
- No testimonials, customers, ratings or usage numbers exist; none may be invented. Comparisons with competitors are not made.

## Product Principles
- Show the edit, not adjectives: real output carries the page.
- Say plainly what leaves the computer and what Claude costs.
- One honest offer: prices stated, nothing hidden, no free plan to upsell from.
- English and Traditional Chinese are equals, never a translation afterthought.

## Accessibility & Inclusion
WCAG 2.2 AA: contrast, keyboard operation, zoom and `prefers-reduced-motion`.
