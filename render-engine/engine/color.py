"""
color.py — HDR detection and SDR/BT.709 garde-fou (P4).

The render pipeline (template composite, captions burn, media-edit re-encode,
cover/poster extraction) must never let an HDR source (iPhone HLG/Dolby
Vision, PQ masters, 10-bit BT.2020 footage) flow through untouched: FFmpeg
happily re-tags or silently drops the HDR metadata during a naive
10-bit→8-bit conversion, producing washed-out/blown-out colors ("template
bon, vidéo fade").

Two independent responsibilities live here:

  1. ``is_hdr()`` — decide, from probed colorimetry, whether a source needs
     tonemapping before it can be treated as SDR.
  2. ``bt709_output_flags()`` — the explicit BT.709/tv output tags every
     SDR-targeted encode must carry, so FFmpeg never recopies mismatched (or
     HDR) input tags onto converted pixels. Applied unconditionally on every
     encode (SDR sources included) — never on ``-c copy`` passthrough paths.

``hdr_to_sdr_prefilter()`` is only ever injected into a filter chain when the
caller has already confirmed ``is_hdr(probe_video(...))`` — this module does
not gate that decision itself, callers must.
"""

from __future__ import annotations

import functools
import logging
import subprocess

from engine.probe import VideoInfo

logger = logging.getLogger("render-engine")

# PQ (smpte2084) and HLG (arib-std-b67) are the only transfer characteristics
# that are genuinely HDR. "bt2020-10"/"bt2020-12" are BT.709-compatible gamma
# curves for wide-gamut SDR-ish content — NOT HDR by themselves.
_HDR_TRANSFERS = frozenset({"smpte2084", "arib-std-b67"})

# BT.2020 primaries/matrix tokens, however reported by ffprobe depending on
# container/encoder (primaries vs. matrix coefficients field).
_BT2020_TOKENS = frozenset({"bt2020", "bt2020nc", "bt2020c", "bt2020-10", "bt2020-12"})


def is_hdr(info: VideoInfo) -> bool:
    """
    Return True if the probed source needs HDR→SDR tonemapping.

    True when either of:
      - color_transfer is a genuine HDR transfer function (PQ or HLG)
      - color_primaries or color_space (matrix) is BT.2020 — regardless of bit
        depth: a BT.2020-tagged source is already treated as HDR here even at
        8-bit, so bit depth is not itself part of the decision.

    Untagged sources (``None`` fields — ffprobe reports no colorimetry
    metadata) are always treated as SDR: assuming HDR on missing data would
    tonemap perfectly healthy SDR footage, which is explicitly forbidden.
    """
    transfer = info.color_transfer
    primaries = info.color_primaries
    matrix = info.color_space

    if transfer in _HDR_TRANSFERS:
        return True
    if primaries in _BT2020_TOKENS or matrix in _BT2020_TOKENS:
        return True
    return False


@functools.lru_cache(maxsize=1)
def has_zscale() -> bool:
    """
    Return True if the local FFmpeg build supports the ``zscale`` filter
    (requires libzimg). Cached for the process lifetime — the result cannot
    change without a binary swap.
    """
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        stdout = result.stdout or ""
        return any(
            line.split()[1] == "zscale"
            for line in stdout.splitlines()
            if len(line.split()) > 1
        )
    except Exception:
        logger.warning(
            "[color] Could not run 'ffmpeg -filters' to probe zscale/libzimg support",
            exc_info=True,
        )
        return False


def hdr_to_sdr_prefilter() -> str:
    """
    FFmpeg filter-chain fragment that tonemaps an HDR source (PQ/HLG,
    BT.2020) down to 8-bit SDR BT.709, meant to be placed right after
    scale/crop and before any further compositing (PNG overlays, pad, etc.)
    so downstream filters always operate on SDR pixels.

    Falls back to a plain 8-bit conversion (no tonemap) — with a logged
    warning — when the local FFmpeg build lacks zscale/libzimg. Never
    raises and never blocks the render: a source that stays too bright is
    preferable to a hard failure.
    """
    if not has_zscale():
        logger.warning(
            "[color] HDR source detected but this FFmpeg build has no "
            "zscale/libzimg — falling back to a plain 8-bit conversion "
            "without tonemapping (colors will look washed out)."
        )
        return "format=yuv420p"
    return (
        "zscale=t=linear:npl=100,format=gbrpf32le,"
        "tonemap=hable:desat=0,"
        "zscale=p=bt709:t=bt709:m=bt709:r=tv,"
        "format=yuv420p"
    )


def bt709_output_flags() -> list[str]:
    """
    Explicit BT.709/tv output color tags. Force these on every SDR-targeted
    encode (HDR sources that were just tonemapped AND plain SDR sources
    alike) so FFmpeg never recopies mismatched or absent input tags onto the
    encoded output — the concat ``-c copy`` step downstream depends on every
    individual clip already carrying correct, consistent tags.

    Never apply to a ``-c copy`` passthrough command: that would tag pixels
    that were never actually converted.
    """
    return [
        "-colorspace", "bt709",
        "-color_primaries", "bt709",
        "-color_trc", "bt709",
        "-color_range", "tv",
    ]
