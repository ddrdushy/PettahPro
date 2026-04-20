import type { ReactNode } from "react";

export interface Column<T> {
  header: string;
  accessor: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  mono?: boolean;
}

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  empty?: ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border-hairline border-border bg-surface-elevated py-16 text-center">
        <div className="mx-auto max-w-sm text-text-secondary">{empty ?? "No data yet."}</div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
      <table className="w-full text-small">
        <thead className="border-b-hairline border-border bg-surface-recessed">
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={`px-4 py-3 text-caption font-medium uppercase tracking-wide text-text-tertiary ${
                  c.align === "right"
                    ? "text-right"
                    : c.align === "center"
                      ? "text-center"
                      : "text-left"
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y-hairline divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="transition-colors hover:bg-surface-recessed/40">
              {columns.map((c, i) => (
                <td
                  key={i}
                  className={`px-4 py-3 text-charcoal ${
                    c.align === "right"
                      ? "text-right"
                      : c.align === "center"
                        ? "text-center"
                        : "text-left"
                  } ${c.mono ? "tabular-nums" : ""}`}
                >
                  {c.accessor(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
