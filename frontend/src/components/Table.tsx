import React from "react";

interface TableProps {
  columns: string[];
  data: Array<Record<string, any>>;
}

const Table: React.FC<TableProps> = ({ columns, data }) => (
  <div className="overflow-x-auto">
    <table className="table-auto w-full border">
      <thead>
        <tr>
          {columns.map(col => (
            <th key={col} className="border px-2 py-1">{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            {columns.map(col => (
              <td key={col} className="border px-2 py-1">{row[col]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default Table;