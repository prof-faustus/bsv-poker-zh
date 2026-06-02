#!/usr/bin/env python3
"""
Reference evaluator used ONLY to GENERATE verified test vectors for spec §19.D.
Canonical spec encoding: card_index = rank*4 + suit, rank 0..12 (2=0..A=12),
suit 0..3 (c=0,d=1,h=2,s=3). Internally we use rank values 2..14 (A=14) for
comparison and map the wheel (A-2-3-4-5) to straight-high 5.

This file is the oracle: every printed vector is computed, not asserted.
"""
from itertools import combinations

RANKS = "23456789TJQKA"          # index 0..12 -> char
SUITS = "cdhs"                    # index 0..3 -> char
# internal comparison rank: 2..14 (A=14)
def idx_rank(i): return i // 4
def idx_suit(i): return i % 4
def card_str(i): return RANKS[idx_rank(i)] + SUITS[idx_suit(i)]
def parse(s):    # "As" -> index
    r = RANKS.index(s[0].upper()); su = SUITS.index(s[1].lower()); return r*4+su
def vrank(i):    # internal 2..14
    return idx_rank(i) + 2

CAT = {8:"straight flush",7:"four of a kind",6:"full house",5:"flush",
       4:"straight",3:"three of a kind",2:"two pair",1:"one pair",0:"high card"}

def eval5_high(cards):
    """cards: list of 5 indices. Returns comparable (cat, tiebreak-tuple)."""
    vs = sorted((vrank(c) for c in cards), reverse=True)
    suits = [idx_suit(c) for c in cards]
    is_flush = len(set(suits)) == 1
    # straight detection (with wheel)
    uniq = sorted(set(vs), reverse=True)
    is_straight = False; straight_high = None
    if len(uniq) == 5:
        if uniq[0]-uniq[4] == 4:
            is_straight = True; straight_high = uniq[0]
        elif uniq == [14,5,4,3,2]:        # wheel
            is_straight = True; straight_high = 5
    # counts
    from collections import Counter
    cnt = Counter(vs)
    # order ranks by (count desc, rank desc)
    ordered = sorted(cnt.items(), key=lambda kv:(kv[1],kv[0]), reverse=True)
    counts = [c for _,c in ordered]
    rseq   = [r for r,_ in ordered]
    if is_straight and is_flush:
        return (8,(straight_high,))
    if counts == [4,1]:
        return (7,tuple(rseq))
    if counts == [3,2]:
        return (6,tuple(rseq))
    if is_flush:
        return (5,tuple(vs))
    if is_straight:
        return (4,(straight_high,))
    if counts == [3,1,1]:
        return (3,tuple(rseq))
    if counts == [2,2,1]:
        # rseq already: high pair, low pair, kicker
        return (2,tuple(rseq))
    if counts == [2,1,1,1]:
        return (1,tuple(rseq))
    return (0,tuple(vs))

def best_high(cards):
    """best 5-card high hand from >=5 cards (Hold'em/Stud)."""
    best=None; bestcards=None
    for combo in combinations(cards,5):
        v=eval5_high(list(combo))
        if best is None or v>best:
            best=v; bestcards=combo
    return best, bestcards

def best_omaha(hole, board):
    """exactly 2 of 4 hole + exactly 3 of 5 board."""
    best=None; bestcards=None
    for h in combinations(hole,2):
        for b in combinations(board,3):
            combo=list(h)+list(b)
            v=eval5_high(combo)
            if best is None or v>best:
                best=v; bestcards=combo
    return best, bestcards

# ---- ace-to-five low (Razz). Aces low; straights/flushes do NOT count.
# Best low = lowest five DISTINCT ranks; pairs penalised. Lower is better.
def low_rank_value(i):
    r = idx_rank(i)             # 0..12 with 2=0..A=12
    return 1 if r==12 else r+2  # A->1, 2->2 ... K->13
def eval5_low(cards):
    """comparable where SMALLER is better; returns sorted-desc tuple of the
    five low values, but pairs make the hand worse. Standard ace-to-five:
    rank the 5 cards by their low values high-to-low; fewer/no pairs win;
    compare as a tuple (count-pattern then values)."""
    from collections import Counter
    vals=[low_rank_value(c) for c in cards]
    cnt=Counter(vals)
    # ace-to-five: a hand is compared by its highest card, then next, etc.,
    # with any pair making that rank effectively a 'pair' that loses to no-pair.
    # Standard implementation: sort the multiset descending; a hand with a pair
    # compares worse than the same top cards without a pair. We encode this by
    # (number_of_pairs_or_more, sorted-desc values).
    pair_penalty = sum(c-1 for c in cnt.values())   # 0 if all distinct
    return (pair_penalty, tuple(sorted(vals, reverse=True)))
def best_low(cards):
    best=None; bestcards=None
    for combo in combinations(cards,5):
        v=eval5_low(list(combo))
        if best is None or v<best:    # lower is better
            best=v; bestcards=combo
    return best, bestcards

def fmt(cards): return " ".join(card_str(c) for c in cards)
def show_high(label, cards):
    v,_=(eval5_high(cards),None) if len(cards)==5 else best_high(cards)
    cat = v[0]
    print(f"{label:42s} | {fmt(cards):26s} | idx={[c for c in cards]} -> {CAT[cat]:15s} tiebreak={v[1]}")
    return v

print("=== HIGH-HAND CATEGORY VECTORS (5-card) ===")
hi = {}
hi['royal_flush']      = show_high("Royal flush (spades)",          [parse(x) for x in "As Ks Qs Js Ts".split()])
hi['straight_flush_hi']= show_high("Straight flush 9-high (hearts)",[parse(x) for x in "9h 8h 7h 6h 5h".split()])
hi['steel_wheel']      = show_high("Straight flush wheel (clubs)",  [parse(x) for x in "5c 4c 3c 2c Ac".split()])
hi['quads']            = show_high("Four of a kind (Q), K kicker",  [parse(x) for x in "Qs Qh Qd Qc Ks".split()])
hi['quads_lo_kick']    = show_high("Four of a kind (Q), 2 kicker",  [parse(x) for x in "Qs Qh Qd Qc 2s".split()])
hi['boat_AAA_KK']      = show_high("Full house AAA KK",             [parse(x) for x in "As Ah Ad Ks Kh".split()])
hi['boat_KKK_AA']      = show_high("Full house KKK AA",             [parse(x) for x in "Ks Kh Kd As Ah".split()])
hi['flush_A']          = show_high("Flush A-high (diamonds)",       [parse(x) for x in "Ad Jd 9d 6d 3d".split()])
hi['flush_K']          = show_high("Flush K-high (diamonds)",       [parse(x) for x in "Kd Jd 9d 6d 3d".split()])
hi['broadway']         = show_high("Straight A-high (broadway)",    [parse(x) for x in "As Kd Qh Jc Ts".split()])
hi['wheel']            = show_high("Straight 5-high (wheel)",       [parse(x) for x in "5s 4d 3h 2c As".split()])
hi['trips']            = show_high("Trips (7s) K Q kickers",        [parse(x) for x in "7s 7h 7d Ks Qd".split()])
hi['two_pair_hi']      = show_high("Two pair A K, kicker 5",        [parse(x) for x in "As Ah Ks Kh 5d".split()])
hi['two_pair_lo']      = show_high("Two pair A K, kicker 4",        [parse(x) for x in "As Ah Ks Kh 4d".split()])
hi['pair_kick_A']      = show_high("Pair of 8s, A 7 5 kickers",     [parse(x) for x in "8s 8h Ad 7c 5h".split()])
hi['pair_kick_K']      = show_high("Pair of 8s, K 7 5 kickers",     [parse(x) for x in "8s 8h Kd 7c 5h".split()])
hi['high_A']           = show_high("High card A K J 8 6",           [parse(x) for x in "As Kd Jh 8c 6s".split()])

print("\n=== ORDERING CHECK (must be strictly descending) ===")
order = ['royal_flush','straight_flush_hi','steel_wheel','quads','boat_AAA_KK',
         'flush_A','broadway','trips','two_pair_hi','pair_kick_A','high_A']
prev=None; ok=True
for k in order:
    v=hi[k]
    if prev is not None and not (v < prev):
        ok=False; print(f"  ORDER VIOLATION at {k}: {v} !< {prev}")
    prev=v
print("  category ladder strictly descending:", ok)
print("  quads K-kick > quads 2-kick:", hi['quads']>hi['quads_lo_kick'])
print("  AAA KK > KKK AA:", hi['boat_AAA_KK']>hi['boat_KKK_AA'])
print("  flush A > flush K:", hi['flush_A']>hi['flush_K'])
print("  two pair kicker 5 > kicker 4:", hi['two_pair_hi']>hi['two_pair_lo'])
print("  pair A-kicker > pair K-kicker:", hi['pair_kick_A']>hi['pair_kick_K'])
print("  broadway > wheel:", hi['broadway']>hi['wheel'])

# transitivity spot check
import random
random.seed(1)
deck=list(range(52))
trans_ok=True
for _ in range(20000):
    a=random.sample(deck,5); b=random.sample(deck,5); c=random.sample(deck,5)
    va,vb,vc=eval5_high(a),eval5_high(b),eval5_high(c)
    if va<=vb<=vc and not (va<=vc): trans_ok=False; break
print("  transitivity (20000 random triples):", trans_ok)

print("\n=== OMAHA 2+3 CONSTRAINT (proves generic best-of-7 is WRONG for Omaha) ===")
board=[parse(x) for x in "As Ks Qs 2s 7d".split()]   # four spades on board
hole =[parse(x) for x in "Js 9h 4c 3d".split()]      # exactly one spade in hand
allc = board+hole
vg,gc = best_high(allc)             # generic best-of-7 (Hold'em-style) -- WRONG for Omaha
vo,oc = best_omaha(hole,board)      # correct Omaha
print(f"  board={fmt(board)}  hole={fmt(hole)}")
print(f"  generic best-of-7 (Hold'em) : {CAT[vg[0]]:15s} tiebreak={vg[1]}  using {fmt(gc)}")
print(f"  correct Omaha (exactly 2+3) : {CAT[vo[0]]:15s} tiebreak={vo[1]}  using {fmt(oc)}")
print(f"  differ? {vg[0]!=vo[0]}  (Hold'em sees a flush; Omaha cannot, only 1 hole spade)")

print("\n=== ACE-TO-FIVE LOW (Razz) — 7 cards, best 5-card low; lower is better ===")
def show_low(label, seven):
    v,bc=best_low(seven)
    print(f"{label:36s} | 7={fmt(seven):30s} | best-low={fmt(bc):20s} pattern={v}")
    return v
lo={}
lo['bicycle'] = show_low("Wheel A-2-3-4-5 (the bicycle)", [parse(x) for x in "Ah 2d 3c 4s 5h Kд Qs".replace('Kд','Kd').split()])
lo['six_low'] = show_low("Six-low 6-4-3-2-A",             [parse(x) for x in "Ah 2d 3c 4s 6h Ks Qd".split()])
lo['seven_low']=show_low("Seven-low 7-5-4-2-A",           [parse(x) for x in "Ah 2d 4c 5s 7h Ks Qd".split()])
lo['paired']  = show_low("Paired board forces 8-low",     [parse(x) for x in "Ah Ad 2c 3s 8h 9s Td".split()])
lo['flush_irrelevant']=show_low("All hearts still wheel (flush ignored)",[parse(x) for x in "Ah 2h 3h 4h 5h Kh Qh".split()])
print("  bicycle < six-low:", lo['bicycle']<lo['six_low'])
print("  six-low < seven-low:", lo['six_low']<lo['seven_low'])
print("  no-pair seven-low < paired eight-low:", lo['seven_low']<lo['paired'])
print("  flush ignored: all-hearts == bicycle pattern:", lo['flush_irrelevant']==lo['bicycle'])
