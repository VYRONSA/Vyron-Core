/**
 * Reads every row of a query in pages. The data API caps each response (1,000 rows by
 * default), so a plain `.select()` silently truncates large result sets — the cause of
 * under-counted hours found in the readiness audit. Use this for any list that can grow
 * past one page (attendance, rosters, payroll inputs).
 *
 * `build(from, to)` must return the query with `.range(from, to)` applied and a stable
 * `.order(...)` so pages do not overlap.
 */
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  options: { pageSize?: number; maxRows?: number } = {}
): Promise<{ data: T[]; error: string | null; truncated: boolean }> {
  const pageSize = options.pageSize ?? 1000;
  const maxRows = options.maxRows ?? 200000;
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) return { data: rows, error: error.message, truncated: false };
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null, truncated: false };
  }
  return { data: rows, error: null, truncated: true };
}
