---
name: Phase 2 Read Cache
description: How React Query persistence is wired up; what broke and why; useCachedQuery typing rules
---

## Persister wiring

`persistQueryClient()` from `@tanstack/react-query-persist-client` is called at **module scope** in `App.tsx`, alongside `new QueryClient()`. This is intentional.

**Why not `PersistQueryClientProvider`?**
`PersistQueryClientProvider` is a React component that calls hooks (`useState`, `useLayoutEffect`, `useEffect`) internally. In this project's Vite + React strict-mode setup it triggers "Invalid hook call" errors — all four hooks inside the component were flagged. Switching to the lower-level `persistQueryClient()` function (which is a plain subscribe/restore call, no hooks) resolves this completely.

**How:** `persistQueryClient` subscribes to the `queryClient` cache and calls `idbPersister.persistClient()` on every change. On the next page load, `idbPersister.restoreClient()` is called and the cache is hydrated asynchronously before any queries run.

## Persister storage

`src/lib/idb-persister.ts` — stores the serialised React Query cache as a single JSON blob in the existing `metadata` Dexie table under key `rq_persist_cache_v1`. Cache buster string is `"ct-v1"` (bump this key if the shape of persisted queries changes in a breaking way).

## useCachedQuery typing rule

`UseQueryResult` is a discriminated union. TypeScript rejects `interface CachedQueryResult extends UseQueryResult` with TS2312. The fix is a **type intersection**:

```ts
export type CachedQueryResult<TData, TError = Error> =
  UseQueryResult<TData, TError> & { isViewingCache: boolean };
```

The hook must also propagate all 4 React Query generics (`TQueryFnData`, `TError`, `TData`, `TQueryKey`) so TypeScript infers the return `data` type correctly; otherwise downstream `.map(o => ...)` calls get implicit `any`.

## Cache settings

- `staleTime: 5 * 60 * 1000` (5 minutes)
- `gcTime: 24 * 60 * 60 * 1000` (24 hours)
- `maxAge` (passed to `persistQueryClient`) equals `gcTime`

## Offline indicator components

- `src/components/offline-banner.tsx` — full-width banner above `<Outlet />` in Layout; uses `useNetworkStatus()` which does active HTTP probing
- `src/components/cached-data-badge.tsx` — inline amber badge next to page titles; shown when `isViewingCache === true`
- Pages with `CachedDataBadge`: orders, customers, services, receipts
