import React from "react";

type Column = { key: string; label: string };
type TableProps = {
  columns: Column[];
  data: any[];
};

const Table: React.FC<TableProps> = ({ columns, data }) => (
  <div className="overflow-x-auto">
    <table className="min-w-full border">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} className="px-3 py-2 border-b bg-gray-50 text-left text-xs font-semibold">
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="text-center text-gray-400 py-4">
              No data.
            </td>
          </tr>
        )}
        {data.map((row, i) => (
          <tr key={i} className="hover:bg-gray-50">
            {columns.map((col) => (
              <td key={col.key} className="px-3 py-2 border-b">
                {row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default Table;