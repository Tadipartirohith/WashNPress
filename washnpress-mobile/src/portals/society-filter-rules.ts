// What an empty Society management page should say.
//
// It said "No societies yet" whenever the list came back empty, which is only true
// when the platform has none. Once the page can be narrowed by name and by status,
// the same sentence is reached by asking for the inactive ones on a platform where
// every society is running — and "No societies yet" then reads as data loss rather
// than as a filter with nothing behind it.
//
// The line names whichever narrowing is actually on, so the reader knows what to
// undo.
export function societyEmptyLine(search: string, status?: string): string {
  const named = statusWord(status);
  if (search && named) return `No ${named} societies match that search.`;
  if (search) return "No societies match that search.";
  if (named) return `No ${named} societies.`;
  return "No societies yet.";
}

// The dropdown's own words, lowercased for the middle of a sentence. An
// unrecognised value narrows the list without being able to describe itself, so it
// is treated as no narrowing at all rather than printed raw at the reader.
function statusWord(status?: string): string | null {
  if (status === "active") return "active";
  if (status === "inactive") return "inactive";
  return null;
}
