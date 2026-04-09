from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class WordTimestamp(BaseModel):
    word: str = Field(min_length=1)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    highlight: bool = False
    highlight_group: int = Field(default=0, ge=0)
    # Index of the originating SRT caption block (0 = unset / JSON input).
    # Used by the layout splitter to always break on SRT caption boundaries.
    caption_index: int = Field(default=0, ge=0)

    @field_validator("end")
    @classmethod
    def validate_end_after_start(cls, value: float, info):
        start = info.data.get("start")
        if start is not None and value <= start:
            raise ValueError("end must be greater than start")
        return value


class SafeArea(BaseModel):
    left: float = Field(default=0.06, ge=0.0, le=0.4)
    right: float = Field(default=0.06, ge=0.0, le=0.4)
    top: float = Field(default=0.08, ge=0.0, le=0.4)
    bottom: float = Field(default=0.12, ge=0.0, le=0.5)


LineHeightMode = Literal["fixed_box", "painted_gap"]


class LayoutConfig(BaseModel):
    anchor: Literal["bottom", "center", "top"] = "bottom"
    max_lines: int = Field(default=2, ge=1, le=5)
    safe_area: SafeArea = Field(default_factory=SafeArea)
    line_gap_ratio: float = Field(default=0.22, ge=-1.0, le=2.0)
    line_height_mode: LineHeightMode = "fixed_box"
    max_width_ratio: float = Field(default=1.0, ge=0.1, le=1.0)
    # Fractional offset applied AFTER anchor positioning (positive = down, negative = up).
    # Range [-0.5, 0.5] relative to video height.
    vertical_offset: float = Field(default=0.0, ge=-0.5, le=0.5)


class StyleConfig(BaseModel):
    font: str
    size_ratio: float = Field(default=0.06, ge=0.01, le=0.2)
    bold: bool = False
    italic: bool = False
    text_transform: Literal['none', 'upper', 'lower', 'title'] = 'none'
    color: str = "#FFFFFF"
    spacing: float = Field(default=0.0, ge=0.0, le=20.0)
    outline: float = Field(default=0.0, ge=0.0, le=20.0)
    outline_color: str = "#000000"  # colour used for hard outline (\bord without glow/blur)
    shadow: float = Field(default=0.0, ge=0.0, le=50.0)
    blur: float = Field(default=0.0, ge=0.0, le=10.0)
    shadow_color: str = "#000000"
    shadow_alpha: float = Field(default=0.45, ge=0.0, le=1.0)
    shadow_angle: float = Field(default=90.0, ge=-180.0, le=180.0)
    shadow_blur: float = Field(default=0.0, ge=0.0, le=20.0)
    glow_color: str = "#FFFFFF"
    glow_intensity: float = Field(default=0.0, ge=0.0, le=20.0)


class HighlightConfig(BaseModel):
    mode: Literal["keywords"] = "keywords"
    keywords: list[str] = Field(default_factory=list)


class AnimationConfig(BaseModel):
    preset: Literal["none", "appear", "reveal", "word_pop"] = "reveal"


class BlockRules(BaseModel):
    pause_threshold: float = Field(default=0.5, ge=0.1, le=2.0)
    max_duration: float = Field(default=4.5, ge=1.0, le=10.0)


CaptionEngine = Literal["ass", "cairo"]


class RenderConfig(BaseModel):
    layout: LayoutConfig
    base_style: StyleConfig
    highlight_style: StyleConfig
    highlight_style2: StyleConfig | None = None
    highlight: HighlightConfig
    animation: AnimationConfig
    block_rules: BlockRules = Field(default_factory=BlockRules)
    engine: CaptionEngine = "ass"


def default_premium_config() -> RenderConfig:
    return RenderConfig(
        layout=LayoutConfig(
                anchor="center",
            max_lines=2,
            safe_area=SafeArea(left=0.06, right=0.06, top=0.08, bottom=0.18),
            line_gap_ratio=0.22,
        ),
        base_style=StyleConfig(
            font="Playfair Display SemiBold",
            size_ratio=0.062,
            bold=True,
            italic=False,
            color="#FFFFFF",
            outline=0,
            shadow=0,
            blur=0.0,
            shadow_color="#000000",
            shadow_alpha=0.45,
            shadow_angle=90.0,
            shadow_blur=0.0,
            glow_color="#FFFFFF",
            glow_intensity=0.0,
        ),
        highlight_style=StyleConfig(
            font="Didot",
            size_ratio=0.068,
            bold=False,
            italic=True,
                color="#C88B3A",
            outline=0,
            shadow=0,
            blur=0.0,
            shadow_color="#000000",
            shadow_alpha=0.45,
            shadow_angle=90.0,
            shadow_blur=0.0,
            glow_color="#C88B3A",
            glow_intensity=1.2,
        ),
        highlight=HighlightConfig(mode="keywords", keywords=[]),
        animation=AnimationConfig(preset="reveal"),
    )
