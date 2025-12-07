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

export default function SiteTimelineCard({
  siteId,
  windowHours = 168,
  refreshKey,
}: Props) {
  const [events, setEvents] = useState<SiteEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        setLoading(true);
        const data = await getSiteEvents(siteId, windowHours, 100);
        if (!ignore) {
          setEvents(data || []);
          setError(null);
        }
      } catch (e: any) {
        if (!ignore) {
          setError("Failed to fetch site activity.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [siteId, windowHours, refreshKey]);

  return (
    <div className="bg-[#1b1c1f] rounded-xl p-5 shadow-md border border-[#2a2d31]">
      <h2 className="text-xl font-semibold mb-3 text-white">
        Recent Activity
      </h2>

      {loading && (
        <div className="text-gray-400 text-sm py-4">
          Loading timeline…
        </div>
      )}

      {error && (
        <div className="text-red-400 text-sm py-4">{error}</div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="text-gray-500 text-sm py-4">
          No recent activity for this site.
        </div>
      )}

      {!loading && !error && events.length > 0 && (
        <ul className="space-y-4">
          {events.map((ev) => (
            <li key={ev.id} className="flex items-start space-x-3">
              {/* Dot */}
              <div
                className="mt-1 w-2 h-2 rounded-full"
                style={{ background: eventAccent(ev.type) }}
              />

              {/* Content */}
              <div>
                <div className="text-sm text-gray-300">
                  {new Date(ev.created_at).toLocaleString()}
                </div>

                <div className="text-white font-medium">
                  {ev.title}
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

  return "#6b7280"; // neutral gray
}
