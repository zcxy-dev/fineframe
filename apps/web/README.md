# Web page

One page in front of [`pnpm edit`](../../packages/engine/README.md#editing-footage): drop footage and music in, choose the length, the aspect and a style, press start, watch the progress, then play the finished video and download it with its captions.

```bash
pnpm -C apps/web build
pnpm -C apps/web start          # http://127.0.0.1:3000
```

- **Address:** the server listens on 127.0.0.1 only. `VIDEO_EDITOR_HOST` and `PORT` change that, such as `VIDEO_EDITOR_HOST=100.x.y.z` for a private network; the page has no accounts, so never put it on a public address. Requests addressed to any other name are refused, so another site cannot reach the page by resolving its own name to this machine; `VIDEO_EDITOR_ALLOWED_HOSTS` adds names, comma-separated, for a proxy in front such as `tailscale serve`, without changing the address.
- **Inputs:** videos, still images and audio files, dropped as files or whole folders or chosen with a picker. Videos are cut and stills can show as B-roll. Audio files (by their extension, as `pnpm edit` sorts them) are music, passed with [`--music`](../../packages/engine/README.md#editing-footage): Claude picks the track that fits, or none, and the done page names the one the video plays. "Don't use" beside a track leaves it out. Music needs the licence it is used under, such as CC0 1.0, typed once for every track and passed as `--music-license`; use only music you have the right to use. The length is a preset (15 s, 30 s, 1 min, 3 min, 10 min) or typed, from 15 s to 1 h; the aspect is 9:16, 1:1 or 16:9; the style is one of the engine's [looks](../../packages/engine/README.md#colour) or none; names and terms, one per line, help the speech model spell them.
- **Jobs:** each edit gets a folder in `~/.cache/video-editor/jobs/` (`VIDEO_EDITOR_JOBS` moves it), outside the repository. Files stream into it; a name that could leave the folder, a hidden file, a file of another type, a file larger or smaller than announced, and footage that does not fit the free disk space are refused. The footage is deleted when the next edit is created; the outputs stay.
- **One edit at a time:** a second is refused while one runs, before its footage is sent, as one analysis already takes the machine's memory. Requests from another site are refused. Stopping the server stops a running edit.
- **Progress** comes from the command's JSON lines, sent to the page as Server-Sent Events: the stage, a bar that never goes back, and the latest message. The job's id is in the page's address, so a reload or a bookmark opens it again; a running edit keeps going with the page closed.
- **Outputs:** the video plays in the page; MP4 and SRT downloads.
- **Key:** the server passes its environment to `pnpm edit`, which reads `ANTHROPIC_API_KEY` from it or from the git-ignored `.env` at the repository root.
