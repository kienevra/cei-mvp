import React from "react";

type Props = {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  error?: string;
  required?: boolean;
};

const FormField: React.FC<Props> = ({
  label,
  name,
  value,
  onChange,
  type = "text",
  error,
  required,
}) => (
  <div className="mb-3">
    <label htmlFor={name} className="block text-sm font-medium mb-1">
      {label}
      {required && <span className="text-red-500 ml-1">*</span>}
    </label>
    <input
      id={name}
      name={name}
      type={type}
      value={value}
      onChange={onChange}
      required={required}
      className={`border rounded px-2 py-1 w-full ${error ? "border-red-500" : ""}`}
      aria-invalid={!!error}
      aria-describedby={error ? `${name}-error` : undefined}
    />
    {error && (
      <div id={`${name}-error`} className="text-xs text-red-600 mt-1">
        {error}
      </div>
    )}
  </div>
);

export default FormField;