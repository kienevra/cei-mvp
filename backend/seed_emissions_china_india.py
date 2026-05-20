"""
Seed China and India emission factors and sector benchmarks.
Run: python seed_emissions_china_india.py

Sources:
- China: National Development and Reform Commission (NDRC) 2024
          China Electricity Council (CEC) grid emission factors
          China ETS (national carbon market, operative 2021)
- India: Central Electricity Authority (CEA) CO2 baseline database 2024
          Bureau of Energy Efficiency (BEE) PAT scheme
          India's nationally determined contributions (NDC)
"""
import json
import urllib.request
import urllib.parse
import urllib.error

API_BASE = "http://localhost:8000/api/v1"
EMAIL    = "leonnjiru@gmail.com"
PASSWORD = "mypassword"


def login() -> str:
    data = urllib.parse.urlencode({"username": EMAIL, "password": PASSWORD}).encode()
    req  = urllib.request.Request(f"{API_BASE}/auth/login", data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def main():
    # Direct DB insertion is cleanest here since we don't have an admin API yet
    import sys
    import os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    from app.db.session import SessionLocal
    from app.models import EmissionFactor, SectorBenchmark
    from sqlalchemy.dialects.postgresql import insert

    db = SessionLocal()

    # ── Emission factors ──────────────────────────────────────────────────────
    factors = [
        # ── China ────────────────────────────────────────────────────────────
        # NDRC/CEC national grid average (coal-heavy, improving)
        dict(country_code="CHN", region_code="APAC", energy_source="electricity",
             factor_kg_co2_kwh=0.5810, valid_year=2024, framework="ISO14064",
             source_url="https://www.cec.org.cn",
             notes="China national grid 2024 - CEC annual report, coal ~56%"),
        dict(country_code="CHN", region_code="APAC", energy_source="electricity",
             factor_kg_co2_kwh=0.5810, valid_year=2024, framework="VCS",
             source_url="https://www.cec.org.cn",
             notes="China national grid 2024 - used for Verra VCS projects"),
        dict(country_code="CHN", region_code="APAC", energy_source="electricity",
             factor_kg_co2_kwh=0.6030, valid_year=2023, framework="ISO14064",
             source_url="https://www.cec.org.cn",
             notes="China national grid 2023 historical"),
        dict(country_code="CHN", region_code="APAC", energy_source="natural_gas",
             factor_kg_co2_kwh=0.202000, valid_year=2024, framework="ISO14064",
             source_url="https://www.ipcc.ch",
             notes="IPCC Tier 1 - China uses same combustion factor"),
        dict(country_code="CHN", region_code="APAC", energy_source="coal",
             factor_kg_co2_kwh=0.341000, valid_year=2024, framework="ISO14064",
             source_url="https://www.ndrc.gov.cn",
             notes="NDRC 2024 bituminous coal factor (kgCO2/kWh thermal equiv)"),
        dict(country_code="CHN", region_code="APAC", energy_source="diesel",
             factor_kg_co2_kwh=0.267000, valid_year=2024, framework="ISO14064",
             source_url="https://www.ipcc.ch",
             notes="IPCC Tier 1 diesel"),
        # China ETS (national carbon market - power sector only currently)
        dict(country_code="CHN", region_code="APAC", energy_source="electricity",
             factor_kg_co2_kwh=0.5810, valid_year=2024, framework="CN_ETS",
             source_url="https://www.mee.gov.cn",
             notes="China national ETS 2024 - Ministry of Ecology and Environment"),
        dict(country_code="CHN", region_code="APAC", energy_source="coal",
             factor_kg_co2_kwh=0.341000, valid_year=2024, framework="CN_ETS",
             source_url="https://www.mee.gov.cn",
             notes="China ETS coal factor"),

        # ── India ─────────────────────────────────────────────────────────────
        # CEA CO2 baseline database - national grid average
        dict(country_code="IND", region_code="APAC", energy_source="electricity",
             factor_kg_co2_kwh=0.7080, valid_year=2024, framework="ISO14064",
             source_url="https://www.cea.nic.in/reports/others/thermal/co2/CO2_2021-22.pdf",
             notes="India national grid 2024 - CEA, coal ~70% of generation"),
        dict(country_code="IND", region_code="APAC", energy_source="electricity",
             factor_kg_co2_kwh=0.7080, valid_year=2024, framework="VCS",
             source_url="https://www.cea.nic.in",
             notes="India grid 2024 - Verra VCS CDM grid factor"),
        dict(country_code="IND", region_code="APAC", energy_source="electricity",
             factor_kg_co2_kwh=0.7160, valid_year=2023, framework="ISO14064",
             source_url="https://www.cea.nic.in",
             notes="India national grid 2023 historical"),
        dict(country_code="IND", region_code="APAC", energy_source="natural_gas",
             factor_kg_co2_kwh=0.202000, valid_year=2024, framework="ISO14064",
             source_url="https://www.ipcc.ch",
             notes="IPCC Tier 1 - BEE aligned"),
        dict(country_code="IND", region_code="APAC", energy_source="coal",
             factor_kg_co2_kwh=0.341000, valid_year=2024, framework="ISO14064",
             source_url="https://www.cea.nic.in",
             notes="CEA 2024 coal factor"),
        dict(country_code="IND", region_code="APAC", energy_source="diesel",
             factor_kg_co2_kwh=0.267000, valid_year=2024, framework="ISO14064",
             source_url="https://www.ipcc.ch",
             notes="IPCC Tier 1 diesel"),
        # Gold Standard for Indian voluntary market projects
        dict(country_code="IND", region_code="APAC", energy_source="electricity",
             factor_kg_co2_kwh=0.7080, valid_year=2024, framework="GOLD_STANDARD",
             source_url="https://www.goldstandard.org",
             notes="Gold Standard India grid 2024 - CDM methodology ACM0002"),
    ]

    inserted = 0
    skipped  = 0
    for f in factors:
        existing = db.query(EmissionFactor).filter_by(
            country_code  = f["country_code"],
            energy_source = f["energy_source"],
            valid_year    = f["valid_year"],
            framework     = f["framework"],
        ).first()
        if existing:
            skipped += 1
            continue
        db.add(EmissionFactor(**f))
        inserted += 1

    db.commit()
    print(f"Emission factors: {inserted} inserted, {skipped} skipped")

    # ── Sector benchmarks ─────────────────────────────────────────────────────
    benchmarks = [
        # China ETS benchmarks (power sector only currently, industrial expanding)
        dict(framework="CN_ETS", sector_code="power",
             benchmark_value=0.820, product_unit="MWh",
             valid_from_year=2021, valid_to_year=None,
             reduction_rate_pct=2.0,
             notes="China ETS power sector benchmark 2021 - MEE, expanding to industry 2025+"),
        dict(framework="CN_ETS", sector_code="cement",
             benchmark_value=0.795, product_unit="tonne",
             valid_from_year=2025, valid_to_year=None,
             reduction_rate_pct=2.0,
             notes="China ETS cement benchmark - Phase 2 expansion 2025"),
        dict(framework="CN_ETS", sector_code="steel",
             benchmark_value=1.800, product_unit="tonne",
             valid_from_year=2025, valid_to_year=None,
             reduction_rate_pct=2.0,
             notes="China ETS steel benchmark - Phase 2 expansion 2025"),
        dict(framework="CN_ETS", sector_code="ceramics",
             benchmark_value=0.150, product_unit="tonne",
             valid_from_year=2025, valid_to_year=None,
             reduction_rate_pct=2.0,
             notes="China ETS ceramics proxy - aligned with industry average"),
        dict(framework="CN_ETS", sector_code="aluminium",
             benchmark_value=1.200, product_unit="tonne",
             valid_from_year=2025, valid_to_year=None,
             reduction_rate_pct=2.0,
             notes="China ETS aluminium - Phase 2 expansion"),
        # India PAT (Perform Achieve Trade) scheme benchmarks
        dict(framework="IN_PAT", sector_code="cement",
             benchmark_value=0.725, product_unit="tonne",
             valid_from_year=2022, valid_to_year=None,
             reduction_rate_pct=1.5,
             notes="India PAT Cycle III cement benchmark - BEE"),
        dict(framework="IN_PAT", sector_code="steel",
             benchmark_value=2.100, product_unit="tonne",
             valid_from_year=2022, valid_to_year=None,
             reduction_rate_pct=1.5,
             notes="India PAT steel benchmark - BEE"),
        dict(framework="IN_PAT", sector_code="ceramics",
             benchmark_value=0.180, product_unit="tonne",
             valid_from_year=2022, valid_to_year=None,
             reduction_rate_pct=1.5,
             notes="India PAT ceramics proxy - BEE energy intensity"),
        dict(framework="IN_PAT", sector_code="chemicals",
             benchmark_value=0.850, product_unit="tonne",
             valid_from_year=2022, valid_to_year=None,
             reduction_rate_pct=1.5,
             notes="India PAT chemicals - BEE"),
        dict(framework="IN_PAT", sector_code="food",
             benchmark_value=0.120, product_unit="tonne",
             valid_from_year=2022, valid_to_year=None,
             reduction_rate_pct=1.5,
             notes="India PAT food processing - BEE"),
        # VCS benchmarks for China/India (voluntary market)
        dict(framework="VCS", sector_code="manufacturing",
             benchmark_value=0.500, product_unit="tonne",
             valid_from_year=2024, valid_to_year=None,
             reduction_rate_pct=0.0,
             notes="VCS generic manufacturing - China/India projects"),
    ]

    inserted_bm = 0
    skipped_bm  = 0
    for b in benchmarks:
        existing = db.query(SectorBenchmark).filter_by(
            framework       = b["framework"],
            sector_code     = b["sector_code"],
            valid_from_year = b["valid_from_year"],
        ).first()
        if existing:
            skipped_bm += 1
            continue
        db.add(SectorBenchmark(**b))
        inserted_bm += 1

    db.commit()
    print(f"Sector benchmarks: {inserted_bm} inserted, {skipped_bm} skipped")

    # Summary
    total_factors = db.query(EmissionFactor).count()
    total_bm      = db.query(SectorBenchmark).count()
    print(f"\nDatabase totals: {total_factors} emission factors, {total_bm} sector benchmarks")
    print("\nCountries in database:")
    from sqlalchemy import distinct
    for row in db.query(EmissionFactor.country_code).distinct().order_by(EmissionFactor.country_code).all():
        count = db.query(EmissionFactor).filter_by(country_code=row[0]).count()
        print(f"  {row[0]}: {count} factor(s)")

    db.close()


if __name__ == "__main__":
    main()