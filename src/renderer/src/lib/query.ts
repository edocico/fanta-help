import { QueryClient } from '@tanstack/react-query'

/**
 * The single client, per document 3 §4.
 *
 * `staleTime: Infinity` is the default here rather than per query, because it is
 * true of nearly everything this app reads: the listone changes when someone
 * imports one, the league when someone edits it. Nothing changes underneath on
 * its own, so refetching on window focus would be pure noise — and during an
 * auction, with the projector on and someone alt-tabbing, actively unhelpful.
 *
 * What invalidates is a mutation, explicitly. Document 3 §4 spells that out for
 * the auction: the purchase invalidates `auction.state` and `player.list`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      // The main process is on the other side of an IPC channel, not a network.
      // A failed call means a bug or a closed database, and neither is fixed by
      // asking again three times — it is fixed by showing the error.
      retry: false,
    },
  },
})
