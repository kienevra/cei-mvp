import React, { useState } from 'react';
import api from '../services/api';

function parseCSV(text: string): { rows: any[], errors: string[] } {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { rows: [], errors: ['Empty file'] };
  const delimiter = lines[0].includes(',') ? ',' : '\t';
  const headers = lines[0].split(delimiter).map(h => h.trim());
  const required = ['timestamp', 'site_id', 'meter_id', 'value', 'unit'];
  const missing = required.filter(col => !headers.includes(col));
  if (missing.length) return { rows: [], errors: [`Missing columns: ${missing.join(', ')}`] };
  const rows = [];
  for (let i = 1; i < Math.min(lines.length, 11); i++) {
    const values = lines[i].split(delimiter);
    if (values.length !== headers.length) continue;
    const row: any = {};
    headers.forEach((h, idx) => row[h] = values[idx]);
    rows.push(row);
  }
  return { rows, errors: [] };
}

const CSVUpload: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [jobStatus, setJobStatus] = useState<string | null>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setErrors([]);
    setPreview([]);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { rows, errors } = parseCSV(text);
      setPreview(rows);
      setErrors(errors);
    };
    reader.readAsText(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setJobStatus(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/upload-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });
      setJobStatus(`Job accepted: ${res.data.job_id}`);
    } catch (err: any) {
      setErrors([err?.response?.data?.detail || 'Upload failed']);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-8 p-4 border rounded shadow">
      <h2 className="text-xl font-bold mb-4">CSV Upload</h2>
      <div
        className="border-dashed border-2 border-gray-400 p-6 mb-4 text-center cursor-pointer"
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => document.getElementById('csv-input')?.click()}
      >
        Drag & drop CSV file here or click to select
        <input
          id="csv-input"
          type="file"
          accept=".csv,.tsv,text/csv"
          className="hidden"
          onChange={e => e.target.files && handleFile(e.target.files[0])}
        />
      </div>
      {errors.length > 0 && (
        <div className="text-red-600 mb-2">
          {errors.map((err, i) => <div key={i}>{err}</div>)}
        </div>
      )}
      {preview.length > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold mb-2">Preview (first 10 rows):</h3>
          <div className="overflow-x-auto">
            <table className="table-auto w-full border">
              <thead>
                <tr>
                  {Object.keys(preview[0]).map((col) => (
                    <th key={col} className="border px-2 py-1">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).map((val, j) => (
                      <td key={j} className="border px-2 py-1">{String(val)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            disabled={uploading || errors.length > 0}
            onClick={handleUpload}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
          {uploading && (
            <div className="w-full bg-gray-200 rounded mt-2">
              <div
                className="bg-blue-500 h-2 rounded"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {jobStatus && <div className="mt-2 text-green-600">{jobStatus}</div>}
        </div>
      )}
    </div>
  );
};

export default CSVUpload;
