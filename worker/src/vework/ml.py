def require() -> None:
    """Fail with install instructions when the `ml` group is missing."""
    try:
        # Not just torch: an environment synced before a package joined the extra lacks only it,
        # and finding that out at the audio events would waste the shot detection before them.
        import beat_this  # noqa: F401
        import cv2  # noqa: F401
        import huggingface_hub  # noqa: F401
        import onnxruntime  # noqa: F401
        import torch  # noqa: F401
    except ImportError as exc:
        raise RuntimeError("model analysis needs the ml group: run `uv sync` in worker/") from exc
