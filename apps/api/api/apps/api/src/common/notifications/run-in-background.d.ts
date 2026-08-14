/** Test seam: forget the memoised lookup. */
export declare function resetWaitUntilCache(): void;
/**
 * Runs best-effort work that must NOT block (or fail) the response.
 *
 * On Vercel, work started after the response is returned can be frozen the
 * moment the function goes idle — a fire-and-forget notification would then
 * simply never be delivered. `waitUntil` keeps the invocation alive until the
 * promise settles. Everywhere else this degrades to the ordinary floating
 * promise with a catch, so nothing can ever reject unhandled.
 */
export declare function runInBackground(work: () => Promise<unknown>, onError: (error: unknown) => void): void;
//# sourceMappingURL=run-in-background.d.ts.map