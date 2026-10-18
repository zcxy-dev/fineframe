# Builds the desktop app's and the page's icons from the brand files beside this script:
#
#   uv run --no-project --with pillow==13.0.0 python brand/icons.py
#
# icon-1024.png is icon.svg rendered in Chrome; 16, 32 and 128 px come from their own
# pixel-aligned versions rather than from scaling it down.
import io
import struct
from pathlib import Path

from PIL import Image

brand = Path(__file__).parent
repo = brand.parent
big = Image.open(brand / "icon-1024.png").convert("RGBA")
exact = {size: brand / f"icon-{size}.png" for size in (16, 32, 128)}


def png(size: int) -> bytes:
    if size in exact:
        image = Image.open(exact[size]).convert("RGBA")
    else:
        image = big if size == 1024 else big.resize((size, size), Image.LANCZOS)
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)
    return out.getvalue()


def ico(path: Path, sizes: list[int]) -> None:
    datas = [png(size) for size in sizes]
    offset = 6 + 16 * len(sizes)
    entries = b""
    for size, data in zip(sizes, datas, strict=True):
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    path.write_bytes(struct.pack("<HHH", 0, 1, len(sizes)) + entries + b"".join(datas))


# electron-builder's places: the Linux set in icons/, then macOS's and Windows' own files.
assets = repo / "apps" / "desktop" / "assets"
(assets / "icons").mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 64, 128, 256, 512, 1024):
    (assets / "icons" / f"{size}x{size}.png").write_bytes(png(size))

ICNS = [
    (b"icp4", 16),
    (b"icp5", 32),
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic13", 256),
    (b"ic09", 512),
    (b"ic14", 512),
    (b"ic10", 1024),
]
body = b"".join(
    kind + struct.pack(">I", 8 + len(data)) + data
    for kind, data in ((kind, png(size)) for kind, size in ICNS)
)
(assets / "icon.icns").write_bytes(b"icns" + struct.pack(">I", 8 + len(body)) + body)
ico(assets / "icon.ico", [16, 32, 48, 256])
ico(repo / "apps" / "web" / "app" / "favicon.ico", [16, 32])
