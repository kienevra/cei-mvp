import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getSites,
  getTimeseriesSummary,
  getAccountMe,
  getSiteInsights,
  getSiteOpportunities,
} from "../services/api";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorBanner from "../components/ErrorBanner";
import { downloadCsv } from "../utils/csv";

type SiteRecord = {
  id: number | string;
  name: string;
  location?: string | null;
  [key: string]: any;
};

type SummaryResponse = {
  site_id: string | null;
  meter_id: string | null;
  window_hours: number;
  total_value: number;
  points: number;
  from_timestamp: string | null;
  to_timestamp: string | null;
};

type SiteReportRow = {
  siteId: string;
  siteName: string;
  location?: string | null;
  totalKwh7d: number;
  points7d: number;
  avgPerPoint7d: number | null;
  // statistical enrichments from analytics insights (7-day window)
  deviationPct7d: number | null;
  expectedKwh7d: number | null;
  criticalHours7d: number | null;
  elevatedHours7d: number | null;
  belowBaselineHours7d: number | null;
  baselineDays7d: number | null;
  statsSource: string | null;
  // cost analytics (derived via org tariff)
  totalCost7d: number | null;
  expectedCost7d: number | null;
  costDelta7d: number | null;
};

type SiteOpportunityRow = {
  siteId: string;
  siteName: string;
  location?: string | null;
  id: number;
  name: string;
  description: string;
  est_annual_kwh_saved: number;
  est_co2_tons_saved_per_year: number;
  est_annual_cost_saved: number | null;
};

const Reports: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [portfolioSummary, setPortfolioSummary] =
    useState<SummaryResponse | null>(null);
  const [siteRows, setSiteRows] = useState<SiteReportRow[]>([]);

  // Plan flags coming from /account/me (backend: AccountMe/OrgSummaryOut)
  const [planKey, setPlanKey] = useState<string>("cei-starter");
  const [enableReports, setEnableReports] = useState<boolean>(true);

  // Pricing context (org/account-level tariffs)
  const [electricityPricePerKwh, setElectricityPricePerKwh] =
    useState<number | null>(null);
  const [currencyCode, setCurrencyCode] = useState<string>("EUR");
  const [primaryEnergySources, setPrimaryEnergySources] = useState<
    string[] | null
  >(null);

  // Portfolio opportunities state (derived from /sites/{id}/opportunities)
  const [topOpportunities, setTopOpportunities] = useState<
    SiteOpportunityRow[]
  >([]);
  const [opportunitiesError, setOpportunitiesError] = useState<string | null>(
    null
  );

  useEffect(() => {
    let isMounted = true;

    async function loadReport() {
      setLoading(true);
      setError(null);
      setTopOpportunities([]);
      setOpportunitiesError(null);

      try {
        // 0) Pull account + plan flags (treat as any for forward-compatible fields)
        const account = await getAccountMe().catch(() => null);
        if (!isMounted) return;

        const accountAny: any = account || {};

        const org = accountAny.org ?? accountAny.organization ?? null;

        const derivedPlanKey: string =
          org?.subscription_plan_key ||
          org?.plan_key ||
          accountAny.subscription_plan_key ||
          "cei-starter";

        // Backend might already send explicit flags; if not, derive from plan
        const backendEnableReports: boolean | undefined =
          accountAny.enable_reports ?? org?.enable_reports;

        const effectiveEnableReports =
          typeof backendEnableReports === "boolean"
            ? backendEnableReports
            : derivedPlanKey === "cei-starter" ||
              derivedPlanKey === "cei-growth";

        setPlanKey(derivedPlanKey);
        setEnableReports(effectiveEnableReports);

        // Pricing context: tariffs + energy mix
        const tariffElectricity: number | null =
          typeof org?.electricity_price_per_kwh === "number"
            ? org.electricity_price_per_kwh
            : typeof accountAny.electricity_price_per_kwh === "number"
            ? accountAny.electricity_price_per_kwh
            : null;

        const derivedCurrencyCode: string =
          typeof org?.currency_code === "string"
            ? org.currency_code
            : typeof accountAny.currency_code === "string"
            ? accountAny.currency_code
            : "EUR";

        const primarySources: string[] | null = Array.isArray(
          org?.primary_energy_sources
        )
          ? org.primary_energy_sources
          : Array.isArray(accountAny.primary_energy_sources)
          ? accountAny.primary_energy_sources
          : null;

        setElectricityPricePerKwh(tariffElectricity);
        setCurrencyCode(derivedCurrencyCode);
        setPrimaryEnergySources(primarySources);

        // If the plan doesn't include reports, stop here:
        if (!effectiveEnableReports) {
          setLoading(false);
          return;
        }

        // 1) Fetch sites
        const siteList = await getSites();
        if (!isMounted) return;

        const normalizedSites = Array.isArray(siteList)
          ? (siteList as SiteRecord[])
          : [];
        setSites(normalizedSites);

        // 2) Portfolio summary – all sites, last 7 days (168 hours)
        const portfolio = (await getTimeseriesSummary({
          window_hours: 168,
        })) as SummaryResponse;
        if (!isMounted) return;
        setPortfolioSummary(portfolio);

        const hasTariffNumeric =
          typeof tariffElectricity === "number" && tariffElectricity > 0;

        // 3) Per-site summaries + statistical insights (7-day window)
        const siteSummaries = await Promise.all(
          normalizedSites.map(async (site) => {
            const idStr = String(site.id);
            const siteKey = `site-${idStr}`;

            let summary: SummaryResponse | null = null;
            let insights: any | null = null;

            try {
              summary = (await getTimeseriesSummary({
                site_id: siteKey,
                window_hours: 168,
              })) as SummaryResponse;
            } catch {
              summary = null;
            }

            try {
              // only pass 2 args (siteId, window_hours), rely on backend default lookback_days
              insights = await getSiteInsights(siteKey, 168).catch(
                () => null
              );
            } catch {
              insights = null;
            }

            return { site, summary, insights };
          })
        );

        if (!isMounted) return;

        const rows: SiteReportRow[] = siteSummaries.map(
          ({ site, summary, insights }) => {
            const idStr = String(site.id);
            const total = summary?.total_value || 0;
            const points = summary?.points || 0;
            const avgPerPoint = points > 0 ? total / points : null;

            const deviationPct7d =
              typeof insights?.deviation_pct === "number"
                ? Number.isFinite(insights.deviation_pct)
                  ? insights.deviation_pct
                  : null
                : null;

            const expectedKwh7d =
              typeof insights?.total_expected_kwh === "number"
                ? Number.isFinite(insights.total_expected_kwh)
                  ? insights.total_expected_kwh
                  : null
                : null;

            const criticalHours7d =
              typeof insights?.critical_hours === "number"
                ? insights.critical_hours
                : null;

            const elevatedHours7d =
              typeof insights?.elevated_hours === "number"
                ? insights.elevated_hours
                : null;

            const belowBaselineHours7d =
              typeof insights?.below_baseline_hours === "number"
                ? insights.below_baseline_hours
                : null;

            const baselineDays7d =
              typeof insights?.baseline_lookback_days === "number"
                ? insights.baseline_lookback_days
                : null;

            const statsSource =
              typeof insights?.stats_source === "string"
                ? insights.stats_source
                : null;

            const totalCost7d =
              hasTariffNumeric && Number.isFinite(total)
                ? total * (tariffElectricity as number)
                : null;

            const expectedCost7d =
              hasTariffNumeric &&
              typeof expectedKwh7d === "number" &&
              Number.isFinite(expectedKwh7d)
                ? expectedKwh7d * (tariffElectricity as number)
                : null;

            let costDelta7d: number | null = null;
            if (
              totalCost7d !== null &&
              expectedCost7d !== null &&
              Number.isFinite(totalCost7d) &&
              Number.isFinite(expectedCost7d)
            ) {
              costDelta7d = totalCost7d - expectedCost7d;
            }

            return {
              siteId: idStr,
              siteName: site.name || `Site ${idStr}`,
              location: site.location,
              totalKwh7d: total,
              points7d: points,
              avgPerPoint7d: avgPerPoint,
              deviationPct7d,
              expectedKwh7d,
              criticalHours7d,
              elevatedHours7d,
              belowBaselineHours7d,
              baselineDays7d,
              statsSource,
              totalCost7d,
              expectedCost7d,
              costDelta7d,
            };
          }
        );

        setSiteRows(rows);

        // 4) Per-site opportunities (portfolio “top measures” view; cost-first when tariff available)
        try {
          if (normalizedSites.length === 0) {
            setTopOpportunities([]);
          } else {
            const oppResults = await Promise.all(
              normalizedSites.map(async (site) => {
                const idStr = String(site.id);
                try {
                  const oppList = await getSiteOpportunities(idStr);
                  const normalizedOpps = Array.isArray(oppList)
                    ? oppList
                    : [];
                  return { site, opportunities: normalizedOpps };
                } catch {
                  return { site, opportunities: [] };
                }
              })
            );

            if (!isMounted) return;

            const oppRows: SiteOpportunityRow[] = oppResults.flatMap(
              ({ site, opportunities }) => {
                const idStr = String(site.id);

                // Take best 1–3 per site by estimated annual cost savings (fallback: kWh)
                const topForSite = [...opportunities]
                  .sort((a: any, b: any) => {
                    const aKwh =
                      typeof a.est_annual_kwh_saved === "number"
                        ? a.est_annual_kwh_saved
                        : 0;
                    const bKwh =
                      typeof b.est_annual_kwh_saved === "number"
                        ? b.est_annual_kwh_saved
                        : 0;

                    if (
                      hasTariffNumeric &&
                      typeof tariffElectricity === "number" &&
                      tariffElectricity > 0
                    ) {
                      const aCost = aKwh * tariffElectricity;
                      const bCost = bKwh * tariffElectricity;
                      if (aCost !== bCost) {
                        return bCost - aCost; // highest € saved first
                      }
                    }

                    // fallback to kWh ranking
                    return bKwh - aKwh;
                  })
                  .slice(0, 3);

                return topForSite.map((opp: any) => {
                  const kwhSaved =
                    typeof opp.est_annual_kwh_saved === "number" &&
                    Number.isFinite(opp.est_annual_kwh_saved)
                      ? opp.est_annual_kwh_saved
                      : null;

                  const estAnnualCostSaved =
                    hasTariffNumeric &&
                    typeof tariffElectricity === "number" &&
                    kwhSaved !== null
                      ? kwhSaved * tariffElectricity
                      : null;

                  return {
                    siteId: idStr,
                    siteName: site.name || `Site ${idStr}`,
                    location: site.location,
                    id: opp.id,
                    name: opp.name,
                    description: opp.description,
                    est_annual_kwh_saved: opp.est_annual_kwh_saved,
                    est_co2_tons_saved_per_year:
                      opp.est_co2_tons_saved_per_year,
                    est_annual_cost_saved: estAnnualCostSaved,
                  };
                });
              }
            );

            setTopOpportunities(oppRows);
            setOpportunitiesError(null);
          }
        } catch (e: any) {
          if (!isMounted) return;
          setTopOpportunities([]);
          setOpportunitiesError(
            e?.message || "Failed to load opportunity measures."
          );
        }
      } catch (e: any) {
        if (!isMounted) return;
        setError(e?.message || "Failed to load reports.");
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }

    loadReport();

    return () => {
      isMounted = false;
    };
  }, []);

  const totalSites = sites.length;
  const totalKwh7d = portfolioSummary?.total_value || 0;
  const totalPoints7d = portfolioSummary?.points || 0;

  const formattedTotalKwh7d =
    totalKwh7d === 0
      ? "—"
      : totalKwh7d >= 1000
      ? `${(totalKwh7d / 1000).toFixed(2)} MWh`
      : `${totalKwh7d.toFixed(1)} kWh`;

  const avgPerSite =
    totalSites > 0 ? totalKwh7d / Math.max(totalSites, 1) : 0;
  const formattedAvgPerSite =
    avgPerSite === 0
      ? "—"
      : avgPerSite >= 1000
      ? `${(avgPerSite / 1000).toFixed(2)} MWh`
      : `${avgPerSite.toFixed(1)} kWh`;

  const sitesWithDataCount = siteRows.filter((r) => r.points7d > 0).length;

  const hasTariff =
    typeof electricityPricePerKwh === "number" &&
    electricityPricePerKwh > 0;

  const formatCurrency = (value: number | null, code: string): string => {
    if (value === null || !Number.isFinite(value)) return "—";
    const safeCode = code || "EUR";
    try {
      return value.toLocaleString(undefined, {
        style: "currency",
        currency: safeCode,
        maximumFractionDigits: 0,
      });
    } catch {
      return `${value.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })} ${safeCode}`;
    }
  };

  const formatTariffPerKwh = (
    value: number | null,
    code: string
  ): string => {
    if (value === null || !Number.isFinite(value)) return "—";
    const safeCode = code || "EUR";
    try {
      return value.toLocaleString(undefined, {
        style: "currency",
        currency: safeCode,
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      });
    } catch {
      return `${value.toFixed(4)} ${safeCode}`;
    }
  };

  // Portfolio-level cost metrics (simple tariff * kWh)
  const portfolioCost7d =
    hasTariff && electricityPricePerKwh !== null
      ? totalKwh7d * electricityPricePerKwh
      : null;

  const avgCostPerActiveSite =
    hasTariff &&
    portfolioCost7d !== null &&
    sitesWithDataCount > 0
      ? portfolioCost7d / sitesWithDataCount
      : null;

  const pricePerMwh =
    hasTariff && electricityPricePerKwh !== null
      ? electricityPricePerKwh * 1000
      : null;

  // Max site kWh for bar scaling (used by the mini chart)
  const maxSiteTotalKwh = siteRows.reduce(
    (max, row) => (row.totalKwh7d > max ? row.totalKwh7d : max),
    0
  );

  // Cost-first ranking: sort by € delta vs baseline, then total cost, then kWh
  const sortedSiteRows: SiteReportRow[] = (() => {
    if (!siteRows.length) return [];
    const clone = [...siteRows];
    clone.sort((a, b) => {
      if (hasTariff) {
        const aDelta =
          typeof a.costDelta7d === "number" && Number.isFinite(a.costDelta7d)
            ? a.costDelta7d
            : 0;
        const bDelta =
          typeof b.costDelta7d === "number" && Number.isFinite(b.costDelta7d)
            ? b.costDelta7d
            : 0;
        if (aDelta !== bDelta) {
          // Overspend (positive € delta) at the top
          return bDelta - aDelta;
        }

        const aCost =
          typeof a.totalCost7d === "number" && Number.isFinite(a.totalCost7d)
            ? a.totalCost7d
            : 0;
        const bCost =
          typeof b.totalCost7d === "number" && Number.isFinite(b.totalCost7d)
            ? b.totalCost7d
            : 0;
        if (aCost !== bCost) {
          return bCost - aCost;
        }
      }

      // Fallback: high-energy sites first
      return b.totalKwh7d - a.totalKwh7d;
    });
    return clone;
  })();

  // --- CSV export via shared helper (7-day site reports) ---
  const handleDownloadCsv = () => {
    if (!enableReports) {
      alert("Reports are not enabled for this plan.");
      return;
    }
    if (!siteRows.length) {
      alert("No site data available to export yet.");
      return;
    }

    const tariff =
      hasTariff && electricityPricePerKwh != null
        ? electricityPricePerKwh
        : null;

    const rows = siteRows.map((row) => {
      const hasRowEnergy =
        Number.isFinite(row.totalKwh7d) && row.totalKwh7d > 0;

      const computedTotalCost7d =
        row.totalCost7d !== null && Number.isFinite(row.totalCost7d)
          ? row.totalCost7d
          : tariff !== null && hasRowEnergy
          ? row.totalKwh7d * tariff
          : null;

      const computedExpectedCost7d =
        row.expectedCost7d !== null && Number.isFinite(row.expectedCost7d)
          ? row.expectedCost7d
          : tariff !== null &&
            row.expectedKwh7d !== null &&
            Number.isFinite(row.expectedKwh7d)
          ? row.expectedKwh7d * tariff
          : null;

      const computedCostDelta7d =
        row.costDelta7d !== null && Number.isFinite(row.costDelta7d)
          ? row.costDelta7d
          : computedTotalCost7d !== null && computedExpectedCost7d !== null
          ? computedTotalCost7d - computedExpectedCost7d
          : null;

      return {
        // core IDs / descriptors
        site_id: row.siteId,
        site_name: row.siteName,
        location: row.location ?? "",
        // energy stats
        total_kwh_7d: hasRowEnergy
          ? row.totalKwh7d.toFixed(2)
          : "",
        points_7d: row.points7d,
        avg_kwh_per_point_7d:
          row.avgPerPoint7d !== null &&
          Number.isFinite(row.avgPerPoint7d)
            ? row.avgPerPoint7d.toFixed(4)
            : "",
        deviation_pct_7d:
          row.deviationPct7d !== null &&
          Number.isFinite(row.deviationPct7d)
            ? row.deviationPct7d.toFixed(2)
            : "",
        expected_kwh_7d:
          row.expectedKwh7d !== null &&
          Number.isFinite(row.expectedKwh7d)
            ? row.expectedKwh7d.toFixed(2)
            : "",
        critical_hours_7d:
          row.criticalHours7d !== null ? row.criticalHours7d : "",
        elevated_hours_7d:
          row.elevatedHours7d !== null ? row.elevatedHours7d : "",
        below_baseline_hours_7d:
          row.belowBaselineHours7d !== null
            ? row.belowBaselineHours7d
            : "",
        baseline_lookback_days_7d:
          row.baselineDays7d !== null ? row.baselineDays7d : "",
        stats_source: row.statsSource ?? "",
        // cost analytics (derived, portfolio-level tariff)
        total_cost_7d:
          computedTotalCost7d !== null &&
          Number.isFinite(computedTotalCost7d)
            ? computedTotalCost7d.toFixed(2)
            : "",
        expected_cost_7d:
          computedExpectedCost7d !== null &&
          Number.isFinite(computedExpectedCost7d)
            ? computedExpectedCost7d.toFixed(2)
            : "",
        cost_delta_7d:
          computedCostDelta7d !== null &&
          Number.isFinite(computedCostDelta7d)
            ? computedCostDelta7d.toFixed(2)
            : "",
        avg_cost_per_kwh_7d:
          tariff !== null && hasRowEnergy
            ? tariff.toFixed(6)
            : "",
        price_per_mwh_anchor:
          pricePerMwh !== null && Number.isFinite(pricePerMwh)
            ? pricePerMwh.toFixed(2)
            : "",
        currency_code: currencyCode || "EUR",
        tariff_electricity_price_per_kwh:
          tariff !== null && Number.isFinite(tariff)
            ? tariff.toFixed(6)
            : "",
      };
    });

    downloadCsv("cei_7day_site_reports.csv", rows);
  };

  // --- CSV export for portfolio opportunities ---
  const handleDownloadOpportunitiesCsv = () => {
    if (!enableReports) {
      alert("Reports are not enabled for this plan.");
      return;
    }
    if (!topOpportunities.length) {
      alert("No opportunity data available to export yet.");
      return;
    }

    const tariff =
      hasTariff && electricityPricePerKwh != null
        ? electricityPricePerKwh
        : null;

    const rows = topOpportunities.map((row) => {
      const hasKwh =
        typeof row.est_annual_kwh_saved === "number" &&
        Number.isFinite(row.est_annual_kwh_saved) &&
        row.est_annual_kwh_saved > 0;

      const estAnnualCostSaved =
        row.est_annual_cost_saved !== null &&
        Number.isFinite(row.est_annual_cost_saved)
          ? row.est_annual_cost_saved
          : tariff !== null && hasKwh
          ? row.est_annual_kwh_saved * tariff
          : null;

      return {
        site_id: row.siteId,
        site_name: row.siteName,
        location: row.location ?? "",
        opportunity_id: row.id,
        opportunity_name: row.name,
        description: row.description,
        est_annual_kwh_saved: hasKwh
          ? row.est_annual_kwh_saved.toFixed(0)
          : "",
        est_annual_cost_saved:
          estAnnualCostSaved !== null &&
          Number.isFinite(estAnnualCostSaved)
            ? estAnnualCostSaved.toFixed(2)
            : "",
        est_co2_tons_saved_per_year:
          Number.isFinite(row.est_co2_tons_saved_per_year)
            ? row.est_co2_tons_saved_per_year.toFixed(2)
            : "",
        currency_code: currencyCode || "EUR",
        tariff_electricity_price_per_kwh:
          tariff !== null && Number.isFinite(tariff)
            ? tariff.toFixed(6)
            : "",
        price_per_mwh_anchor:
          pricePerMwh !== null && Number.isFinite(pricePerMwh)
            ? pricePerMwh.toFixed(2)
            : "",
      };
    });

    downloadCsv("cei_portfolio_opportunities.csv", rows);
  };

  return (
    <div className="dashboard-page">
      {/* Header */}
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "1rem",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "1.3rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            Reports
          </h1>
          <p
            style={{
              marginTop: "0.3rem",
              fontSize: "0.85rem",
              color: "var(--cei-text-muted)",
            }}
          >
            Portfolio snapshot for the last 7 days. Built directly on top of
            the CEI timeseries engine, its learned baselines, and your
            configured tariffs.
          </p>
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--cei-text-muted)",
            textAlign: "right",
          }}
        >
          <div>Window: last 7 days (168 hours)</div>
          {totalSites > 0 && (
            <div>
              Sites: <strong>{totalSites}</strong>
            </div>
          )}
        </div>
      </section>

      {/* Error banner */}
      {error && (
        <section style={{ marginTop: "0.75rem" }}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
        </section>
      )}

      {/* Upgrade gating banner */}
      {!loading && !enableReports && (
        <section style={{ marginTop: "0.9rem" }}>
          <div
            className="cei-card"
            style={{
              border: "1px solid rgba(250,204,21,0.7)",
              background:
                "linear-gradient(135deg, rgba(30,64,175,0.7), rgba(15,23,42,0.95))",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                }}
              >
                Upgrade to unlock portfolio reports
              </div>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "var(--cei-text-muted)",
                  maxWidth: "40rem",
                }}
              >
                Your current plan (<code>{planKey}</code>) does not include
                the 7-day portfolio reporting layer. Upgrade to CEI Starter
                or above to see fleet-level kWh, cost KPIs, and
                export-ready summaries.
              </div>
              <div
                style={{
                  marginTop: "0.4rem",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <Link to="/account">
                  <button className="cei-btn cei-btn-primary">
                    View plans &amp; billing
                  </button>
                </Link>
                <span
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Reports will light up automatically as soon as your
                  subscription is active.
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* KPI row – energy (kWh) */}
      {enableReports && (
        <section className="dashboard-row">
          <div className="cei-card">
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cei-text-muted)",
              }}
            >
              Portfolio energy – last 7 days
            </div>
            <div
              style={{
                marginTop: "0.35rem",
                fontSize: "1.6rem",
                fontWeight: 600,
              }}
            >
              {loading ? "…" : formattedTotalKwh7d}
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Aggregated energy consumption across all sites over the last
              168 hours. Points:{" "}
              {loading ? "…" : totalPoints7d > 0 ? totalPoints7d : "—"}
            </div>
          </div>

          <div className="cei-card">
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cei-text-muted)",
              }}
            >
              Sites with data
            </div>
            <div
              style={{
                marginTop: "0.35rem",
                fontSize: "1.4rem",
                fontWeight: 600,
              }}
            >
              {loading ? "…" : sitesWithDataCount || "0"}
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Number of sites reporting at least one timeseries point in the
              last week.
            </div>
          </div>

          <div className="cei-card">
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cei-text-muted)",
              }}
            >
              Avg energy per site – 7 days
            </div>
            <div
              style={{
                marginTop: "0.35rem",
                fontSize: "1.4rem",
                fontWeight: 600,
              }}
            >
              {loading ? "…" : formattedAvgPerSite}
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              Simple average of portfolio energy divided by monitored sites.
            </div>
          </div>
        </section>
      )}

      {/* KPI row – cost (€) */}
      {enableReports && (
        <section className="dashboard-row">
          <div className="cei-card">
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cei-text-muted)",
              }}
            >
              Portfolio energy cost – last 7 days
            </div>
            <div
              style={{
                marginTop: "0.35rem",
                fontSize: "1.6rem",
                fontWeight: 600,
              }}
            >
              {loading
                ? "…"
                : hasTariff && portfolioCost7d !== null
                ? formatCurrency(portfolioCost7d, currencyCode)
                : "—"}
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              {hasTariff
                ? `Derived by applying your electricity tariff to portfolio kWh over the last 168 hours.`
                : `Set your electricity tariff in the Account page to unlock portfolio cost analytics.`}
            </div>
          </div>

          <div className="cei-card">
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cei-text-muted)",
              }}
            >
              Avg cost per active site – 7 days
            </div>
            <div
              style={{
                marginTop: "0.35rem",
                fontSize: "1.4rem",
                fontWeight: 600,
              }}
            >
              {loading
                ? "…"
                : hasTariff && avgCostPerActiveSite !== null
                ? formatCurrency(avgCostPerActiveSite, currencyCode)
                : "—"}
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              {sitesWithDataCount > 0
                ? `Spread across ${sitesWithDataCount} sites with actual data in the last week.`
                : `No active sites with data yet – cost per site will appear once timeseries flows in.`}
            </div>
          </div>

          <div className="cei-card">
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cei-text-muted)",
              }}
            >
              Tariff & €/MWh anchor
            </div>
            <div
              style={{
                marginTop: "0.35rem",
                fontSize: "1.4rem",
                fontWeight: 600,
              }}
            >
              {hasTariff && pricePerMwh !== null
                ? `${formatCurrency(pricePerMwh, currencyCode)} / MWh`
                : "—"}
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                fontSize: "0.8rem",
                color: "var(--cei-text-muted)",
              }}
            >
              {hasTariff ? (
                <>
                  Tariff:{" "}
                  <strong>
                    {formatTariffPerKwh(
                      electricityPricePerKwh,
                      currencyCode
                    )}{" "}
                    / kWh
                  </strong>
                  {primaryEnergySources &&
                    primaryEnergySources.length > 0 && (
                      <>
                        {" "}
                        · primary sources:{" "}
                        <span>{primaryEnergySources.join(" + ")}</span>
                      </>
                    )}
                </>
              ) : (
                <>
                  Configure your electricity price per kWh (and currency) in
                  Account &amp; Settings to get €/MWh anchors here.
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Main table – only when reports are enabled */}
      {enableReports && (
        <section>
          <div className="cei-card">
            <div
              style={{
                marginBottom: "0.7rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: 600,
                  }}
                >
                  Site-level 7-day energy & cost
                </div>
                <div
                  style={{
                    marginTop: "0.2rem",
                    fontSize: "0.8rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Per-site energy, cost, and deviation vs baseline over the
                  last week. Sorted by € impact where tariffs are
                  configured.
                </div>
              </div>

              <div>
                <button
                  type="button"
                  className="cei-btn cei-btn-ghost"
                  onClick={handleDownloadCsv}
                  disabled={loading || !siteRows.length}
                >
                  {loading ? "Preparing…" : "Download CSV"}
                </button>
              </div>
            </div>

            {loading && (
              <div
                style={{
                  padding: "1.2rem 0.5rem",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <LoadingSpinner />
              </div>
            )}

            {!loading && sortedSiteRows.length === 0 && (
              <div
                style={{
                  fontSize: "0.85rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                No sites available yet. Once sites and timeseries are
                configured, this table will populate with 7-day energy and
                cost metrics per site.
              </div>
            )}

            {/* Simple bar chart of total_kwh_7d per site (ordered by cost when tariff is set) */}
            {!loading &&
              sortedSiteRows.length > 0 &&
              maxSiteTotalKwh > 0 && (
                <div
                  style={{
                    marginTop: "0.75rem",
                    borderRadius: "0.75rem",
                    border: "1px solid rgba(148, 163, 184, 0.5)",
                    background:
                      "radial-gradient(circle at top left, rgba(56, 189, 248, 0.08), rgba(15, 23, 42, 0.95))",
                    padding: "0.75rem",
                    boxSizing: "border-box",
                    overflowX: "auto",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "flex-start",
                      gap: "0.5rem",
                      minHeight: "180px",
                    }}
                  >
                    {sortedSiteRows.map((row) => {
                      const val = row.totalKwh7d;
                      const ratio =
                        maxSiteTotalKwh > 0 ? val / maxSiteTotalKwh : 0;
                      const heightPx =
                        val > 0 ? 20 + ratio * 140 : 0;

                      return (
                        <div
                          key={row.siteId}
                          style={{
                            flex: "0 0 auto",
                            width: "40px",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: "0.25rem",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.6rem",
                              color: "var(--cei-text-muted)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {val > 0 ? val.toFixed(0) : "—"}
                          </span>
                          <div
                            style={{
                              width: "100%",
                              height: `${heightPx}px`,
                              borderRadius: "4px",
                              background:
                                "linear-gradient(to top, rgba(56, 189, 248, 0.95), rgba(56, 189, 248, 0.25))",
                              boxShadow:
                                "0 6px 18px rgba(56, 189, 248, 0.45)",
                              border:
                                "1px solid rgba(226, 232, 240, 0.8)",
                            }}
                          />
                          <span
                            style={{
                              fontSize: "0.65rem",
                              color: "var(--cei-text-muted)",
                              textAlign: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {row.siteName.length > 8
                              ? `${row.siteName.slice(0, 7)}…`
                              : row.siteName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.75rem",
                      color: "var(--cei-text-muted)",
                    }}
                  >
                    Bar height scales with each site’s 7-day energy. Bars
                    are ordered by € impact when tariffs are configured.
                  </div>
                </div>
              )}

            {!loading && sortedSiteRows.length > 0 && (
              <div style={{ marginTop: "0.5rem", overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Site</th>
                      <th>Location</th>
                      <th>Energy (7 days)</th>
                      <th>Cost (7 days)</th>
                      <th>Expected cost (7 days)</th>
                      <th>Cost Δ vs baseline</th>
                      <th>Points</th>
                      <th>Energy / point</th>
                      <th>Deviation vs baseline</th>
                      <th>Expected (7 days)</th>
                      <th>Baseline hours (crit / warn / below)</th>
                      <th>Stats</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSiteRows.map((row) => {
                      const deviationLabel =
                        row.deviationPct7d !== null
                          ? `${row.deviationPct7d.toFixed(1)}%`
                          : "—";

                      const expectedLabel =
                        row.expectedKwh7d !== null
                          ? row.expectedKwh7d >= 1000
                            ? `${(row.expectedKwh7d / 1000).toFixed(
                                2
                              )} MWh`
                            : `${row.expectedKwh7d.toFixed(1)} kWh`
                          : "—";

                      const critLabel =
                        row.criticalHours7d !== null
                          ? row.criticalHours7d
                          : 0;
                      const elevLabel =
                        row.elevatedHours7d !== null
                          ? row.elevatedHours7d
                          : 0;
                      const belowLabel =
                        row.belowBaselineHours7d !== null
                          ? row.belowBaselineHours7d
                          : 0;

                      const costLabel =
                        hasTariff && row.totalCost7d !== null
                          ? formatCurrency(row.totalCost7d, currencyCode)
                          : "—";

                      const expectedCostLabel =
                        hasTariff && row.expectedCost7d !== null
                          ? formatCurrency(row.expectedCost7d, currencyCode)
                          : "—";

                      const costDeltaLabel =
                        hasTariff && row.costDelta7d !== null
                          ? formatCurrency(row.costDelta7d, currencyCode)
                          : "—";

                      return (
                        <tr key={row.siteId}>
                          <td>{row.siteName}</td>
                          <td>{row.location || "—"}</td>
                          <td>
                            {row.totalKwh7d > 0
                              ? `${row.totalKwh7d.toFixed(1)} kWh`
                              : "—"}
                          </td>
                          <td>{costLabel}</td>
                          <td>{expectedCostLabel}</td>
                          <td>{costDeltaLabel}</td>
                          <td>
                            {row.points7d > 0 ? row.points7d : "—"}
                          </td>
                          <td>
                            {row.avgPerPoint7d !== null
                              ? `${row.avgPerPoint7d.toFixed(2)} kWh`
                              : "—"}
                          </td>
                          <td>{deviationLabel}</td>
                          <td>{expectedLabel}</td>
                          <td>
                            {critLabel === 0 &&
                            elevLabel === 0 &&
                            belowLabel === 0
                              ? "—"
                              : `Crit: ${critLabel}, Warn: ${elevLabel}, Below: ${belowLabel}`}
                          </td>
                          <td>
                            {row.statsSource ||
                            row.baselineDays7d !== null ? (
                              <>
                                {row.statsSource && (
                                  <code>{row.statsSource}</code>
                                )}
                                {row.baselineDays7d !== null && (
                                  <span
                                    style={{
                                      marginLeft: "0.25rem",
                                      opacity: 0.8,
                                    }}
                                  >
                                    ({row.baselineDays7d} d)
                                  </span>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <Link
                              to={`/sites/${row.siteId}`}
                              style={{
                                fontSize: "0.8rem",
                                color: "var(--cei-text-accent)",
                                textDecoration: "none",
                              }}
                            >
                              View site →
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Portfolio-level opportunities view */}
      {enableReports && (
        <section style={{ marginTop: "0.9rem" }}>
          <div className="cei-card">
            <div
              style={{
                marginBottom: "0.7rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: 600,
                  }}
                >
                  Top efficiency opportunities (portfolio)
                </div>
                <div
                  style={{
                    marginTop: "0.2rem",
                    fontSize: "0.8rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  Highest-impact measures per site, ranked by estimated
                  annual cost savings when tariffs are configured (falling
                  back to kWh). Use this as a punch-list with local teams:
                  tackle the biggest € levers first.
                </div>
              </div>

              <div>
                <button
                  type="button"
                  className="cei-btn cei-btn-ghost"
                  onClick={handleDownloadOpportunitiesCsv}
                  disabled={loading || !topOpportunities.length}
                >
                  {loading ? "Preparing…" : "Download opportunities CSV"}
                </button>
              </div>
            </div>

            {loading && (
              <div
                style={{
                  padding: "1.2rem 0.5rem",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <LoadingSpinner />
              </div>
            )}

            {!loading && opportunitiesError && (
              <div
                style={{
                  fontSize: "0.85rem",
                  color: "var(--cei-text-muted)",
                }}
              >
                {opportunitiesError}
              </div>
            )}

            {!loading &&
              !opportunitiesError &&
              topOpportunities.length === 0 && (
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--cei-text-muted)",
                  }}
                >
                  No opportunities surfaced yet. Once CEI has enough KPI
                  context per site, the opportunity engine will start
                  proposing high-leverage measures here.
                </div>
              )}

            {!loading &&
              !opportunitiesError &&
              topOpportunities.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Site</th>
                        <th>Location</th>
                        <th>Measure</th>
                        <th>Est. kWh saved / year</th>
                        <th>Est. cost saved / year</th>
                        <th>CO₂ saved (t / year)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...topOpportunities]
                        .sort((a, b) => {
                          if (hasTariff) {
                            const aCost =
                              typeof a.est_annual_cost_saved === "number" &&
                              Number.isFinite(a.est_annual_cost_saved)
                                ? a.est_annual_cost_saved
                                : 0;
                            const bCost =
                              typeof b.est_annual_cost_saved === "number" &&
                              Number.isFinite(b.est_annual_cost_saved)
                                ? b.est_annual_cost_saved
                                : 0;
                            if (aCost !== bCost) {
                              return bCost - aCost;
                            }
                          }

                          const aKwh =
                            typeof a.est_annual_kwh_saved === "number" &&
                            Number.isFinite(a.est_annual_kwh_saved)
                              ? a.est_annual_kwh_saved
                              : 0;
                          const bKwh =
                            typeof b.est_annual_kwh_saved === "number" &&
                            Number.isFinite(b.est_annual_kwh_saved)
                              ? b.est_annual_kwh_saved
                              : 0;
                          return bKwh - aKwh;
                        })
                        .map((row, idx) => (
                          <tr
                            key={`opp-${row.siteId}-${row.id}-${idx}`}
                          >
                            <td>{row.siteName}</td>
                            <td>{row.location || "—"}</td>
                            <td>{row.name}</td>
                            <td>
                              {row.est_annual_kwh_saved > 0
                                ? row.est_annual_kwh_saved.toLocaleString(
                                    undefined,
                                    {
                                      maximumFractionDigits: 0,
                                    }
                                  )
                                : "—"}
                            </td>
                            <td>
                              {hasTariff &&
                              row.est_annual_cost_saved !== null &&
                              Number.isFinite(row.est_annual_cost_saved)
                                ? formatCurrency(
                                    row.est_annual_cost_saved,
                                    currencyCode
                                  )
                                : "—"}
                            </td>
                            <td>
                              {Number.isFinite(
                                row.est_co2_tons_saved_per_year
                              )
                                ? row.est_co2_tons_saved_per_year.toFixed(
                                    2
                                  )
                                : "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </section>
      )}
    </div>
  );
};

export default Reports;
