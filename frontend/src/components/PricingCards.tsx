// frontend/src/components/PricingCards.tsx
import React from "react";

export const FACTORY_TIERS = [
  { name: "Starter", planKey: "cei-starter", price: "€149", period: "/mese", target: "1–3 siti · piccolo stabilimento", highlight: false, features: ["Caricamento CSV","Fino a 3 siti","Avvisi warning + critical","Report PDF settimanale","1 token di integrazione"] },
  { name: "Professional", planKey: "cei-professional", price: "€349", period: "/mese", target: "Fino a 10 siti · stabilimento medio", highlight: true, badge: "Migliore valore", features: ["API + CSV","Fino a 10 siti","Suite avvisi completa","Pacchetto dati ISO 50001","5 token di integrazione","Export dati ETS/CBAM"] },
  { name: "Enterprise", planKey: "cei-enterprise", price: "€799", period: "/mese", target: "Siti illimitati · grande impianto", highlight: false, features: ["Siti illimitati","Token illimitati","Soglie alert personalizzate","Report white-label","Supporto prioritario","Pack conformità ETS/CBAM"] },
];

export const ESCO_TIERS = [
  { name: "ESCO Starter", planKey: "cei-esco-starter", price: "€299", period: "/mese", target: "Fino a 5 organizzazioni clienti", highlight: false, features: ["5 slot org cliente","Dashboard portfolio","Report PDF per cliente","Soglie alert per cliente"] },
  { name: "ESCO Professional", planKey: "cei-esco-pro", price: "€599", period: "/mese", target: "Fino a 15 organizzazioni clienti", highlight: true, badge: "Più scelto", features: ["15 slot org cliente","Crea org cliente direttamente","Gestione token per cliente","Download PDF multipli","Tutte le funzioni Starter"] },
  { name: "ESCO Scale", planKey: "cei-esco-scale", price: "€999", period: "/mese", target: "Clienti illimitati", highlight: false, features: ["Org cliente illimitate","Accesso API per sistemi ESCO","Branding personalizzato","Onboarding dedicato","Tutte le funzioni Professional"] },
];

interface PricingCardsProps {
  variant: "factory" | "esco";
  compact?: boolean;
  selectedPlan?: string | null;
  onSelectPlan?: (planKey: string) => void;
}

const PricingCards: React.FC<PricingCardsProps> = ({ variant, compact = false, selectedPlan, onSelectPlan }) => {
  const tiers = variant === "factory" ? FACTORY_TIERS : ESCO_TIERS;
  const isSelectable = !!onSelectPlan;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: compact ? "0.5rem" : "0.75rem", width: "100%" }}>
      {tiers.map((tier) => {
        const isSelected = selectedPlan === tier.planKey;
        return (
          <div
            key={tier.planKey}
            onClick={() => onSelectPlan?.(tier.planKey)}
            style={{
              position: "relative",
              border: isSelected ? "2px solid var(--cei-green, #22c55e)" : tier.highlight ? "2px solid rgba(34,197,94,0.4)" : "1px solid var(--cei-border-subtle, rgba(148,163,184,0.2))",
              borderRadius: "0.65rem",
              padding: compact ? "0.65rem 0.6rem" : "0.85rem 0.75rem",
              background: isSelected ? "rgba(34,197,94,0.1)" : "rgba(15,23,42,0.5)",
              display: "flex", flexDirection: "column", gap: "0.3rem",
              cursor: isSelectable ? "pointer" : "default",
              transition: "border-color 0.15s, background 0.15s",
              boxShadow: isSelected ? "0 0 0 3px rgba(34,197,94,0.15)" : "none",
            }}
          >
            {isSelected && (
              <div style={{ position: "absolute", top: "8px", right: "8px", background: "var(--cei-green, #22c55e)", color: "#0f172a", borderRadius: "50%", width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700 }}>✓</div>
            )}
            {"badge" in tier && (tier as any).badge && !isSelected && (
              <div style={{ position: "absolute", top: "-11px", left: "50%", transform: "translateX(-50%)", background: "var(--cei-green, #22c55e)", color: "#0f172a", fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: "999px", whiteSpace: "nowrap" }}>{(tier as any).badge}</div>
            )}
            <div style={{ fontSize: compact ? "0.78rem" : "0.85rem", fontWeight: 600, color: isSelected || tier.highlight ? "var(--cei-green, #22c55e)" : "var(--cei-text-main, #e2e8f0)" }}>{tier.name}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--cei-text-muted, #94a3b8)", lineHeight: 1.3, marginBottom: "0.2rem" }}>{tier.target}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
              <span style={{ fontSize: compact ? "1.15rem" : "1.35rem", fontWeight: 700, color: "var(--cei-text-main, #e2e8f0)" }}>{tier.price}</span>
              <span style={{ fontSize: "0.68rem", color: "var(--cei-text-muted, #94a3b8)" }}>{tier.period}</span>
            </div>
            {!compact && (
              <ul style={{ margin: "0.4rem 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.25rem", borderTop: "1px solid var(--cei-border-subtle, rgba(148,163,184,0.15))", paddingTop: "0.45rem" }}>
                {tier.features.map((f) => (
                  <li key={f} style={{ fontSize: "0.7rem", color: "var(--cei-text-muted, #94a3b8)", display: "flex", gap: "5px", alignItems: "flex-start", lineHeight: 1.35 }}>
                    <span style={{ color: "var(--cei-green, #22c55e)", flexShrink: 0, marginTop: "1px" }}>✓</span>{f}
                  </li>
                ))}
              </ul>
            )}
            {isSelectable && !isSelected && (
              <div style={{ marginTop: "0.4rem", fontSize: "0.68rem", color: "var(--cei-text-muted, #94a3b8)", textAlign: "center", borderTop: compact ? "none" : "1px solid var(--cei-border-subtle, rgba(148,163,184,0.1))", paddingTop: compact ? "0" : "0.35rem" }}>Seleziona</div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PricingCards;
