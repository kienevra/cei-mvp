// frontend/src/pages/CSVUpload.tsx
import React, { useState } from "react";
import { uploadCsv } from "../services/api";

export default function CSVUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  function handleFile(f: File | null) {
    setFile(f);
    if (!f) {
      setPreview([]);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || "");
      const lines = text.split(/\r?\n/).slice(0, 10);
      const rows = lines.map((l) => l.split(","));
      setPreview(rows);
    };
    reader.readAsText(f);
  }

  async function doUpload() {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await uploadCsv(fd);
      setMessage(`Accepted job ${res.job_id}, rows=${res.rows}`);
    } catch (err: any) {
      setMessage("Upload failed: " + (err?.message || "unknown"));
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Upload CSV</h1>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => handleFile(e.target.files ? e.target.files[0] : null)}
      />
      {preview.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3>Preview (first rows)</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{preview.map((r) => r.join(", ")).join("\n")}</pre>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <button onClick={doUpload} disabled={!file}>
          Upload
        </button>
      </div>
      {message && <div style={{ marginTop: 12 }}>{message}</div>}
    </div>
  );
}
