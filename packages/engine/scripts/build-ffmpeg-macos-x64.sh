#!/usr/bin/env bash
# Builds the static FFmpeg the renderer pins for Intel Macs from the sources pinned below, with
# libass, libx264, libvpx and zimg and nothing nonfree, so the binary may be redistributed under
# GPL-2.0-or-later. Writes into the folder given: `ffmpeg`, `sources.tar.gz` (every source it
# was built from and this script, the corresponding source the GPL asks for) and `SHA256SUMS`.
# .github/workflows/ffmpeg-macos-x64.yml runs it on GitHub's macos-15-intel runner. It needs
# Xcode, Python 3, pkg-config, and autoconf, automake and libtool for zimg.
set -euo pipefail

[[ $(uname -s) == Darwin && $(uname -m) == x86_64 ]] || { echo "Run this on an Intel Mac." >&2; exit 1; }
[[ $# == 1 ]] || { echo "usage: $0 <output folder>" >&2; exit 2; }
mkdir -p "$1"
out=$(cd "$1" && pwd)
work=$(mktemp -d)
src=$work/sources
prefix=$work/prefix
mkdir -p "$src" "$prefix"

# Tarballs by URL and SHA-256; repositories without one by tag and the commit it must be.
TARBALLS="
nasm 1412a1c760bbd05db026b6c0d1657affd6631cd0a63cddb6f73cc6d4aa616148 https://www.nasm.us/pub/nasm/releasebuilds/2.16.03/nasm-2.16.03.tar.xz
freetype 36bc4f1cc413335368ee656c42afca65c5a3987e8768cc28cf11ba775e785a5f https://download.savannah.gnu.org/releases/freetype/freetype-2.14.3.tar.xz
fribidi 6949dcde27d41cebad1fd741fcafc36d55a1020d2d872d4a6eb3914caabbada2 https://github.com/fribidi/fribidi/releases/download/v1.0.17/fribidi-1.0.17.tar.xz
harfbuzz d07a007327277708a2a73ae437887cdbaf282937f6d03ca5467723e9099af586 https://github.com/harfbuzz/harfbuzz/releases/download/14.6.0/harfbuzz-14.6.0.tar.xz
libass 2dca25c0e0c837ddf00b52011b3f82cac1e4ddd3ad018227806b0c2288864acc https://github.com/libass/libass/releases/download/0.17.5/libass-0.17.5.tar.xz
ffmpeg de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz
"
REPOSITORIES="
x264 stable b35605ace3ddf7c1a5d67a2eb553f034aef41d55 https://code.videolan.org/videolan/x264.git
libvpx v1.17.0 6df3ec34557879fff673706f4a1d9fbd0f3a6f0e https://github.com/webmproject/libvpx.git
zimg release-3.0.6 f819b14e8f39d1282400b0d9543e8ef73c1b2bbd https://github.com/sekrit-twc/zimg.git
"
# Build tools from PyPI, by exact version.
MESON=1.12.1
NINJA=1.13.2

while read -r name sha256 url; do
  [[ -n $name ]] || continue
  file=$src/${url##*/}
  curl -fsSL --retry 3 -o "$file" "$url"
  echo "$sha256  $file" | shasum -a 256 --check --quiet
  mkdir "$work/$name"
  tar -xf "$file" -C "$work/$name" --strip-components 1
done <<<"$TARBALLS"
while read -r name ref commit url; do
  [[ -n $name ]] || continue
  # A full clone, so each library's own version script finds its tag or commit count.
  git clone --quiet --branch "$ref" "$url" "$work/$name"
  git -C "$work/$name" -c advice.detachedHead=false checkout --quiet "$commit"
  git -C "$work/$name" archive --prefix "$name/" -o "$src/$name-$commit.tar.gz" HEAD
done <<<"$REPOSITORIES"
cp "$0" "$src/"

export MACOSX_DEPLOYMENT_TARGET=11.0
export PATH=$work/tools/bin:$PATH
# Only the libraries built here: never a Homebrew one from the runner.
export PKG_CONFIG_LIBDIR=$prefix/lib/pkgconfig
jobs=$(sysctl -n hw.ncpu)
python3 -m venv "$work/tools"
"$work/tools/bin/pip" install --quiet "meson==$MESON" "ninja==$NINJA"
static=(--prefix="$prefix" --disable-shared --enable-static)
meson_static=(--prefix="$prefix" --libdir=lib --buildtype=release --default-library=static)

(cd "$work/nasm" && ./configure --prefix="$work/tools" && make -j"$jobs" && make install)
(cd "$work/x264" && ./configure "${static[@]}" --enable-pic --disable-cli && make -j"$jobs" install)
(cd "$work/libvpx" && ./configure "${static[@]}" --enable-pic --enable-vp9-highbitdepth \
  --disable-examples --disable-tools --disable-docs --disable-unit-tests && make -j"$jobs" install)
(cd "$work/zimg" && LIBTOOLIZE=glibtoolize ./autogen.sh && ./configure "${static[@]}" && make -j"$jobs" install)
(cd "$work/freetype" && ./configure "${static[@]}" --with-zlib=yes --with-bzip2=no --with-png=no \
  --with-harfbuzz=no --with-brotli=no && make -j"$jobs" install)
(cd "$work/fribidi" && meson setup build "${meson_static[@]}" -Ddocs=false -Dtests=false -Dbin=false &&
  ninja -C build install)
(cd "$work/harfbuzz" && meson setup build "${meson_static[@]}" -Dfreetype=enabled -Dglib=disabled \
  -Dgobject=disabled -Dcairo=disabled -Dicu=disabled -Dgraphite2=disabled -Dcoretext=disabled \
  -Dtests=disabled -Ddocs=disabled -Dintrospection=disabled -Dutilities=disabled &&
  ninja -C build install)
# The renderer hands libass the caption fonts itself, so it needs no system font provider.
(cd "$work/libass" && ./configure "${static[@]}" --disable-fontconfig --disable-coretext \
  --disable-require-system-font-provider --disable-libunibreak && make -j"$jobs" install)
# No autodetection: every library is named, and the rest are macOS's own.
(cd "$work/ffmpeg" && ./configure --prefix="$prefix" --pkg-config-flags=--static --extra-libs=-lc++ \
  --disable-autodetect --enable-gpl --enable-libx264 --enable-libvpx --enable-libzimg \
  --enable-libass --enable-libfreetype --enable-libharfbuzz --enable-libfribidi \
  --enable-zlib --enable-bzlib --enable-iconv --disable-ffplay --disable-ffprobe --disable-doc &&
  make -j"$jobs" install)

ffmpeg=$prefix/bin/ffmpeg
"$ffmpeg" -hide_banner -buildconf
"$ffmpeg" -hide_banner -L | grep -q "GNU General Public License as published by" || exit 1
if "$ffmpeg" -hide_banner -buildconf | grep -q -- --enable-nonfree; then exit 1; fi
# Every library linked dynamically must be part of macOS.
if otool -L "$ffmpeg" | tail -n +2 | grep -v -E '^\s+(/usr/lib/|/System/Library/)'; then exit 1; fi
[[ $(lipo -archs "$ffmpeg") == x86_64 ]]

cp "$ffmpeg" "$out/ffmpeg"
tar -czf "$out/sources.tar.gz" -C "$work" sources
(cd "$out" && shasum -a 256 ffmpeg sources.tar.gz >SHA256SUMS && cat SHA256SUMS)
rm -rf "$work"
