# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue.

Useful details:
- what is affected (package, file or command)
- how to reproduce it
- the impact you expect

## Scope

The tools here read media files you give them and run models locally. Planning sends Anthropic, with your key, each file's transcript with its name, length, frame size, shot changes, pauses, loudness peaks and audio events, the people's names you list, and for music you offer, each track's file name, length, tempo, sections' loudness and licence name. The review after each render sends, for every cut, a picture of eight frames and the waveform of the two seconds around it, with the words on either side. For each callout planned on a screen recording, one frame of it is sent with the line said over it. Opt-in transcript correction (`vework analyze --correct`) sends the transcript, the video's title (by default the file name) and your glossary. Opt-in cloud speech (`vework analyze --asr cloud`) sends OpenRouter, with your key, the speech itself, as audio in chunks of at most 30 s, for the model's provider to transcribe. No video file is uploaded, and no audio without cloud speech.

B-roll sourcing ([`packages/engine/src/broll`](packages/engine/README.md#b-roll-sourcing)) fetches from the web, and sends nothing of the video. A rich edit (`pnpm edit --visuals rich`, the default) uses it while planning: it opens each page Claude names from the transcript and sends the search words Claude writes for stock footage; `--visuals minimal` fetches nothing:
- **Web capture** opens the public http or https page it is given in Chrome Headless Shell, with a fresh profile each time. It refuses other schemes, addresses with a user name or password, and any request to `localhost` or a private, link-local or reserved address: the page's own, each hop of a redirect, everything the page loads and its WebSockets, checked by name and by the addresses the name resolves to. A name that resolves differently between the check and the request is not caught. It never fills a form, logs in or accepts a consent banner; it hides the banner instead.
- **Stock footage** sends the search words to Pexels or Pixabay with your own `PEXELS_API_KEY` or `PIXABAY_API_KEY`, and downloads the clip it picks over https. Searches are cached for 24 hours without the key.
- **Icons** download three npm tarballs from the npm registry, each checked against its SHA-256.

Especially welcome:
- **Media parsing:** malformed media files that lead to code execution, path traversal or runaway resource use.
- **Dependencies:** issues in pinned dependencies or downloaded model weights that affect this project.
- **API keys:** ways the tools could leak your Anthropic, OpenRouter, Pexels or Pixabay key, or send any of them more than the data described above.
- **Web capture:** ways a page or address could make a capture reach the local network, read local files or act as the user.

## Supported versions

Fixes land on `main` and ship in the next release; only the latest release is supported. The desktop app does not update itself: install the newest release.
