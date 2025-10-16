import React from "react";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}

export default function FormField({ label, value, onChange, type = "text", required }: Props) {
  return (
    <label className="form-field">
      {label}
      <input
        type={type}
        value={value}
        required={required}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}