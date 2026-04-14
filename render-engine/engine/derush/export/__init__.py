from engine.derush.export.base import ExportProvider  # noqa: F401
from engine.derush.export.manifest import ManifestExporter  # noqa: F401
from engine.derush.export.trimmed_clips import TrimmedClipExporter  # noqa: F401
from engine.derush.export.xml_timeline import XmlTimelineExporter  # noqa: F401
from engine.derush.export.stringout import StringoutExporter  # noqa: F401
from engine.derush.export.structured_folder import StructuredFolderExporter  # noqa: F401
from engine.derush.export.combo import ComboExporter  # noqa: F401


def get_exporter(export_format: str) -> "ExportProvider":
    mapping = {
        "clips_trimmed": TrimmedClipExporter,
        "xml_timeline": XmlTimelineExporter,
        "stringout_video": StringoutExporter,
        "structured_folder": StructuredFolderExporter,
        "manifest_only": ManifestExporter,
        "combo_export": ComboExporter,
    }
    cls = mapping.get(export_format)
    if cls is None:
        raise ValueError(f"Unknown export format: {export_format!r}")
    return cls()
