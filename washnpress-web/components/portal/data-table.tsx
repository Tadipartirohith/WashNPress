import { Loader2 } from "lucide-react";
import { EmptyState } from "./empty-state";
import { cn } from "@/lib/utils";

export interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
  align?: "left" | "right";
}

// One table component for every list in every staff portal: societies, operators,
// orders, slots, issues, audit entries. Columns are render functions, not field
// names, so a cell can be a status badge or a button, not just text.
export function DataTable<T>({
  columns,
  rows,
  keyField,
  loading,
  error,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
}) {
  if (loading) {
    return (
      <div className="grid place-items-center rounded-2xl glass py-14">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }
  if (error) {
    return <EmptyState tone="danger" title="Couldn't load this list" description={error} />;
  }
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="overflow-x-auto rounded-2xl glass">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
            {columns.map((c, i) => (
              <th key={i} scope="col" className={cn("px-4 py-3 font-medium", c.align === "right" && "text-right")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={keyField(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); } }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? "button" : undefined}
              className={cn(
                "border-b border-white/5 last:border-0",
                onRowClick && "cursor-pointer transition-colors hover:bg-foreground/5 focus-visible:ring-focus",
              )}
            >
              {columns.map((c, i) => (
                <td key={i} className={cn("px-4 py-3.5", c.align === "right" && "text-right", c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
