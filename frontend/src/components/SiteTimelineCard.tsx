import { useEffect, useState } from "react";
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

export default function SiteTimelineCard({
  siteId,
  windowHours = DEFAULT_WINDOW_HOURS,
  refreshKey,
}: Props) {
  const [events, setEvents] = useState<SiteEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // NEW: internal state for selected lookback window + pagination
  const [selectedWindowHours, setSelectedWindowHours] =
    useState<number>(windowHours || DEFAULT_WINDOW_HOURS);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);

  // Initial + refetch load (page 1)
  useEffect(() => {
    let ignore = false;

    async function loadFirstPage() {
      try {
        setLoading(true);
        setError(null);
        setPage(1);

        const data = await getSiteEvents(
          siteId,
          selectedWindowHours,
          PAGE_SIZE,
          1
        );

        if (ignore) return;

        const list = data || [];
        setEvents(list);
        setHasMore(list.length === PAGE_SIZE);
      } catch (e: any) {
        if (ignore) return;
        setError("Failed to fetch site activity.");
      } finally {
        if (ignore) return;
        setLoading(false);
      }
    }

    loadFirstPage();
    return () => {
      ignore = true;
    };
  }, [siteId, selectedWindowHours, refreshKey]);

  const handleLoadMore = async () => {
    if (loading || !hasMore) return;

    const nextPage = page + 1;
    setLoading(true);
    setError(null);

    try {
      const data = await getSiteEvents(
        siteId,
        selectedWindowHours,
        PAGE_SIZE,
        nextPage
      );
      const batch = data || [];

      setEvents((prev) => [...prev, ...batch]);
      setPage(nextPage);
      setHasMore(batch.length === PAGE_SIZE);
    } catch (e: any) {
      setError("Failed to fetch more activity.");
    } finally {
      setLoading(false);
    }
  };

  const handleWindowChange = (hours: number) => {
    if (hours === selectedWindowHours) return;
    setSelectedWindowHours(hours);
  };

  const hasEvents = events.length > 0;

  return (
    <div className="bg-[#1b1c1f] rounded-xl p-5 shadow-md border border-[#2a2d31]">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold text-white">
          Recent Activity
        </h2>

        {/* NEW: lookback filters */}
        <div className="flex items-center space-x-2 text-xs">
          {[
            { label: "24h", hours: 24 },
            { label: "7 days", hours: 168 },
            { label: "30 days", hours: 720 },
          ].map((opt) => {
            const active = selectedWindowHours === opt.hours;
            return (
              <button
                key={opt.hours}
                type="button"
                onClick={() => handleWindowChange(opt.hours)}
                className={`px-2 py-1 rounded-full border text-xs ${
                  active
                    ? "border-cyan-400 text-cyan-300 bg-cyan-900/30"
                    : "border-[#3a3d42] text-gray-400 hover:border-cyan-500 hover:text-cyan-300"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && !hasEvents && (
        <div className="text-gray-400 text-sm py-4">
          Loading timeline…
        </div>
      )}

      {error && (
        <div className="text-red-400 text-sm py-4">{error}</div>
      )}

      {!loading && !error && !hasEvents && (
        <div className="text-gray-500 text-sm py-4">
          No recent activity for this site.
        </div>
      )}

      {!error && hasEvents && (
        <>
          <ul className="space-y-4 mt-1">
            {events.map((ev) => (
              <li key={ev.id} className="flex items-start space-x-3">
                {/* NEW: iconized dot, type-aware */}
                <div
                  className="mt-0.5 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: eventAccent(ev.type) }}
                  title={ev.type}
                >
                  <span className="text-[10px] font-semibold text-white">
                    {eventIconSymbol(ev.type)}
                  </span>
                </div>

                {/* Content */}
                <div>
                  <div className="text-sm text-gray-300">
                    {new Date(ev.created_at).toLocaleString()}
                  </div>

                  <div className="text-white font-medium">
                    {ev.title || "(no title)"}
                  </div>

                  {ev.body && (
                    <div className="text-gray-400 text-sm">
                      {ev.body}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* NEW: Load more pagination control */}
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={handleLoadMore}
                className="px-3 py-1.5 text-xs rounded-full border border-[#3a3d42] text-gray-300 hover:border-cyan-500 hover:text-cyan-300 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? "Loading…" : "Load more"}
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
  if (!type) return "#6b7280"; // gray-500

  const t = type.toLowerCase();

  if (t.includes("critical")) return "#ef4444"; // red-500
  if (t.includes("warning")) return "#f59e0b"; // amber-500
  if (t.includes("alert")) return "#0ea5e9"; // cyan-500
  if (t.includes("baseline")) return "#8b5cf6"; // violet-500
  if (t.includes("forecast")) return "#22c55e"; // green-500
  if (t.includes("ingest")) return "#3b82f6"; // blue-500
  if (t.includes("operator") || t.includes("note")) return "#10b981"; // emerald-ish

  return "#6b7280"; // neutral gray
}

// NEW: coarse icon symbol per event type
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
