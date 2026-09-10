import type { QueryClient } from "@tanstack/react-query";

// Reports and the Dashboard compute their totals from their own React Query
// keys ("report-*" and "dashboard"), separate from the keys POS/Sales/
// Purchases use for their own lists. Without this, adding, editing, or
// deleting a bill wouldn't refresh those numbers until the user happened to
// refocus the window or remount the page. Call this after any sale or
// purchase is created, edited, or deleted so the figures update right away.
export function invalidateReports(qc: QueryClient) {
  qc.invalidateQueries({
    predicate: (q) => {
      const key = q.queryKey[0];
      return typeof key === "string" && (key.startsWith("report-") || key === "dashboard");
    },
  });
}
