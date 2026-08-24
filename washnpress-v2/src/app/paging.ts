// One page of a list, and enough about the whole to render "showing 1-20 of 156".
// Every list that can grow without bound answers this shape, so a client never has
// to receive the entire table to show the first screen of it.
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

// A caller may ask for a page; asking for nothing gets a sensible one rather than
// everything. The ceiling is there so a single request cannot ask for the table.
export function pageParams(query: { limit?: string; offset?: string }): { limit: number; offset: number } {
  const asked = Number(query.limit);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const from = Number(query.offset);
  const offset = Number.isFinite(from) && from > 0 ? Math.floor(from) : 0;
  return { limit, offset };
}

export function paginate<T>(items: T[], query: { limit?: string; offset?: string }): Page<T> {
  const { limit, offset } = pageParams(query);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
    hasMore: offset + limit < items.length,
  };
}
