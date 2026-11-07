export function DataTable<Row extends object>({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: readonly Row[];
}) {
  return (
    <section>
      {/* TODO: design handoff — table */}
      <h2>{caption}</h2>
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const record = row as Record<string, unknown>;
            return (
              <tr key={String(record.id ?? record.status ?? index)}>
                {columns.map((column) => (
                  <td key={column}>{record[column] == null ? "" : String(record[column])}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
