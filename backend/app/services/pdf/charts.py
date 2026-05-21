"""
CEI Chart Helpers
=================
Renders Matplotlib charts into in-memory PNG bytes and wraps them as
ReportLab Image flowables, ready to embed in any CEI PDF document.

All charts use a clean white / light-grey style suited for printed
compliance documents — the CEI dark theme is reserved for the screen UI.

Usage::

    from app.services.pdf.charts import bar_chart, line_chart, pie_chart

    chart = bar_chart(
        labels=["Jan", "Feb", "Mar"],
        values=[12.4, 9.8, 14.1],
        title="Monthly Emissions (tCO₂)",
        y_label="tCO₂",
    )
    story.append(chart)
"""
from __future__ import annotations

import matplotlib
matplotlib.use("Agg")  # non-interactive backend — MUST be set before pyplot import

import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
from io import BytesIO
from typing import Dict, List, Optional

from reportlab.platypus import Image

# ---------------------------------------------------------------------------
# Chart colour palette (print-friendly, maps to CEI brand)
# ---------------------------------------------------------------------------
_ACCENT  = "#38bdf8"   # CEI sky-blue
_GREEN   = "#22c55e"
_AMBER   = "#f59e0b"
_RED     = "#ef4444"
_INDIGO  = "#818cf8"
_ROSE    = "#fb7185"
_TEAL    = "#2dd4bf"

PALETTE  = [_ACCENT, _GREEN, _AMBER, _RED, _INDIGO, _ROSE, _TEAL]

_SURFACE = "#0f172a"   # axis title, tick label colour
_MUTED   = "#6b7280"   # secondary labels
_BG      = "white"
_GRID_C  = "#f1f5f9"   # plot area background
_BORDER  = "#e2e8f0"   # axis spine colour

DPI = 150  # resolution for embedded PNGs


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _base_style(fig, ax) -> None:
    """Apply consistent clean styling to a single-axis chart."""
    fig.patch.set_facecolor(_BG)
    ax.set_facecolor(_GRID_C)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.spines["left"].set_color(_BORDER)
    ax.spines["bottom"].set_color(_BORDER)
    ax.tick_params(colors=_SURFACE, labelsize=8)
    ax.xaxis.label.set_color(_SURFACE)
    ax.yaxis.label.set_color(_SURFACE)
    if ax.get_title():
        ax.title.set_color(_SURFACE)


def _flush(fig, width_pt: float, height_pt: float) -> Image:
    """Save the current figure to a BytesIO buffer and return an RL Image."""
    buf = BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=DPI, facecolor=_BG)
    plt.close(fig)
    buf.seek(0)
    return Image(buf, width=width_pt, height=height_pt)


def _label_bars(ax, bars, values: List[float], fmt: str = "{:.2f}") -> None:
    """Add value labels above each bar."""
    max_v = max(abs(v) for v in values) if values else 1
    for bar, val in zip(bars, values):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + max_v * 0.012,
            fmt.format(val),
            ha="center", va="bottom",
            fontsize=7, color=_MUTED,
        )


def _rotate_labels(ax, labels: List[str]) -> None:
    if len(labels) > 6:
        plt.setp(ax.get_xticklabels(), rotation=40, ha="right")


# ---------------------------------------------------------------------------
# Public chart builders
# ---------------------------------------------------------------------------

def bar_chart(
    labels: List[str],
    values: List[float],
    title: str,
    y_label: str = "",
    color: str = _ACCENT,
    value_labels: bool = True,
    width_pt: float = 450,
    height_pt: float = 210,
    label_fontsize: int = 8,
    rotate_labels: bool = False,
    legend_outside: bool = True,
) -> Image:
    """
    Simple vertical bar chart.

    Args:
        labels:       X-axis category labels.
        values:       Bar heights.
        title:        Chart title.
        y_label:      Y-axis label (optional).
        color:        Bar fill colour.
        value_labels: Annotate each bar with its numeric value.
        width_pt:     Width in ReportLab points.
        height_pt:    Height in ReportLab points.
    """
    fig, ax = plt.subplots(figsize=(width_pt / DPI, height_pt / DPI))
    bars = ax.bar(labels, values, color=color, edgecolor="white", linewidth=0.6, zorder=3)
    ax.yaxis.grid(True, color=_BORDER, linewidth=0.5, zorder=0)
    ax.set_axisbelow(True)
    if y_label:
        ax.set_ylabel(y_label, fontsize=8)
    ax.set_title(title, fontsize=10, fontweight="bold", pad=8)
    if value_labels:
        _label_bars(ax, bars, values)
    n = len(labels)
    lbl_size = label_fontsize if label_fontsize != 8 else (5 if n > 9 else (5.5 if n > 6 else 6.5))
    plt.setp(ax.get_xticklabels(), fontsize=lbl_size,
             rotation=40 if (rotate_labels or n > 4) else 0,
             ha="right" if (rotate_labels or n > 4) else "center")
    _base_style(fig, ax)
    fig.tight_layout()
    return _flush(fig, width_pt, height_pt)


def line_chart(
    labels: List[str],
    values: List[float],
    title: str,
    y_label: str = "",
    color: str = _ACCENT,
    show_fill: bool = True,
    width_pt: float = 450,
    height_pt: float = 200,
) -> Image:
    """
    Line chart with optional area fill.

    Useful for time-series trends: monthly kWh, tCO₂ trajectory, etc.
    """
    fig, ax = plt.subplots(figsize=(width_pt / DPI, height_pt / DPI))
    x = range(len(labels))
    ax.plot(
        list(x), values,
        color=color, linewidth=2,
        marker="o", markersize=4.5,
        markerfacecolor="white", markeredgewidth=1.5, markeredgecolor=color,
        zorder=4,
    )
    if show_fill:
        ax.fill_between(list(x), values, alpha=0.13, color=color, zorder=3)
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels)
    ax.yaxis.grid(True, color=_BORDER, linewidth=0.5, zorder=0)
    ax.set_axisbelow(True)
    if y_label:
        ax.set_ylabel(y_label, fontsize=8)
    ax.set_title(title, fontsize=10, fontweight="bold", pad=8)
    for i, val in enumerate(values):
        ax.text(i, val + max(values) * 0.02, f"{val:,.0f}",
                ha="center", va="bottom", fontsize=6, color=_MUTED, zorder=5)
    n = len(labels)
    lbl_size = 5 if n > 9 else (5.5 if n > 6 else 6.5)
    plt.setp(ax.get_xticklabels(), fontsize=lbl_size, rotation=40, ha="right")
    _base_style(fig, ax)
    fig.tight_layout()
    return _flush(fig, width_pt, height_pt)


def dual_bar_chart(
    labels: List[str],
    values_a: List[float],
    values_b: List[float],
    label_a: str,
    label_b: str,
    title: str,
    color_a: str = _ACCENT,
    color_b: str = _GREEN,
    width_pt: float = 450,
    height_pt: float = 210,
    label_fontsize: int = 8,
    rotate_labels: bool = False,
    legend_outside: bool = True,
) -> Image:
    """
    Side-by-side (grouped) bar chart for comparing two series.

    Typical use: baseline EnPI vs current EnPI, or kWh vs tCO₂.
    """
    x = np.arange(len(labels))
    w = 0.36
    fig, ax = plt.subplots(figsize=(width_pt / DPI, height_pt / DPI))
    bars_a = ax.bar(x - w / 2, values_a, w, label=label_a,
                    color=color_a, edgecolor="white", linewidth=0.4, zorder=3)
    bars_b = ax.bar(x + w / 2, values_b, w, label=label_b,
                    color=color_b, edgecolor="white", linewidth=0.4, zorder=3)
    for bars, vals in [(bars_a, values_a), (bars_b, values_b)]:
        for bar, val in zip(bars, vals):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + max(max(values_a), max(values_b)) * 0.01,
                f"{val:,.0f}",
                ha="center", va="bottom",
                fontsize=4.5, color=_MUTED,
            )
    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.yaxis.grid(True, color=_BORDER, linewidth=0.5, zorder=0)
    ax.set_axisbelow(True)
    ax.legend(fontsize=7, framealpha=0.85, edgecolor=_BORDER,
              loc="upper right" if not legend_outside else "upper left",
              bbox_to_anchor=None if not legend_outside else (1.01, 1),
              borderaxespad=0)
    ax.set_title(title, fontsize=10, fontweight="bold", pad=8)
    n = len(labels)
    lbl_size = label_fontsize if label_fontsize != 8 else (5 if n > 9 else (5.5 if n > 6 else 6.5))
    plt.setp(ax.get_xticklabels(), fontsize=lbl_size,
             rotation=40 if (rotate_labels or n > 4) else 0,
             ha="right" if (rotate_labels or n > 4) else "center")
    _base_style(fig, ax)
    fig.tight_layout(rect=[0, 0, 0.82, 1] if legend_outside else None)
    return _flush(fig, width_pt, height_pt)


def stacked_bar_chart(
    labels: List[str],
    series: Dict[str, List[float]],
    title: str,
    y_label: str = "",
    width_pt: float = 450,
    height_pt: float = 210,
) -> Image:
    """
    Stacked bar chart for multi-source breakdowns.

    Args:
        series: Ordered dict mapping series name → list of values.
                e.g. {"Electricity": [10, 12, 9], "Gas": [4, 5, 3]}
    """
    fig, ax = plt.subplots(figsize=(width_pt / DPI, height_pt / DPI))
    bottom = np.zeros(len(labels))
    for i, (name, vals) in enumerate(series.items()):
        arr = np.array(vals, dtype=float)
        ax.bar(
            labels, arr,
            bottom=bottom,
            label=name,
            color=PALETTE[i % len(PALETTE)],
            edgecolor="white",
            linewidth=0.4,
            zorder=3,
        )
        bottom += arr
    ax.yaxis.grid(True, color=_BORDER, linewidth=0.5, zorder=0)
    ax.set_axisbelow(True)
    if y_label:
        ax.set_ylabel(y_label, fontsize=8)
    ax.set_title(title, fontsize=10, fontweight="bold", pad=8)
    ax.legend(fontsize=8, framealpha=0.85, edgecolor=_BORDER)
    plt.setp(ax.get_xticklabels(), fontsize=7,
             rotation=40 if len(labels) > 4 else 0,
             ha="right" if len(labels) > 4 else "center")
    _base_style(fig, ax)
    fig.tight_layout()
    return _flush(fig, width_pt, height_pt)


def pie_chart(
    labels: List[str],
    values: List[float],
    title: str,
    width_pt: float = 230,
    height_pt: float = 210,
) -> Image:
    """
    Pie chart — used for energy source breakdowns.
    Slices use the CEI palette; each wedge is annotated with its percentage.
    """
    fig, ax = plt.subplots(figsize=(width_pt / DPI, height_pt / DPI))
    ax.pie(
        values,
        labels=labels,
        colors=PALETTE[: len(labels)],
        autopct="%1.1f%%",
        pctdistance=0.80,
        wedgeprops={"edgecolor": "white", "linewidth": 1.5},
        textprops={"fontsize": 8, "color": _SURFACE},
        startangle=90,
    )
    ax.set_title(title, fontsize=9, fontweight="bold", pad=6, color=_SURFACE)
    fig.patch.set_facecolor(_BG)
    fig.tight_layout()
    return _flush(fig, width_pt, height_pt)


def horizontal_gauge(
    value: float,
    min_val: float,
    max_val: float,
    label: str,
    benchmark: Optional[float] = None,
    color: str = _ACCENT,
    width_pt: float = 450,
    height_pt: float = 80,
) -> Image:
    """
    Horizontal progress-bar style gauge.

    Useful for showing a site's position between zero and the sector benchmark.

    Args:
        value:      The measured value (e.g. actual tCO₂/tonne).
        min_val:    Left edge of the scale.
        max_val:    Right edge of the scale.
        label:      Description label, e.g. "EnPI (kWh/tonne)".
        benchmark:  If supplied, draws a vertical benchmark marker line.
    """
    fig, ax = plt.subplots(figsize=(width_pt / DPI, height_pt / DPI))
    fig.patch.set_facecolor(_BG)

    # Background track
    ax.barh(0, max_val - min_val, left=min_val, height=0.4,
            color=_GRID_C, edgecolor=_BORDER, linewidth=0.5)

    # Filled bar
    pct = max(0.0, min(1.0, (value - min_val) / (max_val - min_val)))
    bar_color = _GREEN if pct < 0.5 else (_AMBER if pct < 0.8 else _RED)
    ax.barh(0, value - min_val, left=min_val, height=0.4,
            color=bar_color, edgecolor="white", linewidth=0.4)

    # Benchmark marker
    if benchmark is not None:
        ax.axvline(benchmark, color=_SURFACE, linewidth=1.5, linestyle="--", zorder=5)
        ax.text(benchmark, 0.28, f"Benchmark\n{benchmark:,.3f}",
                ha="center", va="bottom", fontsize=7, color=_SURFACE)

    # Value annotation
    ax.text(value, -0.28, f"{value:,.3f}", ha="center", va="top",
            fontsize=9, fontweight="bold", color=bar_color)

    ax.set_xlim(min_val, max_val)
    ax.set_ylim(-0.6, 0.7)
    ax.set_yticks([])
    ax.set_xlabel(label, fontsize=8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.spines["bottom"].set_color(_BORDER)
    ax.tick_params(colors=_SURFACE, labelsize=8)
    fig.tight_layout()
    return _flush(fig, width_pt, height_pt)