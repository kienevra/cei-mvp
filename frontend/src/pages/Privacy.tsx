// frontend/src/pages/Privacy.tsx
import React from "react";
import { Link } from "react-router-dom";

const Privacy: React.FC = () => {
  return (
    <div style={{ minHeight: "100vh", background: "#020617", color: "#e2e8f0", fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#0f4c35", padding: "20px 40px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ color: "#fff", fontSize: "18px", fontWeight: 700 }}>CEI</span>
          <span style={{ color: "#4ade80", margin: "0 6px" }}>·</span>
          <span style={{ color: "#a7f3d0", fontSize: "13px" }}>Carbon Efficiency Intelligence</span>
        </div>
        <Link to="/login" style={{ color: "#4ade80", textDecoration: "none", fontSize: "13px" }}>← Back to login</Link>
      </div>

      {/* Content */}
      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "48px 24px" }}>

        <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#f1f5f9", marginBottom: "8px" }}>Privacy Policy</h1>
        <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "40px" }}>Last updated: 30 May 2026</p>

        <Section title="1. Who We Are">
          <p>The data controller for CEI — Carbon Efficiency Intelligence is <strong>Leon Miriti, trading as CEI — Carbon Efficiency Intelligence</strong>, resident in Italy.</p>
          <p>For any privacy-related questions or requests, contact us at <a href="mailto:support@carbonefficiencyintel.com" style={{ color: "#22c55e" }}>support@carbonefficiencyintel.com</a>.</p>
        </Section>

        <Section title="2. What Data We Collect">
          <SubSection title="2.1 Account Data">
            <p>When you register, we collect:</p>
            <ul>
              <li>Full name and email address</li>
              <li>Organization name and type (factory, ESCO, or consultant)</li>
              <li>Password (stored as a one-way cryptographic hash — we never see your plain-text password)</li>
              <li>Language preference and date/time of registration</li>
              <li>Acceptance timestamp for Terms of Service and Privacy Policy</li>
            </ul>
          </SubSection>
          <SubSection title="2.2 Energy and Operational Data">
            <ul>
              <li>Energy timeseries data you upload (kWh readings, meter data, CSV uploads)</li>
              <li>Production records (output volumes, units of production)</li>
              <li>Site configuration (tariffs, emission factors, sector codes)</li>
              <li>Alert events and workflow actions</li>
            </ul>
          </SubSection>
          <SubSection title="2.3 Usage and Technical Data">
            <ul>
              <li>IP address and browser user-agent (for security and fraud prevention)</li>
              <li>Request logs including timestamps, endpoints accessed, and response times</li>
              <li>Integration tokens you create (stored as cryptographic hashes)</li>
            </ul>
          </SubSection>
          <SubSection title="2.4 Billing Data">
            <p>Payment processing is handled entirely by Stripe. We do not store credit card numbers or full payment details. We store only Stripe customer IDs and subscription status references.</p>
          </SubSection>
        </Section>

        <Section title="3. Why We Process Your Data (Legal Basis)">
          <p>We process your data on the following legal bases under GDPR Article 6:</p>
          <ul>
            <li><strong>Performance of contract (Art. 6(1)(b)):</strong> to provide the CEI platform and its features to you</li>
            <li><strong>Legitimate interests (Art. 6(1)(f)):</strong> to operate, secure, and improve the platform, send transactional emails, and detect fraud</li>
            <li><strong>Compliance with legal obligations (Art. 6(1)(c)):</strong> to comply with Italian and EU legal requirements</li>
            <li><strong>Consent (Art. 6(1)(a)):</strong> where you have explicitly consented at registration</li>
          </ul>
        </Section>

        <Section title="4. How Long We Keep Your Data">
          <ul>
            <li>Account data: for the duration of your account, plus 30 days after deletion</li>
            <li>Energy timeseries data: for the duration of your subscription, deleted upon account deletion</li>
            <li>Audit logs and alert history: 12 months from creation</li>
            <li>Billing records: 10 years as required by Italian tax law (D.P.R. 633/72)</li>
            <li>Anonymised aggregate benchmarking data: indefinitely (cannot be linked to you)</li>
          </ul>
        </Section>

        <Section title="5. Who We Share Your Data With">
          <p>We use the following subprocessors to deliver the service:</p>
          <ul>
            <li><strong>Supabase Inc.</strong> — Database hosting (EU-Central-1, Frankfurt, Germany). Standard Contractual Clauses in place.</li>
            <li><strong>Render Services Inc.</strong> (USA) — Backend application hosting. Standard Contractual Clauses in place.</li>
            <li><strong>Resend Inc.</strong> (USA) — Transactional email delivery. Standard Contractual Clauses in place.</li>
            <li><strong>Stripe Inc.</strong> (USA) — Payment processing. PCI DSS Level 1 certified.</li>
          </ul>
          <p>We do not sell your data to third parties. We do not use your data for advertising.</p>
        </Section>

        <Section title="6. Your Rights Under GDPR">
          <ul>
            <li><strong>Right of access (Art. 15):</strong> request a copy of all personal data we hold about you</li>
            <li><strong>Right to rectification (Art. 16):</strong> correct inaccurate data via your account settings</li>
            <li><strong>Right to erasure (Art. 17):</strong> delete your account at any time via Account → Permanently delete</li>
            <li><strong>Right to data portability (Art. 20):</strong> export your energy data in CSV format at any time</li>
            <li><strong>Right to object (Art. 21):</strong> object to processing based on legitimate interests</li>
            <li><strong>Right to restrict processing (Art. 18):</strong> request that we limit how we use your data</li>
          </ul>
          <p>To exercise any of these rights, contact us at <a href="mailto:support@carbonefficiencyintel.com" style={{ color: "#22c55e" }}>support@carbonefficiencyintel.com</a>. We will respond within 30 days.</p>
        </Section>

        <Section title="7. Cookies">
          <p>CEI uses only one essential functional cookie:</p>
          <ul>
            <li><strong>cei_refresh_token:</strong> a secure, HTTP-only cookie used to maintain your login session. This cookie is strictly necessary and does not require consent. It expires after 30 days or when you log out.</li>
          </ul>
          <p>We do not use advertising cookies, tracking pixels, or analytics cookies that require consent.</p>
        </Section>

        <Section title="8. Data Security">
          <ul>
            <li>All data in transit is encrypted using TLS 1.2 or higher</li>
            <li>Passwords are hashed using Argon2id, a memory-hard algorithm</li>
            <li>Integration tokens are stored as SHA-256 hashes</li>
            <li>Database access is restricted to authenticated application connections via SSL</li>
            <li>Regular automated backups are maintained by Supabase</li>
          </ul>
        </Section>

        <Section title="9. International Data Transfers">
          <p>Some of our subprocessors (Render, Resend, Stripe) are based in the United States. Data transfers to these processors are covered by Standard Contractual Clauses (SCCs) as approved by the European Commission under GDPR Article 46(2)(c).</p>
        </Section>

        <Section title="10. Children's Data">
          <p>CEI is a B2B industrial platform not intended for use by persons under 18. We do not knowingly collect data from minors.</p>
        </Section>

        <Section title="11. Changes to This Policy">
          <p>We may update this Privacy Policy from time to time. We will notify registered users by email at least 14 days before any material changes take effect.</p>
        </Section>

        <Section title="12. Contact and Complaints">
          <p>For any privacy questions: <a href="mailto:support@carbonefficiencyintel.com" style={{ color: "#22c55e" }}>support@carbonefficiencyintel.com</a></p>
          <p>If you are not satisfied with our response, you have the right to lodge a complaint with the Italian Data Protection Authority (Garante per la protezione dei dati personali) at <a href="https://www.garanteprivacy.it" target="_blank" rel="noopener noreferrer" style={{ color: "#22c55e" }}>garanteprivacy.it</a>.</p>
        </Section>

        <div style={{ marginTop: "48px", paddingTop: "24px", borderTop: "1px solid #1e293b", fontSize: "12px", color: "#475569" }}>
          © 2026 Carbon Efficiency Intelligence · Leon Miriti, trading as CEI — Carbon Efficiency Intelligence · Italy
        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: "32px" }}>
    <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#22c55e", marginBottom: "12px", paddingBottom: "6px", borderBottom: "1px solid #1e293b" }}>{title}</h2>
    <div style={{ fontSize: "14px", color: "#cbd5e1", lineHeight: 1.7 }}>{children}</div>
  </div>
);

const SubSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: "16px" }}>
    <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#94a3b8", marginBottom: "8px" }}>{title}</h3>
    <div>{children}</div>
  </div>
);

export default Privacy;
