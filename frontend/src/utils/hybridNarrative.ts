// frontend/src/utils/hybridNarrative.ts
export type HybridNarrative = {
  headline: string;
  bullets: string[];
};

export function buildHybridNarrative(
  insights: any,
  forecast: any
): HybridNarrative | null {
  if (
    !insights ||
    !forecast ||
    !Array.isArray(forecast.points) ||
    forecast.points.length === 0
  ) {
    return null;
  }

  const deviation =
    typeof insights.deviation_pct === "number"
      ? insights.deviation_pct
      : null;
  const totalActual =
    typeof insights.total_actual_kwh === "number"
      ? insights.total_actual_kwh
      : null;
  const totalExpected =
    typeof insights.total_expected_kwh === "number"
      ? insights.total_expected_kwh
      : null;
  const critHours =
    typeof insights.critical_hours === "number"
      ? insights.critical_hours
      : null;
  const elevHours =
    typeof insights.elevated_hours === "number"
      ? insights.elevated_hours
      : null;
  const belowHours =
    typeof insights.below_baseline_hours === "number"
      ? insights.below_baseline_hours
      : null;
  const baselineDays =
    typeof insights.baseline_lookback_days === "number"
      ? insights.baseline_lookback_days
      : null;

  const points = forecast.points as Array<{
    ts: string;
    expected_kwh: number;
  }>;

  let totalNext24 = 0;
  let peak = { ts: "", value: 0 };

  for (const p of points) {
    const v = Number(p.expected_kwh || 0);
    totalNext24 += v;
    if (v > peak.value) {
      peak = { ts: p.ts, value: v };
    }
  }

  const peakDate = peak.ts ? new Date(peak.ts) : null;
  const peakLabel =
    peakDate && !isNaN(peakDate.getTime())
      ? peakDate.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  const headlineParts: string[] = [];
  if (deviation !== null) {
    headlineParts.push(
      deviation > 0
        ? `Running +${deviation.toFixed(1)}% vs baseline`
        : `${deviation.toFixed(1)}% vs baseline`
    );
  }
  if (totalActual !== null && totalExpected !== null) {
    headlineParts.push(
      `Actual ${totalActual.toFixed(0)} kWh vs expected ${totalExpected.toFixed(
        0
      )} kWh`
    );
  }

  const headline =
    headlineParts.length > 0
      ? headlineParts.join(" · ")
      : "Hybrid view: baseline deviation and 24h forecast";

  const bullets: string[] = [];

  if (critHours !== null || elevHours !== null || belowHours !== null) {
    bullets.push(
      `Baseline bands (last window): critical ${critHours ?? 0}h, warning ${
        elevHours ?? 0
      }h, below-baseline ${belowHours ?? 0}h.`
    );
  }

  bullets.push(
    `Next 24h forecast: ~${totalNext24.toFixed(
      0
    )} kWh total, peak ~${peak.value.toFixed(1)} kWh around ${peakLabel}.`
  );

  if (baselineDays !== null) {
    bullets.push(
      `Baseline trained on the last ${baselineDays} days of data.`
    );
  }

  if (deviation !== null && deviation > 30) {
    bullets.push(
      "Takeaway: this site is materially above its learned baseline. Prioritize shutdown routines, night/weekend idle loads, and peak smoothing."
    );
  } else if (deviation !== null && deviation < -10) {
    bullets.push(
      "Takeaway: this site is running below its learned baseline. Check if recent changes are deliberate (efficiency project) or due to under-utilization."
    );
  } else {
    bullets.push(
      "Takeaway: this site is roughly in line with its baseline. Focus on local peaks and specific process steps rather than whole-site baseload."
    );
  }

  return { headline, bullets };
}
