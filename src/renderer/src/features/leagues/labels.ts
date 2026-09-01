import type { LeagueDetail } from '@shared/types'

/**
 * The words for the three enums a league carries.
 *
 * In one module and not inline in the three screens that show them: the home
 * writes the status in a row, the league writes it in a header and the wizard
 * writes the format in its summary, and CLAUDE.md's reason for keeping error
 * messages together holds for these too — text spread across components is text
 * that ends up worded differently in each.
 *
 * Lowercase, per document 2 §2: "intestazioni di colonna e valori in minuscolo".
 * These are values. `Classic` and `Mantra` keep their capital because they are
 * the names Fantacalcio.it gives the two games, not adjectives.
 */

export const STATUS_LABELS: Record<LeagueDetail['status'], string> = {
  setup: 'in preparazione',
  pre_auction: 'pronta per l’asta',
  auction: 'asta in corso',
  review: 'in revisione',
  closed: 'cristallizzata',
}

export const MODE_LABELS: Record<LeagueDetail['mode'], string> = {
  classic: 'Classic',
  mantra: 'Mantra',
}

export const FORMAT_LABELS: Record<LeagueDetail['auctionFormat'], string> = {
  call: 'a chiamata',
  draft: 'draft a turni',
}

export const INSTANCE_ROLE_LABELS: Record<LeagueDetail['instanceRole'], string> = {
  admin: 'sono io a bandire l’asta',
  participant: 'partecipo, bandisce un altro',
}
