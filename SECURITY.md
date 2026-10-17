# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue.

Useful details:
- what is affected (package, file or command)
- how to reproduce it
- the impact you expect

## Scope

The tools here read media files you give them and run models locally. Planning an edit and opt-in transcript correction (`vework analyze --correct`) send transcripts and metadata to the Anthropic API with your key, and the check after each render sends a picture of the frames and waveform around each cut; opt-in cloud speech (`vework analyze --asr cloud`) sends the speech audio, in chunks of at most 30 s, to OpenRouter with your key, for the model's provider to transcribe. No video file is uploaded, and no audio without cloud speech ([what is sent](README.md#what-works-today)).

B-roll sourcing ([`packages/engine/src/broll`](packages/engine/README.md#b-roll-sourcing)) fetches from the web, and sends nothing of the video:
- **Web capture** opens the public http or https page it is given in Chrome Headless Shell, with a fresh profile each time. It refuses other schemes, addresses with a user name or password, and any request to `localhost` or a private, link-local or reserved address: the page's own, each hop of a redirect, everything the page loads and its WebSockets, checked by name and by the addresses the name resolves to. A name that resolves differently between the check and the request is not caught. It never fills a form, logs in or accepts a consent banner; it hides the banner instead.
- **Stock footage** sends the search words to Pexels or Pixabay with your own `PEXELS_API_KEY` or `PIXABAY_API_KEY`, and downloads the clip it picks over https. Searches are cached for 24 hours without the key.
- **Icons** download three npm tarballs from the npm registry, each checked against its SHA-256.

Especially welcome:
- **Media parsing:** malformed media files that lead to code execution, path traversal or runaway resource use.
- **Dependencies:** issues in pinned dependencies or downloaded model weights that affect this project.
- **API keys:** ways the tools could leak your Anthropic, OpenRouter, Pexels or Pixabay key, or send any of them more than the data described above.
- **Web capture:** ways a page or address could make a capture reach the local network, read local files or act as the user.

## Supported versions

The project is pre-release; fixes land on `main`.
