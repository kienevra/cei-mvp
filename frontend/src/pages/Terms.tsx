// frontend/src/terms.tsx
import React from "react";
import { Link } from "react-router-dom";

const Terms: React.FC = () => {
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

        <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#f1f5f9", marginBottom: "8px" }}>Terms of Service</h1>
        <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "40px" }}>Last updated: 30 May 2026</p>

        <Section title="1. Acceptance of Terms">
          <p>By creating an account on CEI — Carbon Efficiency Intelligence (<a href="https://app.carbonefficiencyintel.com" style={{ color: "#22c55e" }}>app.carbonefficiencyintel.com</a>), you agree to be bound by these Terms of Service. If you do not agree, do not use the platform.</p>
          <p>These Terms constitute a binding agreement between you (the "User" or "Customer") and <strong>Leon Miriti, trading as CEI — Carbon Efficiency Intelligence</strong> (the "Provider").</p>
        </Section>

        <Section title="2. Description of Service">
          <p>CEI is a B2B SaaS platform providing:</p>
          <ul>
            <li>Energy consumption monitoring and timeseries analysis</li>
            <li>Automated alert generation based on statistical baselines</li>
            <li>Decarbonisation opportunity identification and ROI simulation</li>
            <li>Regulatory intelligence for EU ETS, CBAM, and Fit-for-55 compliance</li>
            <li>MRV (Monitoring, Reporting, Verification) report generation</li>
            <li>Portfolio management tools for ESCOs and energy consultants</li>
          </ul>
        </Section>

        <Section title="3. Account Registration">
          <p>To use CEI, you must:</p>
          <ul>
            <li>Provide accurate and complete registration information</li>
            <li>Be at least 18 years old and have authority to enter into this agreement</li>
            <li>Maintain the security of your account credentials</li>
            <li>Notify us immediately of any unauthorized access at <a href="mailto:support@carbonefficiencyintel.com" style={{ color: "#22c55e" }}>support@carbonefficiencyintel.com</a></li>
          </ul>
          <p>You are responsible for all activity that occurs under your account.</p>
        </Section>

        <Section title="4. Acceptable Use">
          <p>You agree not to:</p>
          <ul>
            <li>Use the platform for any unlawful purpose or in violation of any regulations</li>
            <li>Upload data that you do not have the right to process</li>
            <li>Attempt to reverse engineer, decompile, or extract the platform's source code</li>
            <li>Use automated scraping tools to extract data from the platform</li>
            <li>Resell or sublicense access to the platform without written permission</li>
            <li>Introduce malware, viruses, or any harmful code</li>
          </ul>
        </Section>

        <Section title="5. Your Data">
          <p>You retain full ownership of all energy data, production data, and operational data you upload to CEI.</p>
          <p>By uploading data, you grant us a limited, non-exclusive licence to process that data solely for the purpose of providing the service to you.</p>
          <p>We will not sell, license, or share your identifiable data with third parties except as described in our <Link to="/privacy" style={{ color: "#22c55e" }}>Privacy Policy</Link>.</p>
          <p><strong style={{ color: "#e2e8f0" }}>5a. Anonymised Aggregate Data (optional consent)</strong></p>
          <p>With your explicit consent, we may derive anonymised, aggregated, non-identifiable statistics from your energy data for the following purposes:</p>
          <ul>
            <li><strong>Sector benchmarking</strong> — computing average kWh/tonne, tCO₂/site, and energy intensity ratios by industry sector and region, used to show how your facility compares to peers</li>
            <li><strong>Industry indices</strong> — publishing sector-level energy and carbon intensity indices for Italian and EU manufacturing (no facility-level data is ever published)</li>
            <li><strong>Product improvement</strong> — improving CEI's alert thresholds, baseline models, and opportunity detection algorithms</li>
            <li><strong>Research</strong> — contributing to academic or regulatory research on industrial decarbonisation</li>
          </ul>
          <p>Your identifiable data (organization name, site location, specific consumption figures) is never included in any aggregated output. Aggregation always involves data from a minimum of 10 facilities before any statistic is published or shared.</p>
          <p>This consent is optional. You can withdraw it at any time via Settings without affecting your access to the platform. If you do not consent, your data is used only to provide the service to you.</p>
        </Section>

        <Section title="6. Subscription and Payment">
          <p>Access to certain features requires a paid subscription. Subscription fees are billed in advance on a monthly or annual basis.</p>
          <p>All payments are processed by Stripe. By subscribing, you authorise us to charge your payment method on a recurring basis.</p>
          <p>Subscriptions automatically renew unless cancelled at least 24 hours before the renewal date. You can cancel at any time via Account → Billing.</p>
          <p>Refunds are provided at our discretion for unused subscription periods. No refunds are provided for partial months.</p>
        </Section>

        <Section title="7. Service Availability">
          <p>We aim to provide 99% uptime for the CEI platform, measured monthly. We do not guarantee uninterrupted service.</p>
          <p>We may perform scheduled maintenance with advance notice. Emergency maintenance may occur without notice.</p>
          <p>We are not liable for downtime caused by third-party infrastructure providers (Supabase, Render, Cloudflare).</p>
        </Section>

        <Section title="8. Limitation of Liability">
          <p>To the maximum extent permitted by Italian and EU law:</p>
          <ul>
            <li>CEI is provided "as is" without warranties of any kind, express or implied</li>
            <li>We do not warrant that the platform will be error-free or that results will be accurate</li>
            <li>We are not liable for any indirect, incidental, special, or consequential damages</li>
            <li>Our total liability to you for any claim shall not exceed the amount you paid us in the 12 months preceding the claim</li>
          </ul>
          <p>Nothing in these Terms limits our liability for fraud, death, or personal injury caused by our negligence.</p>
        </Section>

        <Section title="9. Indemnification">
          <p>You agree to indemnify and hold harmless the Provider from any claims, damages, or expenses arising from your use of the platform, your violation of these Terms, or your violation of any third-party rights.</p>
        </Section>

        <Section title="10. Intellectual Property">
          <p>All intellectual property in the CEI platform — including software, algorithms, UI design, and documentation — belongs to Leon Miriti / CEI — Carbon Efficiency Intelligence. Nothing in these Terms grants you any ownership rights in the platform.</p>
          <p>You grant us a non-exclusive licence to display your organization name as a customer reference, unless you opt out by contacting <a href="mailto:support@carbonefficiencyintel.com" style={{ color: "#22c55e" }}>support@carbonefficiencyintel.com</a>.</p>
        </Section>

        <Section title="11. Termination">
          <p>You may terminate your account at any time via Account → Permanently delete. Upon termination, your data will be deleted within 30 days.</p>
          <p>We may suspend or terminate your account if you violate these Terms, fail to pay subscription fees, or engage in fraudulent activity. We will provide reasonable notice where possible.</p>
        </Section>

        <Section title="12. Governing Law and Disputes">
          <p>These Terms are governed by Italian law. Any disputes shall be subject to the exclusive jurisdiction of the courts of Italy.</p>
          <p>We are committed to resolving disputes informally first. Please contact <a href="mailto:support@carbonefficiencyintel.com" style={{ color: "#22c55e" }}>support@carbonefficiencyintel.com</a> before initiating any legal proceedings.</p>
        </Section>

        <Section title="13. Changes to These Terms">
          <p>We may update these Terms from time to time. We will notify you by email at least 14 days before material changes take effect. Continued use of the platform after the effective date constitutes acceptance.</p>
        </Section>

        <Section title="14. Contact">
          <p>For any questions about these Terms:</p>
          <p><a href="mailto:support@carbonefficiencyintel.com" style={{ color: "#22c55e" }}>support@carbonefficiencyintel.com</a></p>
          <p>Leon Miriti, trading as CEI — Carbon Efficiency Intelligence, Italy</p>
          <p><a href="https://carbonefficiencyintel.com" style={{ color: "#22c55e" }}>carbonefficiencyintel.com</a></p>
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

export default Terms;
