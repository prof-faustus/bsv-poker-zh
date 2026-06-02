/**
 * Offline practice — a variant-generic universal bot + a full-hand driver so a single player can
 * practice ANY of the five variants vs bots (not just Hold'em). Browser-safe; deterministic
 * (injected deck). The engine enforces legality; the bot only ever picks among legal actions.
 */

import {
  type Action,
  type Card,
  type GameState,
  type LegalActions,
  type Ruleset,
  type Variant,
} from '@bsv-poker/protocol-types';
import { createGameModule } from './game-registry.ts';

/** A simple, always-legal bot: check → stand-pat (draw) → call → min-bet (e.g. bring-in) → fold. */
export function universalBot(legal: LegalActions, seat: number): Action {
  if (legal.check) return { kind: 'check', seat, amount: 0 };
  if (legal.draw) return { kind: 'stand', seat, amount: 0 }; // draw phase: keep the hand
  if (legal.call) return { kind: 'call', seat, amount: legal.call.amount };
  if (legal.bet) return { kind: 'bet', seat, amount: legal.bet.min }; // open / bring-in
  return { kind: 'fold', seat, amount: 0 };
}

export interface OfflineSeatInit {
  readonly seat: number;
  readonly stack: number;
}

/** Play one full offline hand of `variant` with bots; returns the settled state. */
export function playOfflineHand(
  variant: Variant,
  ruleset: Ruleset,
  seats: OfflineSeatInit[],
  deck: readonly Card[],
  strategy: (legal: LegalActions, seat: number, state: GameState) => Action = universalBot,
): GameState {
  const m = createGameModule(variant, deck);
  let state = m.init(ruleset, seats.map((s) => ({ seat: s.seat, stack: s.stack })));
  // Bounded loop (Power-of-Ten): a hand has a finite number of actionable transitions.
  for (let guard = 0; guard < 5000 && !state.handComplete; guard++) {
    // betting turn, else a non-betting decision turn (e.g. the Draw discard, drawToAct)
    const toAct = state.betting.toAct ?? state.drawToAct ?? null;
    if (toAct === null) break;
    state = m.apply(state, strategy(m.getLegalActions(state, toAct), toAct, state));
  }
  return state;
}

/** A default ruleset for a variant for offline practice (blinds vs ante+bring-in per variant). */
export function offlineRuleset(variant: Variant, seats: number): Ruleset {
  const bringInVariant = variant === 'stud' || variant === 'razz';
  return {
    variant,
    bettingStructure: 'NL',
    forcedBetModel: bringInVariant ? 'ante-bringin' : 'blinds',
    seats,
    blinds: {
      smallBlind: bringInVariant ? 0 : 1,
      bigBlind: bringInVariant ? 0 : 2,
      ante: bringInVariant ? 1 : 0,
      bringIn: bringInVariant ? 1 : 0,
    },
    minBuyIn: 100,
    maxBuyIn: 200,
    timeouts: { decisionMs: 30000, recoveryMs: 120000 },
    signingMode: 'A',
    currency: 'play-regtest',
    suitTiebreakHouseRule: false,
    hiLo: false,
  };
}
