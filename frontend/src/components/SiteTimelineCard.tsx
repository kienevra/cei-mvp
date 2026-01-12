// frontend/src/components/SiteTimelineCard.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSiteEvents, SiteEvent } from "../services/api";

interface Props {
  siteId: string;
  windowHours?: number; // default 168h (7 days)
  /**
   * Optional key that forces a refetch when it changes.
   * Used by SiteView after creating a new operator note.
   */
  refreshKey?: number | string;
}

const DEFAULT_WINDOW_HOURS = 168;
const PAGE_SIZE = 100;

// Normalise FastAPI/Pydantic error payloads into a human-readable string
const normalizeApiError = (e: any, fallback: string): string => {
  if (e?.message && typeof e.message === "string") return e.message;

  const detail = e?.response?.data?.detail;

  if (Array.isArray(detail)) {
    return detail.map((d: any) => d?.msg || JSON.stringify(d)).join(" | ");
  }

  if (detail && typeof detail === "object") {
    if (typeof (detail as any).msg === "string") return (detail as any).msg;
    return JSON.stringify(detail);
  }

  if (typeof detail === "string") return detail;

  return fallback;
};

const isFiniteNumber = (v: any): v is number =>
  typeof v === "number" && Number.isFinite(v);

function formatEventTime(ts?: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SiteTimelineCard({
  siteId,
  windowHours = DEFAULT_WINDOW_HOURS,
  refreshKey,
}: Props) {
  const { t } = useTranslation();

  const [events, setEvents] = useState<SiteEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // internal state for selected lookback window + pagination
  const [selectedWindowHours, setSelectedWindowHours] = useState<number>(
    isFiniteNumber(windowHours) ? windowHours : DEFAULT_WINDOW_HOURS
  );
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);

  // Ensure selected window tracks prop changes (without forcing a reset loop)
  useEffect(() => {
    if (!isFiniteNumber(windowHours)) return;
    if (windowHours !== selectedWindowHours) setSelectedWindowHours(windowHours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowHours]);

  const windowOptions = useMemo(
    () => [
      { label: t("siteTimeline.windows.24h", { defaultValue: "24h" }), hours: 24 },
      { label: t("siteTimeline.windows.7d", { defaultValue: "7 days" }), hours: 168 },
      { label: t("siteTimeline.windows.30d", { defaultValue: "30 days" }), hours: 720 },
    ],
    [t]
  );

  // Initial + refetch load (page 1)
  useEffect(() => {
    if (!siteId) return;

    let ignore = false;

    async function loadFirstPage() {
      try {
        setLoading(true);
        setError(null);
        setPage(1);

        const data = await getSiteEvents(siteId, selectedWindowHours, PAGE_SIZE, 1);

        if (ignore) return;

        const list = Array.isArray(data) ? data : [];
        setEvents(list);
        setHasMore(list.length === PAGE_SIZE);
      } catch (e: any) {
        if (ignore) return;
        setError(
          normalizeApiError(
            e,
            t("siteTimeline.errors.fetch", {
              defaultValue: "Failed to fetch site activity.",
            })
          )
        );
      } finally {
        if (ignore) return;
        setLoading(false);
      }
    }

    loadFirstPage();
    return () => {
      ignore = true;
    };
  }, [siteId, selectedWindowHours, refreshKey, t]);

  const handleLoadMore = async () => {
    if (loading || !hasMore) return;

    const nextPage = page + 1;
    setLoading(true);
    setError(null);

    try {
      const data = await getSiteEvents(siteId, selectedWindowHours, PAGE_SIZE, nextPage);
      const batch = Array.isArray(data) ? data : [];

      setEvents((prev) => [...prev, ...batch]);
      setPage(nextPage);
      setHasMore(batch.length === PAGE_SIZE);
    } catch (e: any) {
      setError(
        normalizeApiError(
          e,
          t("siteTimeline.errors.fetchMore", {
            defaultValue: "Failed to fetch more activity.",
          })
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const handleWindowChange = (hours: number) => {
    if (!isFiniteNumber(hours)) return;
    if (hours === selectedWindowHours) return;
    setSelectedWindowHours(hours);
  };

  const hasEvents = events.length > 0;

  return (
    <div className="cei-card" style={{ padding: "1.1rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "0.75rem",
          marginBottom: "0.7rem",
        }}
      >
        <div>
          <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
            {t("siteTimeline.title", { defaultValue: "Recent activity" })}
          </div>
          <div style={{ marginTop: "0.2rem", fontSize: "0.8rem", color: "var(--cei-text-muted)" }}>
            {t("siteTimeline.subtitle", {
              defaultValue:
                "Operator notes, ingestion events, and other site-level activity within the selected lookback window.",
            })}
          </div>
        </div>

        {/* lookback filters */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
          {windowOptions.map((opt) => {
            const active = selectedWindowHours === opt.hours;
            return (
              <button
                key={opt.hours}
                type="button"
                onClick={() => handleWindowChange(opt.hours)}
                className="cei-btn cei-btn-ghost"
                aria-pressed={active}
                style={{
                  fontSize: "0.72rem",
                  padding: "0.25rem 0.6rem",
                  borderRadius: "999px",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && !hasEvents && (
        <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", padding: "0.5rem 0" }}>
          {t("siteTimeline.loading", { defaultValue: "Loading timeline…" })}
        </div>
      )}

      {error && (
        <div style={{ fontSize: "0.8rem", color: "var(--cei-text-danger)", padding: "0.5rem 0" }}>
          {error}
        </div>
      )}

      {!loading && !error && !hasEvents && (
        <div style={{ fontSize: "0.8rem", color: "var(--cei-text-muted)", padding: "0.5rem 0" }}>
          {t("siteTimeline.empty", { defaultValue: "No recent activity for this site." })}
        </div>
      )}

      {!error && hasEvents && (
        <>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            {events.map((ev) => (
              <li
                key={ev.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.65rem",
                  padding: "0.65rem 0.65rem",
                  borderRadius: "0.75rem",
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  background: "rgba(15, 23, 42, 0.65)",
                }}
              >
                {/* type-aware dot */}
                <div
                  style={{
                    marginTop: "0.1rem",
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    background: eventAccent(ev.type),
                    border: "1px solid rgba(226, 232, 240, 0.35)",
                    boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
                  }}
                  title={ev.type}
                >
                  <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#fff" }}>
                    {eventIconSymbol(ev.type)}
                  </span>
                </div>

                {/* content */}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--cei-text-muted)" }}>
                    {formatEventTime(ev.created_at)}
                  </div>

                  <div style={{ marginTop: "0.15rem", fontSize: "0.88rem", color: "var(--cei-text-main)", fontWeight: 600 }}>
                    {ev.title?.trim()
                      ? ev.title
                      : t("siteTimeline.noTitle", { defaultValue: "(no title)" })}
                  </div>

                  {ev.body && (
                    <div style={{ marginTop: "0.15rem", fontSize: "0.82rem", color: "var(--cei-text-muted)", lineHeight: 1.45 }}>
                      {ev.body}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* pagination */}
          {hasMore && (
            <div style={{ marginTop: "0.85rem", display: "flex", justifyContent: "center" }}>
              <button
                type="button"
                onClick={handleLoadMore}
                className="cei-btn cei-btn-ghost"
                disabled={loading}
                style={{ fontSize: "0.78rem", padding: "0.35rem 0.9rem" }}
              >
                {loading
                  ? t("common.loadingEllipsis", { defaultValue: "Loading…" })
                  : t("siteTimeline.loadMore", { defaultValue: "Load more" })}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Map event types → accent colors
function eventAccent(type: string): string {
  if (!type) return "rgba(148, 163, 184, 0.5)";

  const t = type.toLowerCase();

  if (t.includes("critical")) return "rgba(239, 68, 68, 0.85)"; // red
  if (t.includes("warning")) return "rgba(245, 158, 11, 0.85)"; // amber
  if (t.includes("alert")) return "rgba(56, 189, 248, 0.85)"; // sky/cyan
  if (t.includes("baseline")) return "rgba(139, 92, 246, 0.85)"; // violet
  if (t.includes("forecast")) return "rgba(34, 197, 94, 0.85)"; // green
  if (t.includes("ingest")) return "rgba(59, 130, 246, 0.85)"; // blue
  if (t.includes("operator") || t.includes("note")) return "rgba(16, 185, 129, 0.85)"; // emerald

  return "rgba(148, 163, 184, 0.5)";
}

// coarse icon symbol per event type
function eventIconSymbol(type: string): string {
  if (!type) return "•";
  const t = type.toLowerCase();

  if (t.includes("critical")) return "!";
  if (t.includes("warning")) return "!";
  if (t.includes("alert")) return "A";
  if (t.includes("forecast")) return "F";
  if (t.includes("baseline")) return "B";
  if (t.includes("ingest")) return "I";
  if (t.includes("operator") || t.includes("note")) return "N";

  return "•";
}
