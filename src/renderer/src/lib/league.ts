import { useQuery } from '@tanstack/react-query'
import { useLocation, useParams } from 'react-router-dom'
import { call } from '@/lib/ipc'
import { useLeagueStore } from '@/stores/league'

/**
 * The league in the URL is the one the sidebar follows, and the store carries it
 * to the screens that have no league in theirs — the players view, per document
 * 2 §9. Reading the route rather than a copy of it means the back button and the
 * selector can never disagree about which league is open.
 */
export function useOpenLeagueId(): number | null {
  const params = useParams()
  const stored = useLeagueStore((s) => s.activeLeagueId)
  const fromRoute = Number(params.id)
  return Number.isInteger(fromRoute) && fromRoute > 0 ? fromRoute : stored
}

/**
 * Whether the screen is in the dense half of document 7 §5 — that is, an auction
 * actually in progress, not merely a league that will have one.
 *
 * Extracted from `AppShell`, which computed it as a local const to decide how
 * wide the sidebar is. It had exactly one reader, and §10 gives it a second: the
 * abbreviation popover "goes dark in the auction", because during the auction
 * the visible abbreviations are only the role letters and the club codes, of
 * little value, and a board of 250 cells must not light popovers up as the
 * pointer crosses it.
 *
 * The route and the status are both required, and neither alone is the answer: a
 * league in `auction` seen from its own summary page is being *prepared* for the
 * evening, and the auction screen of a league not yet opened does not exist.
 *
 * Same query key as everywhere else, so this costs no call — TanStack serves it
 * from the cache the shell already filled.
 */
export function useDense(): boolean {
  const leagues = useQuery({ queryKey: ['league.list'], queryFn: () => call('league.list') })
  const openId = useOpenLeagueId()
  const location = useLocation()
  return (
    location.pathname.endsWith('/asta') &&
    leagues.data?.find((l) => l.id === openId)?.status === 'auction'
  )
}
