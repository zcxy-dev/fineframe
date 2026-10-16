# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue.

Useful details:
- what is affected (package, file or command)
- how to reproduce it
- the impact you expect

## Scope

The tools here read media files you give them and run models locally. Planning an edit and opt-in transcript correction (`vework analyze --correct`) send transcripts and metadata to the Anthropic API with your key, and the check after each render sends a picture of the frames and waveform around each cut; opt-in cloud speech (`vework analyze --asr cloud`) sends the speech audio, in chunks of at most 30 s, to OpenRouter with your key, for the model's provider to transcribe. No video file is uploaded, and no audio without cloud speech ([what is sent](README.md#what-works-today)). Especially welcome:
- **Media parsing:** malformed media files that lead to code execution, path traversal or runaway resource use.
- **Dependencies:** issues in pinned dependencies or downloaded model weights that affect this project.
- **API keys:** ways the tools could leak your Anthropic or OpenRouter key, or send either service more than the data described above.

## Supported versions

The project is pre-release; fixes land on `main`.
