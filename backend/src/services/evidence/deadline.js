/**
 * Wall-clock budget for one evidence-research run.
 *
 * The publication source is reached through a single polite request lane
 * (see bibliotecaDigitala.js), so a search that starts a national-scale crawl
 * can easily outlast the platform's HTTP timeout and the browser's own abort —
 * the user then sees a failed request while the server keeps working. Every
 * interactive search therefore runs against a deadline: work already paid for
 * is returned and flagged `truncated`, the rest is left for a later search.
 *
 * `budgetMs = 0` (or a non-finite value) means "unbounded", which is what the
 * background ingestion worker wants: it has no HTTP request to answer.
 */
export function createDeadline(budgetMs = 0) {
  const budget = Number(budgetMs);
  const bounded = Number.isFinite(budget) && budget > 0;
  const end = bounded ? Date.now() + budget : Infinity;
  return {
    bounded,
    budgetMs: bounded ? budget : 0,
    /** Milliseconds left, or `fallback` when the run is unbounded. */
    remaining: (fallback = 20000) => (bounded ? Math.max(0, end - Date.now()) : fallback),
    /**
     * Timeout to hand a single source request so it can never outlive the run:
     * never more than `max`, never less than `min` (a request the budget has
     * already effectively expired is pointless, so it is not started at all).
     */
    timeoutFor: (max = 20000, min = 1500) => (bounded ? Math.max(min, Math.min(max, end - Date.now())) : max),
    exceeded: () => bounded && Date.now() >= end,
  };
}
