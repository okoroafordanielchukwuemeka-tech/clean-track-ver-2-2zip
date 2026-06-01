import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult, QueryKey } from "@tanstack/react-query";

/**
 * UseQueryResult already carries data, isLoading, fetchStatus, isError, etc.
 * We intersect it with { isViewingCache } rather than extending via interface,
 * because UseQueryResult is a complex discriminated union that TypeScript
 * cannot extend with the `interface extends` syntax.
 */
export type CachedQueryResult<TData, TError = Error> = UseQueryResult<TData, TError> & {
  /**
   * True when the component is displaying data from the persisted IndexedDB
   * cache rather than a fresh network response.
   *
   * Two cases:
   *  1. Device is offline — React Query pauses the fetch (fetchStatus === 'paused')
   *     and returns the last hydrated cache entry.
   *  2. Server returned an error but a previous success is still held in cache
   *     (isError === true && data !== undefined).
   */
  isViewingCache: boolean;
};

export function useCachedQuery<
  TQueryFnData,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>
): CachedQueryResult<TData, TError> {
  const result = useQuery<TQueryFnData, TError, TData, TQueryKey>(options);

  const isViewingCache =
    result.data !== undefined &&
    (result.fetchStatus === "paused" || result.isError);

  return { ...result, isViewingCache } as CachedQueryResult<TData, TError>;
}
