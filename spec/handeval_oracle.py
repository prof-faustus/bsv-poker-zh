#!/usr/bin/env python3
"""
参考评估器，仅用于为 spec §19.D 生成经过验证的测试向量。
规范编码：card_index = rank*4 + suit，rank 0..12（2=0..A=12），
suit 0..3（c=0,d=1,h=2,s=3）。内部使用 rank 值 2..14（A=14）进行
比较，并将 wheel（A-2-3-4-5）映射为顺子高牌 5。

本文件即神谕/参考实现：每个打印出的向量都是计算得来，而非断言。
"""
from itertools import combinations

RANKS = "23456789TJQKA"          # index 0..12 -> 字符
SUITS = "cdhs"                    # index 0..3 -> 字符
# 内部比较用 rank：2..14（A=14）
def idx_rank(i): return i // 4
def idx_suit(i): return i % 4
def card_str(i): return RANKS[idx_rank(i)] + SUITS[idx_suit(i)]
def parse(s):    # "As" -> index
    r = RANKS.index(s[0].upper()); su = SUITS.index(s[1].lower()); return r*4+su
def vrank(i):    # 内部 2..14
    return idx_rank(i) + 2

CAT = {8:"straight flush",7:"four of a kind",6:"full house",5:"flush",
       4:"straight",3:"three of a kind",2:"two pair",1:"one pair",0:"high card"}

def eval5_high(cards):
    """cards：5 个 index 的列表。返回可比较的 (cat, tiebreak-tuple)。"""
    vs = sorted((vrank(c) for c in cards), reverse=True)
    suits = [idx_suit(c) for c in cards]
    is_flush = len(set(suits)) == 1
    # 顺子检测（含 wheel）
    uniq = sorted(set(vs), reverse=True)
    is_straight = False; straight_high = None
    if len(uniq) == 5:
        if uniq[0]-uniq[4] == 4:
            is_straight = True; straight_high = uniq[0]
        elif uniq == [14,5,4,3,2]:        # wheel
            is_straight = True; straight_high = 5
    # 计数
    from collections import Counter
    cnt = Counter(vs)
    # 按 (count 降序, rank 降序) 对 rank 排序
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
        # rseq 已经是：高对、低对、踢脚牌
        return (2,tuple(rseq))
    if counts == [2,1,1,1]:
        return (1,tuple(rseq))
    return (0,tuple(vs))

def best_high(cards):
    """从 >=5 张牌中选出最佳的 5 张高牌（Hold'em/Stud）。"""
    best=None; bestcards=None
    for combo in combinations(cards,5):
        v=eval5_high(list(combo))
        if best is None or v>best:
            best=v; bestcards=combo
    return best, bestcards

def best_omaha(hole, board):
    """恰好 4 张底牌中的 2 张 + 恰好 5 张公共牌中的 3 张。"""
    best=None; bestcards=None
    for h in combinations(hole,2):
        for b in combinations(board,3):
            combo=list(h)+list(b)
            v=eval5_high(combo)
            if best is None or v>best:
                best=v; bestcards=combo
    return best, bestcards

# ---- A-to-five 低牌（Razz）。A 当作小牌；顺子/同花不计入。
# 最佳低牌 = 最小的五个互不相同的 rank；对子受罚。越小越好。
def low_rank_value(i):
    r = idx_rank(i)             # 0..12，其中 2=0..A=12
    return 1 if r==12 else r+2  # A->1, 2->2 ... K->13
def eval5_low(cards):
    """可比较，越小越好；返回这五个低牌值的降序排序元组，
    但对子会使这手牌变差。标准 A-to-five：
    按低牌值从高到低对这 5 张牌排序；对子越少/没有对子越好；
    以元组形式比较（先比 count-pattern，再比 values）。"""
    from collections import Counter
    vals=[low_rank_value(c) for c in cards]
    cnt=Counter(vals)
    # A-to-five：一手牌先比最高的牌，再比次高，依此类推，
    # 任何对子都会让该 rank 实际成为一个会输给无对子的 'pair'。
    # 标准实现：将多重集降序排序；有对子的一手牌
    # 比同样顶牌但无对子的一手牌更差。我们以
    # (对子或更多的数量, 降序排序的 values) 来编码这一点。
    pair_penalty = sum(c-1 for c in cnt.values())   # 全部互不相同时为 0
    return (pair_penalty, tuple(sorted(vals, reverse=True)))
def best_low(cards):
    best=None; bestcards=None
    for combo in combinations(cards,5):
        v=eval5_low(list(combo))
        if best is None or v<best:    # 越小越好
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

# 传递性抽查
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
board=[parse(x) for x in "As Ks Qs 2s 7d".split()]   # 公共牌上有四张黑桃
hole =[parse(x) for x in "Js 9h 4c 3d".split()]      # 手牌中恰好一张黑桃
allc = board+hole
vg,gc = best_high(allc)             # 通用的七选五（Hold'em 风格）—— 对 Omaha 是错误的
vo,oc = best_omaha(hole,board)      # 正确的 Omaha
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
