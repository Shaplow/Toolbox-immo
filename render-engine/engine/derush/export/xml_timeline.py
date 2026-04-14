from __future__ import annotations

import math
import os
from fractions import Fraction
from xml.etree import ElementTree as ET

from engine.derush.export.base import ExportProvider
from engine.derush.models import DerushExportInput, DerushSegment, ExportResult, SourceFileInfo


class XmlTimelineExporter(ExportProvider):
    """
    Exports a non-destructive XML timeline referencing original source files.

    Formats:
    - "fcpxml" (default): FCPXML 1.9 — supported by FCP, Premiere, DaVinci Resolve
    - "premiere_xml": Legacy xmeml/Premiere XML

    No video re-encoding. Source files referenced by their R2 public URL.
    """

    def export(
        self,
        export_input: DerushExportInput,
        segments: list[DerushSegment],
        source_files: list[SourceFileInfo],
        output_dir: str,
    ) -> ExportResult:
        selected = self._selected(segments, export_input.segment_ids)
        source_map = self._source_map(source_files)
        fmt = getattr(export_input, "xml_format", "fcpxml")

        if fmt == "premiere_xml":
            xml_str, ext = self._build_premiere_xml(selected, source_map, export_input), "xml"
        else:
            xml_str, ext = self._build_fcpxml(selected, source_map, export_input), "fcpxml"

        out_filename = f"timeline_{export_input.export_id}.{ext}"
        out_path = os.path.join(output_dir, out_filename)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(xml_str)

        return ExportResult(
            export_format="xml_timeline",
            output_key=f"{export_input.output_prefix}/{out_filename}",
            exported_count=len(selected),
            encoding_mode="stream_copy",
        )

    # ── FCPXML 1.9 ────────────────────────────────────────────────────────────

    def _build_fcpxml(
        self,
        selected: list[DerushSegment],
        source_map: dict[str, SourceFileInfo],
        export_input: DerushExportInput,
    ) -> str:
        """
        FCPXML 1.9 structure:
        <fcpxml>
          <resources>
            <format id="r1" .../>
            <asset id="r2" .../>
          </resources>
          <library>
            <event>
              <project>
                <sequence>
                  <spine>
                    <clip .../>
                  </spine>
                </sequence>
              </project>
            </event>
          </library>
        </fcpxml>
        """
        root = ET.Element("fcpxml", version="1.9")
        resources = ET.SubElement(root, "resources")

        # Collect unique source files used
        used_src_ids = {seg.source_file_id for seg in selected}
        used_sources = [src for src in source_map.values() if src.id in used_src_ids]

        # Build format elements (one per unique resolution/fps)
        fmt_map: dict[str, str] = {}  # (width, height, fps_str) → format_id
        for idx, src in enumerate(used_sources):
            fps_str = self._fps_to_rational(src.fps)
            key = f"{src.width}x{src.height}@{fps_str}"
            if key not in fmt_map:
                fid = f"r{len(fmt_map) + 1}"
                ET.SubElement(resources, "format", {
                    "id": fid,
                    "name": f"FFVideoFormat{src.height}p{int(src.fps)}",
                    "frameDuration": f"1/{int(src.fps)}s",
                    "width": str(src.width),
                    "height": str(src.height),
                })
                fmt_map[key] = fid

        # Build asset elements
        asset_map: dict[str, str] = {}  # src.id → asset_id
        for idx, src in enumerate(used_sources):
            fps_str = self._fps_to_rational(src.fps)
            fmt_key = f"{src.width}x{src.height}@{fps_str}"
            aid = f"a{idx + 1}"
            asset = ET.SubElement(resources, "asset", {
                "id": aid,
                "name": src.filename,
                "src": src.r2_public_url,
                "format": fmt_map[fmt_key],
                "duration": self._secs_to_rational(src.duration, src.fps),
                "hasVideo": "1",
                "hasAudio": "1",
            })
            asset_map[src.id] = aid

        # Build timeline
        library = ET.SubElement(root, "library")
        event = ET.SubElement(library, "event", name=f"Dérush {export_input.job_id[:8]}")
        project = ET.SubElement(event, "project", name="Dérush export")

        # Use first source fps for sequence
        primary_fps = used_sources[0].fps if used_sources else 25.0
        total_duration_secs = sum(s.duration for s in selected)
        sequence = ET.SubElement(project, "sequence", {
            "format": list(fmt_map.values())[0],
            "duration": self._secs_to_rational(total_duration_secs, primary_fps),
            "tcStart": "0s",
            "tcFormat": "NDF",
            "audioLayout": "stereo",
            "audioRate": "48k",
        })
        spine = ET.SubElement(sequence, "spine")

        # Add clips ordered by rank
        timeline_offset = Fraction(0)
        for seg in selected:
            src = source_map[seg.source_file_id]
            fps = src.fps
            clip_in = self._secs_to_rational(seg.source_in, fps)
            clip_out = self._secs_to_rational(seg.source_out, fps)
            clip_dur = self._secs_to_rational(seg.duration, fps)
            offset = f"{timeline_offset.numerator}/{timeline_offset.denominator}s"

            clip = ET.SubElement(spine, "clip", {
                "name": f"seg_{seg.order:03d}_{seg.shot_type or 'unknown'}",
                "ref": asset_map[seg.source_file_id],
                "offset": offset,
                "start": clip_in,
                "duration": clip_dur,
                "tcFormat": "NDF",
            })
            # Metadata as note
            note = ET.SubElement(clip, "note")
            note.text = (
                f"score={seg.score:.0f} "
                f"tags={','.join(seg.tags)} "
                f"mode={seg.analysis_mode}"
            )

            timeline_offset += Fraction(seg.duration).limit_denominator(int(fps * 1000))

        ET.indent(root, space="  ")
        return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")

    # ── Premiere XML (xmeml) ──────────────────────────────────────────────────

    def _build_premiere_xml(
        self,
        selected: list[DerushSegment],
        source_map: dict[str, SourceFileInfo],
        export_input: DerushExportInput,
    ) -> str:
        """
        Legacy Premiere xmeml XML.
        Clip in/out expressed in frames.
        """
        root = ET.Element("xmeml", version="5")
        sequence = ET.SubElement(root, "sequence")
        ET.SubElement(sequence, "name").text = f"Dérush {export_input.job_id[:8]}"
        ET.SubElement(sequence, "duration").text = str(
            sum(int(s.duration * (source_map[s.source_file_id].fps or 25.0)) for s in selected)
        )
        rate_el = ET.SubElement(sequence, "rate")
        primary_fps = source_map[selected[0].source_file_id].fps if selected else 25.0
        ET.SubElement(rate_el, "timebase").text = str(int(primary_fps))
        ET.SubElement(rate_el, "ntsc").text = "FALSE"

        media = ET.SubElement(sequence, "media")
        video = ET.SubElement(media, "video")
        track = ET.SubElement(video, "track")

        timeline_frame = 0
        for seg in selected:
            src = source_map[seg.source_file_id]
            fps = src.fps or 25.0
            in_frame = int(seg.source_in * fps)
            out_frame = int(seg.source_out * fps)
            clip_dur = out_frame - in_frame

            clipitem = ET.SubElement(track, "clipitem")
            ET.SubElement(clipitem, "name").text = f"seg_{seg.order:03d}"
            ET.SubElement(clipitem, "start").text = str(timeline_frame)
            ET.SubElement(clipitem, "end").text = str(timeline_frame + clip_dur)
            ET.SubElement(clipitem, "in").text = str(in_frame)
            ET.SubElement(clipitem, "out").text = str(out_frame)
            file_el = ET.SubElement(clipitem, "file")
            ET.SubElement(file_el, "name").text = src.filename
            ET.SubElement(file_el, "pathurl").text = src.r2_public_url

            timeline_frame += clip_dur

        ET.indent(root, space="  ")
        return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")

    # ── Helpers ────────────────────────────────────────────────────────────────

    @staticmethod
    def _fps_to_rational(fps: float) -> str:
        """e.g. 29.97 → '30000/1001', 25 → '25/1'"""
        f = Fraction(fps).limit_denominator(1000)
        return f"{f.numerator}/{f.denominator}"

    @staticmethod
    def _secs_to_rational(secs: float, fps: float) -> str:
        """
        Convert seconds to FCPXML time string.
        FCP expects times as rational 'N/Ds' where N/D = total_frames / fps.
        e.g. 5.04s at 25fps = 126 frames → '126/25s'
        """
        total_frames = round(secs * fps)
        denom = int(fps)
        # Simplify
        from math import gcd
        g = gcd(total_frames, denom)
        return f"{total_frames // g}/{denom // g}s"
