# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue.

Useful details:
- what is affected (package, file or command)
- how to reproduce it
- the impact you expect

## Scope

The tools here read media files you give them and run models locally. Planning sends Anthropic, with your key, each file's transcript with its name, length, frame size, shot changes, pauses, loudness peaks and audio events, the people's names you list, and for music you offer, each track's file name, length, tempo, sections' loudness and licence name. Finding the moments for several shorts (`pnpm edit --shorts`) sends the same of every file but the names, and what you ask of the shorts. The review after each render sends, for every cut, a picture of eight frames and the waveform of the two seconds around it, with the words on either side. For each callout planned on a screen recording, one frame of it is sent with the line said over it. Opt-in transcript correction (`vework analyze --correct`) sends the transcript, the video's title (by default the file name) and your glossary. Opt-in cloud speech (`vework analyze --asr cloud`) sends OpenRouter, with your key, the speech itself, as audio in chunks of at most 30 s, for the model's provider to transcribe. No video file is uploaded, and no audio without cloud speech.

B-roll sourcing ([`packages/engine/src/broll`](packages/engine/README.md#b-roll-sourcing)) fetches from the web, and sends nothing of the video. A rich edit (`pnpm edit --visuals rich`, the default) uses it while planning: it opens each page Claude names from the transcript and sends the search words Claude writes for stock footage; `--visuals minimal` fetches nothing:
- **Web capture** opens the public http or https page it is given in Chrome Headless Shell, with a fresh profile each time. It refuses other schemes, addresses with a user name or password, and any request to `localhost` or a private, link-local or reserved address: the page's own, each hop of a redirect, everything the page loads and its WebSockets, checked by name and by the addresses the name resolves to. A name that resolves differently between the check and the request is not caught. It never fills a form, logs in or accepts a consent banner; it hides the banner instead.
- **Motion graphics** are HTML and CSS Claude writes for each edit, from a transcript that could carry text meant to steer it. Three things hold, whatever the markup says, because Chrome runs them with `--no-sandbox`:
  - **The markup is parsed, not matched.** An HTML parser reads it against an allowlist: text and box elements, images only of the bundled icons and logos, and `class` and `style` attributes; comments, doctypes and CDATA are refused. A CSS parser reads its styles and style attributes: only `@keyframes` and `@property`, no `url()`, `@import` or `@font-face` of its own, and no text written by CSS (`content:` or counters). A brand kit's face reaches the page through the renderer's own `@font-face`, from the page's folder. What fails is refused before it renders, and the page is built from the parse, so the browser gets only what was checked.
  - **No script of Claude's runs.** Each page's Content-Security-Policy allows no script; the renderer adds the SHA-256 of each inline script in the page it serves (HyperFrames' own runtime, and in a brand kit's look the effects' own script that keeps text readable), so a script added any other way is refused. It loads styles, fonts and images only from the page's own folder.
  - **Nothing leaves the page's folder.** In the Chrome that checks graphics and in the one HyperFrames renders them in, every page's requests are intercepted from outside it: only those to the loopback address the page is served from get through, and every other request and navigation is aborted. HyperFrames itself fetches remote images, media and scripts named in a page before rendering it; the effects renderer refuses any graphic whose markup the allowlist refuses, so none reaches it.
- **Stock footage** sends the search words to Pexels or Pixabay with your own `PEXELS_API_KEY` or `PIXABAY_API_KEY`, and downloads the clip it picks over https. Searches are cached for 24 hours without the key.
- **Icons** download three npm tarballs from the npm registry, each checked against its SHA-256.
- **Chrome Headless Shell** downloads Google's Chrome for Testing archive of a pinned build, checked against its SHA-256 for each platform before it is unpacked.

Brand kits ([`packages/engine/src/brand`](packages/engine/README.md#brand-kits)) take files a person uploads on the page or puts in a kit folder, which stay on the computer:
- **Logos.** A PNG is read only for its size and decoded by FFmpeg. An SVG is parsed as XML against an allowlist of shapes, text, gradients, clips and masks: styles of any kind, scripts, event handlers, `foreignObject`, images, doctypes, every processing instruction but the XML declaration, and any attribute that loads another file once its entities and CSS escapes are decoded are refused. When an edit renders, it is drawn to a PNG in the same guarded Chrome the graphics render in, as an image, which runs no script and loads nothing; the page's server never starts a browser for a kit.
- **Fonts.** A TrueType or OpenType file of up to 64 MB is read by the engine's own parser, each table and every glyph width and character-map entry checked to lie inside it, before it is used. libass then draws captions with it, and Chrome loads it into the graphics' pages from the page's folder, where Chrome's font sanitiser checks it again.
- **Names and paths.** A kit is addressed by an id the server made, never by its name; an uploaded font is stored under a name made safe for any file system and its content's hash; every file a kit names must lie inside its folder.

Link import ([`packages/engine/src/link.ts`](packages/engine/README.md#editing-footage)), in the page and in `pnpm edit`, fetches a public video from the link the user gives, and sends nothing of the user's own:
- **yt-dlp** is downloaded from its GitHub releases and kept current: before each link, it reads the latest release's `SHA2-256SUMS`, and a new release's standalone binary is checked against its SHA-256 before it is kept or run; a partial or mismatched download is deleted. When GitHub cannot be reached, the binary kept from before runs.
- **The video** is fetched by that yt-dlp from the site the link names, and from whatever hosts the site sends it to. yt-dlp runs with no configuration file, never reads cookies from a file or a browser, and gets the link as an argument after `--`, never through a shell. For YouTube it runs the site's JavaScript challenge in the Node that runs the editor, with yt-dlp's own solver scripts. Reading a link (its title and length, as the page lists it) also contacts the site. A link is refused unless it is `http` or `https`; yt-dlp may follow it to any address, the local network's included.

Especially welcome:
- **Media parsing:** malformed media files, logos or fonts that lead to code execution, path traversal or runaway resource use.
- **Dependencies:** issues in pinned dependencies or downloaded model weights that affect this project.
- **API keys:** ways the tools could leak your Anthropic, OpenRouter, Pexels or Pixabay key, or send any of them more than the data described above.
- **Web capture:** ways a page or address could make a capture reach the local network, read local files or act as the user.

## Supported versions

Fixes land on `main` and ship in the next release; only the latest release is supported. On Windows and Linux the desktop app updates itself; on a Mac, install the newest version from the [download page](https://fineframe.app/en/download/).
