import { Loader2 } from "lucide-react";
import { EmptyState } from "./empty-state";

// Wraps a data-fetching section: spinner while loading, an error card if it failed,
// otherwise the real content. Every staff-portal screen composes around this.
export function Panel({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="size-6 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState
        tone="danger"
        title="Couldn't load this"
        description={error}
        action={onRetry ? { label: "Try again", onClick: onRetry } : undefined}
      />
    );
  }
  return <>{children}</>;
}
