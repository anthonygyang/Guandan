// ========== 掼蛋游戏核心 ==========

// --- 常量定义 ---
const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_DISPLAY = { '10': '10', 'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A' };

// 牌型枚举
const HAND_TYPE = {
    SINGLE: 'single',           // 单张
    PAIR: 'pair',               // 对子
    TRIPLE: 'triple',           // 三张
    TRIPLE_PLUS_TWO: 'triple2', // 三带二
    STRAIGHT: 'straight',       // 顺子(固定5张)
    DOUBLE_STRAIGHT: 'dstraight', // 连对(固定3连对=6张)
    TRIPLE_STRAIGHT: 'tstraight', // 钢板(固定2连三张=6张)
    BOMB_4: 'bomb4',            // 炸弹(4张)
    BOMB_5: 'bomb5',            // 炸弹(5张)
    BOMB_6: 'bomb6',            // 炸弹(6张)
    BOMB_7: 'bomb7',            // 炸弹(7张)
    BOMB_8: 'bomb8',            // 炸弹(8张)
    ROCKET: 'rocket',           // 火箭(大小王)
    BOMB_TONGHUA: 'bombtonghua', // 同花顺(固定5张)
    INVALID: 'invalid'
};

// 炸弹大小排序(从小到大)
const BOMB_ORDER = [HAND_TYPE.BOMB_4, HAND_TYPE.BOMB_5, HAND_TYPE.BOMB_TONGHUA, HAND_TYPE.BOMB_6, HAND_TYPE.BOMB_7, HAND_TYPE.BOMB_8, HAND_TYPE.ROCKET];

// --- 游戏状态 ---
const state = {
    playerLevel: 2,
    aiLevel: 2,
    trumpRank: '2',
    aiTrumpRank: '2',
    round: 1,
    playerHand: [],
    aiHand: [],
    lastPlayed: null,       // { cards, type, rank, player }
    lastPlayedBy: null,     // 'player' | 'ai'
    currentTurn: null,      // 'player' | 'ai'
    firstPlayer: null,      // 本回合谁先出
    selectedIndices: new Set(),
    gameActive: false,
    lastRoundWinner: null,  // 上回合赢家
    hintIndex: 0,           // 提示索引
    hintOptions: [],        // 提示可选牌组
    cardGroups: [],         // 理牌分组 [ { cards: [card,...], type: string, label: string } ]
    selectedGroupIndex: -1, // 当前选中的分组索引(-1表示无选中)
    playerLastPlayedCards: [], // 玩家最后一手出的牌（实际牌对象数组）
    aiLastPlayedCards: [],     // AI最后一手出的牌（实际牌对象数组）
};

// --- 工具函数 ---

// 判断一张牌是否是癞子(万能牌): 红桃+当前级牌点数
function isWildCard(card, trumpRank) {
    if (card.isJoker) return false;
    return card.suit === '♥' && card.rank === trumpRank;
}

// 获取当前局的"拖"牌点数：打2时3是拖，打非2时2是拖
function getDragRank(trumpRank) {
    return trumpRank === '2' ? '3' : '2';
}

// 判断一张牌是否是拖（最小牌）
function isDragCard(card, trumpRank) {
    if (card.isJoker) return false;
    return card.rank === getDragRank(trumpRank);
}

// 判断一张牌是否是红桃拖
function isHeartDragCard(card, trumpRank) {
    return isDragCard(card, trumpRank) && card.suit === '♥';
}

// 计算一组牌中的拖牌信息
function countDragCards(cards, trumpRank) {
    let dragCount = 0;
    let heartDragCount = 0;
    cards.forEach(c => {
        if (isDragCard(c, trumpRank)) {
            dragCount++;
            if (c.suit === '♥') heartDragCount++;
        }
    });
    return { dragCount, heartDragCount };
}

// 判断一组牌是否全部由拖构成（纯拖）
function isAllDragCards(cards, trumpRank) {
    return cards.length > 0 && cards.every(c => isDragCard(c, trumpRank));
}

// 获取牌的基础数值(用于顺子连续性检测等)
// 3=3, 4=4, ..., A=14, 2=15, 小王=16, 大王=17
function cardValue(card, trumpRank) {
    if (card.isJoker) return card.jokerType === 'big' ? 17 : 16;
    const rank = card.rank;
    const order = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    return order.indexOf(rank) + 3;
}

// 获取牌在比较大小时的数值(级牌最大，打几几就是最大的非王牌)
function cardCompareValue(card, trumpRank) {
    if (card.isJoker) return card.jokerType === 'big' ? 17 : 16;
    const rank = card.rank;
    const order = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    let v = order.indexOf(rank) + 3;
    // 当级牌不是2时，级牌提升为最大的非王牌
    if (rank === trumpRank && trumpRank !== '2') v = 15.5;
    return v;
}

// 获取牌的排序值(手牌排序用)
function sortValue(card, trumpRank) {
    if (card.isJoker) {
        // 大小王排在最右边：小王=170, 大王=180
        return card.jokerType === 'big' ? 180 : 170;
    }
    // 基础顺序: 3=3, 4=4, ..., K=13, A=14, 2=15
    const order = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    let v = order.indexOf(card.rank) + 3;
    
    if (trumpRank !== '2') {
        // 当级牌不是2时：
        // 级牌排在王左边（最大非王牌），v=16
        if (card.rank === trumpRank) v = 16;
        // 2变成最小的牌，排到最左边，v=2
        if (card.rank === '2') v = 2;
    }
    // 当级牌是2时，2自然就在最右边(v=15)，不需要特殊处理
    
    // 花色次序
    const suitOrder = { '♠': 3, '♥': 2, '♣': 1, '♦': 0 };
    return v * 10 + (suitOrder[card.suit] || 0);
}

// 按点数分组
function groupByRank(cards) {
    const groups = {};
    cards.forEach((c, i) => {
        const key = c.isJoker ? (c.jokerType) : c.rank;
        if (!groups[key]) groups[key] = [];
        groups[key].push({ card: c, index: i });
    });
    return groups;
}

// 生成2副牌(108张)
function generateDoubleDeck() {
    const deck = [];
    for (let d = 0; d < 2; d++) {
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                deck.push({ suit, rank, isJoker: false, id: `${suit}${rank}_${d}` });
            }
        }
        deck.push({ isJoker: true, jokerType: 'small', suit: '', rank: 'JOKER', id: `joker_small_${d}` });
        deck.push({ isJoker: true, jokerType: 'big', suit: '', rank: 'JOKER', id: `joker_big_${d}` });
    }
    return deck;
}

// 洗牌
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// 发牌: 从108张中随机选54张，分给两人各27张
function deal() {
    const deck = generateDoubleDeck();
    const shuffled = shuffle(deck);
    const selected = shuffled.slice(0, 54);
    const half = shuffle(selected);
    return {
        player: half.slice(0, 27),
        ai: half.slice(27, 54)
    };
}

// 排序手牌
function sortHand(hand, trumpRank) {
    return [...hand].sort((a, b) => sortValue(a, trumpRank) - sortValue(b, trumpRank));
}

// 判断是否是红色花色
function isRed(card) {
    if (card.isJoker) return card.jokerType === 'big';
    return card.suit === '♥' || card.suit === '♦';
}

// 获取牌的显示文字
function cardDisplay(card) {
    if (card.isJoker) {
        return card.jokerType === 'big' ? '大王' : '小王';
    }
    return card.suit + card.rank;
}

// --- 级牌逻辑 ---
function getLevelRank(level) {
    // 级别2-14对应 2,3,4,5,6,7,8,9,10,J,Q,K,A
    if (level <= 1) level = 2;
    if (level > 14) level = 14;
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    return ranks[level - 2];
}

// --- 牌型识别 ---
function identifyHand(cards, trumpRank) {
    const n = cards.length;
    if (n === 0) return { type: HAND_TYPE.INVALID, rank: 0 };

    // 分离大小王、癞子、普通牌
    const jokers = cards.filter(c => c.isJoker);
    const wilds = cards.filter(c => isWildCard(c, trumpRank));
    const normals = cards.filter(c => !c.isJoker && !isWildCard(c, trumpRank));
    const wildCount = wilds.length;

    // 火箭：四个王(2大2小) 最大
    if (n === 4 && jokers.length === 4) {
        return { type: HAND_TYPE.ROCKET, rank: 999 };
    }

    // 单张
    if (n === 1) {
        return { type: HAND_TYPE.SINGLE, rank: cardCompareValue(cards[0], trumpRank) };
    }

    // 对子 (含癞子配对)
    if (n === 2) {
        // 两张王配对（同类型的两张王，如两个小王或两个大王）
        if (jokers.length === 2 && jokers[0].jokerType === jokers[1].jokerType) {
            const v = jokers[0].jokerType === 'big' ? 17 : 16;
            return { type: HAND_TYPE.PAIR, rank: v };
        }
        if (jokers.length === 0) {
            const nonWild = normals;
            if (wildCount === 0 && nonWild.length === 2 && nonWild[0].rank === nonWild[1].rank) {
                return { type: HAND_TYPE.PAIR, rank: cardCompareValue(nonWild[0], trumpRank) };
            }
            if (wildCount === 1 && nonWild.length === 1) {
                // 癞子 + 一张牌 = 对子
                return { type: HAND_TYPE.PAIR, rank: cardCompareValue(nonWild[0], trumpRank) };
            }
            if (wildCount === 2) {
                // 两张癞子 = 对子(按级牌点数算)
                return { type: HAND_TYPE.PAIR, rank: cardCompareValue(wilds[0], trumpRank) };
            }
        }
    }

    // 纯非王非癞子牌分析
    const groups = {};
    normals.forEach(c => {
        if (!groups[c.rank]) groups[c.rank] = [];
        groups[c.rank].push(c);
    });

    const rankCounts = Object.entries(groups).map(([rank, arr]) => ({
        rank,
        count: arr.length,
        value: cardCompareValue(arr[0], trumpRank),
        cards: arr
    }));
    rankCounts.sort((a, b) => a.value - b.value);

    if (jokers.length === 0) {
        // 三张(含癞子)
        if (n === 3) {
            if (rankCounts.length === 1 && rankCounts[0].count + wildCount === 3) {
                return { type: HAND_TYPE.TRIPLE, rank: rankCounts[0].value };
            }
            // 只有癞子
            if (rankCounts.length === 0 && wildCount === 3) {
                return { type: HAND_TYPE.TRIPLE, rank: cardCompareValue(wilds[0], trumpRank) };
            }
        }

        // 三带二(含癞子补充三张部分)
        if (n === 5 && rankCounts.length >= 1) {
            // 尝试找到一个rank可以凑成3张(用癞子补)，剩余2张构成一对
            const result = tryTriplePlusTwoWithWild(rankCounts, wildCount, trumpRank);
            if (result) return result;
        }

        // 炸弹(4-8张同点数, 含癞子)
        if (n >= 4 && n <= 8) {
            const bombResult = tryBombWithWild(rankCounts, wildCount, n, trumpRank);
            if (bombResult) return bombResult;
        }

        // 同花顺检测（直接检查5张牌，优先于普通顺子）
        if (n === 5) {
            const tonghuaResult = tryTonghuashunDirect(cards, trumpRank);
            if (tonghuaResult) return tonghuaResult;
        }

        // 顺子(固定5张连续不同点数, 不含2和王, 含癞子填补)
        if (n === 5) {
            const straightResult = tryStraightWithWild(normals, wildCount, n, trumpRank);
            if (straightResult) return straightResult;
        }

        // 连对(固定3连对=6张, 含癞子)
        if (n === 6) {
            const dsResult = tryDoubleStraightWithWild(normals, wildCount, n, trumpRank);
            if (dsResult) return dsResult;
        }

        // 钢板/连三张(固定2连三张=6张, 含癞子)
        if (n === 6) {
            const tsResult = tryTripleStraightWithWild(normals, wildCount, n, trumpRank);
            if (tsResult) return tsResult;
        }
    }

    return { type: HAND_TYPE.INVALID, rank: 0 };
}

// 辅助: 尝试三带二(含癞子)
function tryTriplePlusTwoWithWild(rankCounts, wildCount, trumpRank) {
    // 尝试每个rank作为三张主体
    for (const rc of rankCounts) {
        const needWildForTriple = 3 - rc.count;
        if (needWildForTriple < 0 || needWildForTriple > wildCount) continue;

        const remainingWild = wildCount - needWildForTriple;
        // 剩余的普通牌(不含三张主体)
        const otherNormals = rankCounts.filter(r => r.rank !== rc.rank);
        const otherCount = otherNormals.reduce((sum, r) => sum + r.count, 0);

        // 需要2张配牌
        if (otherCount + remainingWild === 2) {
            // 检查配牌是否构成一对
            if (otherNormals.length === 1 && otherNormals[0].count === 2) {
                return { type: HAND_TYPE.TRIPLE_PLUS_TWO, rank: rc.value };
            }
            if (otherNormals.length === 1 && otherNormals[0].count === 1 && remainingWild === 1) {
                return { type: HAND_TYPE.TRIPLE_PLUS_TWO, rank: rc.value };
            }
            if (otherNormals.length === 0 && remainingWild === 2) {
                return { type: HAND_TYPE.TRIPLE_PLUS_TWO, rank: rc.value };
            }
        }
    }
    return null;
}

// 辅助: 尝试炸弹(含癞子)
function tryBombWithWild(rankCounts, wildCount, n, trumpRank) {
    if (rankCounts.length === 1) {
        const totalCount = rankCounts[0].count + wildCount;
        if (totalCount === n && n >= 4) {
            const bombTypes = {
                4: HAND_TYPE.BOMB_4,
                5: HAND_TYPE.BOMB_5,
                6: HAND_TYPE.BOMB_6,
                7: HAND_TYPE.BOMB_7,
                8: HAND_TYPE.BOMB_8
            };
            return { type: bombTypes[n], rank: rankCounts[0].value };
        }
    }
    // 全是癞子也可以是炸弹
    if (rankCounts.length === 0 && wildCount === n && n >= 4) {
        const bombTypes = {
            4: HAND_TYPE.BOMB_4,
            5: HAND_TYPE.BOMB_5,
            6: HAND_TYPE.BOMB_6,
            7: HAND_TYPE.BOMB_7,
            8: HAND_TYPE.BOMB_8
        };
        return { type: bombTypes[n], rank: cardCompareValue({ rank: trumpRank, isJoker: false }, trumpRank) };
    }
    return null;
}

// 辅助: 直接检测5张牌是否为同花顺(支持癞子)
function tryTonghuashunDirect(cards, trumpRank) {
    if (cards.length !== 5) return null;
    // 排除含王的情况
    if (cards.some(c => c.isJoker)) return null;
    
    // 分离癞子和普通牌
    const wilds = cards.filter(c => isWildCard(c, trumpRank));
    const normals = cards.filter(c => !isWildCard(c, trumpRank));
    const wildCount = wilds.length;
    
    // 排除含2的普通牌
    if (normals.some(c => c.rank === '2')) return null;
    
    // 确定花色：以普通牌的花色为准，所有普通牌必须同花色
    if (normals.length === 0) return null; // 全是癞子不算同花顺
    const targetSuit = normals[0].suit;
    if (!normals.every(c => c.suit === targetSuit)) return null;
    
    // 检查连续性（用原始值），癞子可以填补空缺
    const values = normals.map(c => cardValue(c, trumpRank));
    const uniqueValues = [...new Set(values)].sort((a, b) => a - b);
    
    // 如果有重复值的普通牌，无法组成顺子
    if (uniqueValues.length !== normals.length) return null;
    
    // 尝试所有可能的5张连续范围
    for (let startVal = 3; startVal <= 10; startVal++) { // 最大: 10-14(A)
        let gaps = 0;
        let valid = true;
        for (let v = startVal; v < startVal + 5; v++) {
            if (v > 14) { valid = false; break; } // 不能超过A
            if (!uniqueValues.includes(v)) {
                gaps++;
            }
        }
        if (!valid) continue;
        if (gaps <= wildCount) {
            // 检查所有普通牌的值都在这个范围内
            const allInRange = uniqueValues.every(v => v >= startVal && v < startVal + 5);
            if (allInRange) {
                const highValue = startVal + 4;
                return { type: HAND_TYPE.BOMB_TONGHUA, rank: highValue, length: 5 };
            }
        }
    }
    
    return null;
}

// 辅助: 尝试顺子(含癞子填补空缺, 固定5张)
function tryStraightWithWild(normals, wildCount, n, trumpRank) {
    // n must be 5
    // 所有非2的普通牌
    const nonTwo = normals.filter(c => c.rank !== '2');
    if (nonTwo.length + wildCount < n) return null;

    // 按value去重(只保留唯一value)
    const valueMap = {};
    nonTwo.forEach(c => {
        const v = cardValue(c, trumpRank);
        if (!valueMap[v]) valueMap[v] = c;
    });
    const uniqueValues = Object.keys(valueMap).map(Number).sort((a, b) => a - b);

    // 尝试所有可能的起始点
    // 顺子范围: 3到14(A), 每个value只能用1张
    for (let startVal = 3; startVal <= 14 - n + 1; startVal++) {
        let gaps = 0;
        let allNonTwo = true;
        for (let v = startVal; v < startVal + n; v++) {
            // value 15 对应 2, 不允许
            if (v === 15) { allNonTwo = false; break; }
            if (!uniqueValues.includes(v)) {
                gaps++;
            }
        }
        if (!allNonTwo) continue;
        if (gaps <= wildCount) {
            const highValue = startVal + n - 1;
            // 检查同花顺（癞子可以充当任意花色，只要普通牌全部同花色即可）
            const allCards = [];
            let usedWild = 0;
            let normalSameSuit = true;
            let firstSuit = null;
            for (let v = startVal; v < startVal + n; v++) {
                if (valueMap[v]) {
                    allCards.push(valueMap[v]);
                    if (firstSuit === null) firstSuit = valueMap[v].suit;
                    else if (valueMap[v].suit !== firstSuit) normalSameSuit = false;
                } else {
                    usedWild++;
                    // 癞子可以充当任意花色，不影响同花判定
                }
            }
            if (normalSameSuit && firstSuit !== null) {
                return { type: HAND_TYPE.BOMB_TONGHUA, rank: highValue, length: n };
            }
            // 检查除了gaps用癞子填外，总数是否正好=n
            const normalUsed = n - gaps;
            if (normalUsed + gaps === n && nonTwo.length >= normalUsed) {
                return { type: HAND_TYPE.STRAIGHT, rank: highValue, length: n };
            }
        }
    }
    return null;
}

// 辅助: 尝试连对(含癞子, 固定3连对=6张)
function tryDoubleStraightWithWild(normals, wildCount, n, trumpRank) {
    const pairCount = n / 2; // 应该等于3
    if (pairCount !== 3) return null;

    const nonTwo = normals.filter(c => c.rank !== '2');
    // 按rank分组
    const groups = {};
    nonTwo.forEach(c => {
        if (!groups[c.rank]) groups[c.rank] = [];
        groups[c.rank].push(c);
    });

    const rankValues = Object.entries(groups).map(([rank, arr]) => ({
        rank,
        count: arr.length,
        value: cardValue(arr[0], trumpRank)
    })).sort((a, b) => a.value - b.value);

    for (let startVal = 3; startVal <= 14 - pairCount + 1; startVal++) {
        let wildsNeeded = 0;
        let valid = true;
        for (let v = startVal; v < startVal + pairCount; v++) {
            if (v === 15) { valid = false; break; }
            const entry = rankValues.find(r => r.value === v);
            if (!entry) {
                wildsNeeded += 2;
            } else if (entry.count < 2) {
                wildsNeeded += (2 - entry.count);
            }
        }
        if (valid && wildsNeeded <= wildCount && wildsNeeded + nonTwo.length >= n) {
            return { type: HAND_TYPE.DOUBLE_STRAIGHT, rank: startVal + pairCount - 1, length: pairCount };
        }
    }
    return null;
}

// 辅助: 尝试钢板(含癞子, 固定2连三张=6张)
function tryTripleStraightWithWild(normals, wildCount, n, trumpRank) {
    const tripleCount = n / 3; // 应该等于2
    if (tripleCount !== 2) return null;

    const nonTwo = normals.filter(c => c.rank !== '2');
    const groups = {};
    nonTwo.forEach(c => {
        if (!groups[c.rank]) groups[c.rank] = [];
        groups[c.rank].push(c);
    });

    const rankValues = Object.entries(groups).map(([rank, arr]) => ({
        rank,
        count: arr.length,
        value: cardValue(arr[0], trumpRank)
    })).sort((a, b) => a.value - b.value);

    for (let startVal = 3; startVal <= 14 - tripleCount + 1; startVal++) {
        let wildsNeeded = 0;
        let valid = true;
        for (let v = startVal; v < startVal + tripleCount; v++) {
            if (v === 15) { valid = false; break; }
            const entry = rankValues.find(r => r.value === v);
            if (!entry) {
                wildsNeeded += 3;
            } else if (entry.count < 3) {
                wildsNeeded += (3 - entry.count);
            }
        }
        if (valid && wildsNeeded <= wildCount && wildsNeeded + nonTwo.length >= n) {
            return { type: HAND_TYPE.TRIPLE_STRAIGHT, rank: startVal + tripleCount - 1, length: tripleCount };
        }
    }
    return null;
}

// 判断出牌是否能压过上家
function canBeat(playedInfo, lastInfo) {
    if (!lastInfo) return true; // 自由出牌

    const pType = playedInfo.type;
    const lType = lastInfo.type;

    // 火箭最大
    if (pType === HAND_TYPE.ROCKET) return true;
    if (lType === HAND_TYPE.ROCKET) return false;

    // 炸弹比较
    const pBombIdx = BOMB_ORDER.indexOf(pType);
    const lBombIdx = BOMB_ORDER.indexOf(lType);

    if (pBombIdx >= 0 && lBombIdx >= 0) {
        // 两个都是炸弹类型
        if (pBombIdx > lBombIdx) return true;
        if (pBombIdx < lBombIdx) return false;
        // 同类型炸弹比大小
        if (pType === HAND_TYPE.BOMB_TONGHUA) {
            // 同花顺固定5张，直接比点数
            return playedInfo.rank > lastInfo.rank;
        }
        return playedInfo.rank > lastInfo.rank;
    }

    // 一方是炸弹，另一方不是
    if (pBombIdx >= 0 && lBombIdx < 0) return true;
    if (pBombIdx < 0 && lBombIdx >= 0) return false;

    // 普通牌型必须相同
    if (pType !== lType) return false;

    return playedInfo.rank > lastInfo.rank;
}

// --- AI逻辑 ---

// 从手牌中找出所有能打的牌组合
function findPlayableHands(hand, lastPlayedInfo, trumpRank) {
    const results = [];
    const groups = {};
    const jokers = [];

    hand.forEach((c, i) => {
        if (c.isJoker) {
            jokers.push({ card: c, index: i });
        } else {
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push({ card: c, index: i });
        }
    });

    const rankEntries = Object.entries(groups).map(([rank, arr]) => ({
        rank,
        cards: arr,
        value: cardValue(arr[0].card, trumpRank),         // 原始值(顺子连续性)
        compareValue: cardCompareValue(arr[0].card, trumpRank), // 比较值(大小比较)
        count: arr.length
    }));
    rankEntries.sort((a, b) => a.value - b.value);

    // 如果没有上家出牌(自由出)
    if (!lastPlayedInfo) {
        // 找所有可出牌型
        addAllSingles(results, rankEntries, jokers);
        addAllPairs(results, rankEntries, jokers);
        addAllTriples(results, rankEntries);
        addAllTriplePlusTwo(results, rankEntries);
        addAllBombs(results, rankEntries, jokers);
        addAllStraights(results, rankEntries);
        addAllDoubleStraights(results, rankEntries);
        addAllTripleStraights(results, rankEntries);
        addAllTonghuashun(results, hand, trumpRank);
        return results;
    }

    const targetType = lastPlayedInfo.type;
    const targetRank = lastPlayedInfo.rank;
    const targetLength = lastPlayedInfo.length;

    // 找同类型更大的
    switch (targetType) {
        case HAND_TYPE.SINGLE:
            addBiggerSingles(results, rankEntries, jokers, targetRank);
            break;
        case HAND_TYPE.PAIR:
            addBiggerPairs(results, rankEntries, jokers, targetRank);
            break;
        case HAND_TYPE.TRIPLE:
            addBiggerTriples(results, rankEntries, targetRank);
            break;
        case HAND_TYPE.TRIPLE_PLUS_TWO:
            addBiggerTriplePlusTwo(results, rankEntries, targetRank);
            break;
        case HAND_TYPE.STRAIGHT:
            addBiggerStraights(results, rankEntries, targetRank, targetLength);
            break;
        case HAND_TYPE.DOUBLE_STRAIGHT:
            addBiggerDoubleStraights(results, rankEntries, targetRank, targetLength);
            break;
        case HAND_TYPE.TRIPLE_STRAIGHT:
            addBiggerTripleStraights(results, rankEntries, targetRank, targetLength);
            break;
    }

    // 除非自身就是炸弹类型，任何情况都可以用更大的炸弹压
    if (BOMB_ORDER.indexOf(targetType) < 0) {
        // 上家不是炸弹，所有炸弹都能压
        addAllBombs(results, rankEntries, jokers);
        addAllTonghuashun(results, hand, trumpRank);
    } else {
        // 上家是炸弹，找更大的炸弹
        addBiggerBombs(results, rankEntries, jokers, lastPlayedInfo, hand, trumpRank);
    }

    return results;
}

// --- 辅助：生成各种牌型 ---

function addAllSingles(results, rankEntries, jokers) {
    rankEntries.forEach(r => {
        results.push({ indices: [r.cards[0].index], type: HAND_TYPE.SINGLE, rank: r.compareValue });
    });
    jokers.forEach(j => {
        const v = j.card.jokerType === 'big' ? 17 : 16;
        results.push({ indices: [j.index], type: HAND_TYPE.SINGLE, rank: v });
    });
}

function addBiggerSingles(results, rankEntries, jokers, targetRank) {
    rankEntries.forEach(r => {
        if (r.compareValue > targetRank) {
            results.push({ indices: [r.cards[0].index], type: HAND_TYPE.SINGLE, rank: r.compareValue });
        }
    });
    jokers.forEach(j => {
        const v = j.card.jokerType === 'big' ? 17 : 16;
        if (v > targetRank) {
            results.push({ indices: [j.index], type: HAND_TYPE.SINGLE, rank: v });
        }
    });
}

function addAllPairs(results, rankEntries, jokers) {
    rankEntries.forEach(r => {
        if (r.count >= 2) {
            results.push({ indices: [r.cards[0].index, r.cards[1].index], type: HAND_TYPE.PAIR, rank: r.compareValue });
        }
    });
    // 两张相同类型的王组成对子
    if (jokers) {
        const bigJokers = jokers.filter(j => j.card.jokerType === 'big');
        const smallJokers = jokers.filter(j => j.card.jokerType === 'small');
        if (bigJokers.length >= 2) {
            results.push({ indices: [bigJokers[0].index, bigJokers[1].index], type: HAND_TYPE.PAIR, rank: 17 });
        }
        if (smallJokers.length >= 2) {
            results.push({ indices: [smallJokers[0].index, smallJokers[1].index], type: HAND_TYPE.PAIR, rank: 16 });
        }
    }
}

function addBiggerPairs(results, rankEntries, jokers, targetRank) {
    rankEntries.forEach(r => {
        if (r.count >= 2 && r.compareValue > targetRank) {
            results.push({ indices: [r.cards[0].index, r.cards[1].index], type: HAND_TYPE.PAIR, rank: r.compareValue });
        }
    });
    // 两张相同类型的王组成对子
    if (jokers) {
        const bigJokers = jokers.filter(j => j.card.jokerType === 'big');
        const smallJokers = jokers.filter(j => j.card.jokerType === 'small');
        if (bigJokers.length >= 2 && 17 > targetRank) {
            results.push({ indices: [bigJokers[0].index, bigJokers[1].index], type: HAND_TYPE.PAIR, rank: 17 });
        }
        if (smallJokers.length >= 2 && 16 > targetRank) {
            results.push({ indices: [smallJokers[0].index, smallJokers[1].index], type: HAND_TYPE.PAIR, rank: 16 });
        }
    }
}

function addAllTriples(results, rankEntries) {
    rankEntries.forEach(r => {
        if (r.count >= 3) {
            results.push({ indices: [r.cards[0].index, r.cards[1].index, r.cards[2].index], type: HAND_TYPE.TRIPLE, rank: r.compareValue });
        }
    });
}

function addBiggerTriples(results, rankEntries, targetRank) {
    rankEntries.forEach(r => {
        if (r.count >= 3 && r.compareValue > targetRank) {
            results.push({ indices: [r.cards[0].index, r.cards[1].index, r.cards[2].index], type: HAND_TYPE.TRIPLE, rank: r.compareValue });
        }
    });
}

function addAllTriplePlusTwo(results, rankEntries) {
    const pairs = rankEntries.filter(r => r.count >= 2);
    rankEntries.forEach(r => {
        if (r.count >= 3) {
            pairs.forEach(p => {
                if (p.rank !== r.rank) {
                    const indices = [r.cards[0].index, r.cards[1].index, r.cards[2].index, p.cards[0].index, p.cards[1].index];
                    results.push({ indices, type: HAND_TYPE.TRIPLE_PLUS_TWO, rank: r.compareValue });
                }
            });
        }
    });
}

function addBiggerTriplePlusTwo(results, rankEntries, targetRank) {
    const pairs = rankEntries.filter(r => r.count >= 2);
    rankEntries.forEach(r => {
        if (r.count >= 3 && r.compareValue > targetRank) {
            pairs.forEach(p => {
                if (p.rank !== r.rank) {
                    const indices = [r.cards[0].index, r.cards[1].index, r.cards[2].index, p.cards[0].index, p.cards[1].index];
                    results.push({ indices, type: HAND_TYPE.TRIPLE_PLUS_TWO, rank: r.compareValue });
                }
            });
        }
    });
}

function addAllBombs(results, rankEntries, jokers) {
    rankEntries.forEach(r => {
        for (let size = 4; size <= r.count; size++) {
            const bombTypes = { 4: HAND_TYPE.BOMB_4, 5: HAND_TYPE.BOMB_5, 6: HAND_TYPE.BOMB_6, 7: HAND_TYPE.BOMB_7, 8: HAND_TYPE.BOMB_8 };
            const indices = r.cards.slice(0, size).map(c => c.index);
            results.push({ indices, type: bombTypes[size], rank: r.compareValue });
        }
    });
    // 天王炸
    if (jokers.length === 4) {
        results.push({ indices: jokers.map(j => j.index), type: HAND_TYPE.ROCKET, rank: 999 });
    }
}

function addBiggerBombs(results, rankEntries, jokers, lastInfo, hand, trumpRank) {
    const lBombIdx = BOMB_ORDER.indexOf(lastInfo.type);

    // 同类型更大的
    rankEntries.forEach(r => {
        const bombTypes = { 4: HAND_TYPE.BOMB_4, 5: HAND_TYPE.BOMB_5, 6: HAND_TYPE.BOMB_6, 7: HAND_TYPE.BOMB_7, 8: HAND_TYPE.BOMB_8 };
        for (let size = 4; size <= r.count; size++) {
            const bt = bombTypes[size];
            const bi = BOMB_ORDER.indexOf(bt);
            if (bi > lBombIdx || (bi === lBombIdx && r.compareValue > lastInfo.rank)) {
                const indices = r.cards.slice(0, size).map(c => c.index);
                results.push({ indices, type: bt, rank: r.compareValue });
            }
        }
    });

    // 同花顺（如果上家是同花顺以下的）
    if (lBombIdx <= BOMB_ORDER.indexOf(HAND_TYPE.BOMB_TONGHUA)) {
        addAllTonghuashun(results, hand, trumpRank, lastInfo);
    }

    // 天王炸
    if (jokers.length === 4) {
        results.push({ indices: jokers.map(j => j.index), type: HAND_TYPE.ROCKET, rank: 999 });
    }
}

function addAllStraights(results, rankEntries) {
    const singles = rankEntries.filter(r => r.rank !== '2');
    const len = 5; // 顺子固定5张
    for (let start = 0; start <= singles.length - len; start++) {
        let valid = true;
        const indices = [];
        for (let i = 0; i < len; i++) {
            if (i > 0 && singles[start + i].value - singles[start + i - 1].value !== 1) {
                valid = false;
                break;
            }
            indices.push(singles[start + i].cards[0].index);
        }
        if (valid) {
            results.push({ indices, type: HAND_TYPE.STRAIGHT, rank: singles[start + len - 1].value, length: len });
        }
    }
}

function addBiggerStraights(results, rankEntries, targetRank, targetLength) {
    const singles = rankEntries.filter(r => r.rank !== '2');
    const len = 5; // 顺子固定5张
    for (let start = 0; start <= singles.length - len; start++) {
        let valid = true;
        const indices = [];
        for (let i = 0; i < len; i++) {
            if (i > 0 && singles[start + i].value - singles[start + i - 1].value !== 1) {
                valid = false;
                break;
            }
            indices.push(singles[start + i].cards[0].index);
        }
        if (valid && singles[start + len - 1].value > targetRank) {
            results.push({ indices, type: HAND_TYPE.STRAIGHT, rank: singles[start + len - 1].value, length: len });
        }
    }
}

function addAllDoubleStraights(results, rankEntries) {
    const doubles = rankEntries.filter(r => r.count >= 2 && r.rank !== '2');
    const len = 3; // 连对固定3连对
    for (let start = 0; start <= doubles.length - len; start++) {
        let valid = true;
        const indices = [];
        for (let i = 0; i < len; i++) {
            if (i > 0 && doubles[start + i].value - doubles[start + i - 1].value !== 1) {
                valid = false;
                break;
            }
            indices.push(doubles[start + i].cards[0].index, doubles[start + i].cards[1].index);
        }
        if (valid) {
            results.push({ indices, type: HAND_TYPE.DOUBLE_STRAIGHT, rank: doubles[start + len - 1].value, length: len });
        }
    }
}

function addBiggerDoubleStraights(results, rankEntries, targetRank, targetLength) {
    const doubles = rankEntries.filter(r => r.count >= 2 && r.rank !== '2');
    const len = 3; // 连对固定3连对
    for (let start = 0; start <= doubles.length - len; start++) {
        let valid = true;
        const indices = [];
        for (let i = 0; i < len; i++) {
            if (i > 0 && doubles[start + i].value - doubles[start + i - 1].value !== 1) {
                valid = false;
                break;
            }
            indices.push(doubles[start + i].cards[0].index, doubles[start + i].cards[1].index);
        }
        if (valid && doubles[start + len - 1].value > targetRank) {
            results.push({ indices, type: HAND_TYPE.DOUBLE_STRAIGHT, rank: doubles[start + len - 1].value, length: len });
        }
    }
}

function addAllTripleStraights(results, rankEntries) {
    const triples = rankEntries.filter(r => r.count >= 3 && r.rank !== '2');
    const len = 2; // 钢板固定2连三张
    for (let start = 0; start <= triples.length - len; start++) {
        let valid = true;
        const indices = [];
        for (let i = 0; i < len; i++) {
            if (i > 0 && triples[start + i].value - triples[start + i - 1].value !== 1) {
                valid = false;
                break;
            }
            indices.push(triples[start + i].cards[0].index, triples[start + i].cards[1].index, triples[start + i].cards[2].index);
        }
        if (valid) {
            results.push({ indices, type: HAND_TYPE.TRIPLE_STRAIGHT, rank: triples[start + len - 1].value, length: len });
        }
    }
}

function addBiggerTripleStraights(results, rankEntries, targetRank, targetLength) {
    const triples = rankEntries.filter(r => r.count >= 3 && r.rank !== '2');
    const len = 2; // 钢板固定2连三张
    for (let start = 0; start <= triples.length - len; start++) {
        let valid = true;
        const indices = [];
        for (let i = 0; i < len; i++) {
            if (i > 0 && triples[start + i].value - triples[start + i - 1].value !== 1) {
                valid = false;
                break;
            }
            indices.push(triples[start + i].cards[0].index, triples[start + i].cards[1].index, triples[start + i].cards[2].index);
        }
        if (valid && triples[start + len - 1].value > targetRank) {
            results.push({ indices, type: HAND_TYPE.TRIPLE_STRAIGHT, rank: triples[start + len - 1].value, length: len });
        }
    }
}

function addAllTonghuashun(results, hand, trumpRank, lastInfo) {
    // 收集癞子（可充当任意花色任意点数）
    const wildCards = [];
    // 按花色分组(非王非2非癞子)
    const bySuit = {};
    hand.forEach((c, i) => {
        if (c.isJoker) return;
        if (isWildCard(c, trumpRank)) {
            wildCards.push({ card: c, index: i });
            return;
        }
        if (c.rank === '2') return;
        if (!bySuit[c.suit]) bySuit[c.suit] = [];
        bySuit[c.suit].push({ card: c, index: i, value: cardValue(c, trumpRank) });
    });

    const len = 5; // 同花顺固定5张
    const wildCount = wildCards.length;

    Object.entries(bySuit).forEach(([suit, suitCards]) => {
        // 去重(同花色同点数只保留一张)
        const unique = [];
        const seen = new Set();
        suitCards.sort((a, b) => a.value - b.value);
        suitCards.forEach(sc => {
            if (!seen.has(sc.value)) {
                seen.add(sc.value);
                unique.push(sc);
            }
        });

        // 构建 value -> card 映射
        const valueToCard = {};
        unique.forEach(sc => { valueToCard[sc.value] = sc; });

        // 尝试所有可能的5张连续范围 (3-7, 4-8, ..., 10-14)
        for (let startVal = 3; startVal <= 10; startVal++) {
            let gaps = 0;
            const indices = [];
            const usedWildIndices = [];
            let valid = true;
            let wildIdx = 0;

            for (let v = startVal; v < startVal + len; v++) {
                if (v > 14) { valid = false; break; }
                if (valueToCard[v]) {
                    indices.push(valueToCard[v].index);
                } else {
                    // 需要癞子填补
                    if (wildIdx < wildCount) {
                        indices.push(wildCards[wildIdx].index);
                        usedWildIndices.push(wildCards[wildIdx].index);
                        wildIdx++;
                        gaps++;
                    } else {
                        valid = false;
                        break;
                    }
                }
            }

            if (valid && indices.length === len) {
                const rank = startVal + len - 1;
                let shouldAdd = true;
                if (lastInfo) {
                    if (lastInfo.type === HAND_TYPE.BOMB_TONGHUA) {
                        shouldAdd = rank > lastInfo.rank;
                    } else {
                        const thIdx = BOMB_ORDER.indexOf(HAND_TYPE.BOMB_TONGHUA);
                        const lIdx = BOMB_ORDER.indexOf(lastInfo.type);
                        shouldAdd = thIdx > lIdx;
                    }
                }
                if (shouldAdd) {
                    results.push({ indices, type: HAND_TYPE.BOMB_TONGHUA, rank, length: len });
                }
            }
        }
    });
}

// --- AI策略 ---

// 分析手牌结构，决定最优出牌策略
function analyzeHandStructure(aiHand, trumpRank) {
    const groups = {};
    const jokers = [];
    aiHand.forEach((c, i) => {
        if (c.isJoker) {
            jokers.push({ card: c, index: i });
        } else {
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push({ card: c, index: i });
        }
    });

    const rankEntries = Object.entries(groups).map(([rank, arr]) => ({
        rank,
        cards: arr,
        value: cardValue(arr[0].card, trumpRank),
        compareValue: cardCompareValue(arr[0].card, trumpRank),
        count: arr.length
    }));
    rankEntries.sort((a, b) => a.value - b.value);

    return { groups, jokers, rankEntries };
}

// 计算一手牌的"出牌效率分"——张数越多越好，rank越小越好
function playScore(play, aiHandLength) {
    // 能一把出完的优先级最高
    if (play.indices.length === aiHandLength) return 10000;
    
    // 组合牌型的基础分 = 出牌张数 * 100
    let score = play.indices.length * 100;
    
    // 减去rank值，小牌优先出
    score -= play.rank;
    
    return score;
}

function aiDecide(aiHand, lastPlayedInfo, trumpRank) {
    const playable = findPlayableHands(aiHand, lastPlayedInfo, trumpRank);

    if (playable.length === 0) return null; // 不出

    // --- 拖牌辅助：计算每个出牌选项中包含多少拖牌 ---
    function dragInfoForPlay(play) {
        const playCards = play.indices.map(i => aiHand[i]);
        let dragCount = 0;
        let heartDragCount = 0;
        let allDrag = playCards.length > 0;
        playCards.forEach(c => {
            if (isDragCard(c, trumpRank)) {
                dragCount++;
                if (c.suit === '♥') heartDragCount++;
            } else {
                allDrag = false;
            }
        });
        return { dragCount, heartDragCount, allDrag };
    }

    // 计算出完这手后剩余手牌中还有多少拖
    function remainingDrags(play) {
        const usedIndices = new Set(play.indices);
        let count = 0;
        aiHand.forEach((c, i) => {
            if (!usedIndices.has(i) && isDragCard(c, trumpRank)) count++;
        });
        return count;
    }

    if (!lastPlayedInfo) {
        // ======== 自由出牌策略 ========
        const nonBombs = playable.filter(p => BOMB_ORDER.indexOf(p.type) < 0);
        
        if (nonBombs.length > 0) {
            // --- 终局阶段：手牌很少时 ---
            if (aiHand.length <= 8) {
                // 尝试一把出完
                const fullPlay = nonBombs.find(p => p.indices.length === aiHand.length);
                if (fullPlay) return fullPlay;
                
                // ★ 拖策略：如果能用纯拖收尾（剩余牌全是拖），优先安排
                // 寻找一个出牌选项，出完后剩余牌全是拖
                const dragFinish = nonBombs.find(p => {
                    const usedIndices = new Set(p.indices);
                    const remaining = aiHand.filter((c, i) => !usedIndices.has(i));
                    return remaining.length > 0 && remaining.every(c => isDragCard(c, trumpRank));
                });
                if (dragFinish) return dragFinish;
                
                // 出张数最多的组合（更快走完），拖牌优先出
                const sorted = [...nonBombs].sort((a, b) => {
                    const diff = b.indices.length - a.indices.length;
                    if (diff !== 0) return diff;
                    // 同张数：含拖的优先
                    const aDrag = dragInfoForPlay(a).dragCount;
                    const bDrag = dragInfoForPlay(b).dragCount;
                    if (bDrag !== aDrag) return bDrag - aDrag;
                    return a.rank - b.rank; // 同张数出小的
                });
                return sorted[0];
            }
            
            // --- 正常阶段：智能选择出牌 ---
            const typeWeight = {
                [HAND_TYPE.STRAIGHT]: 6,
                [HAND_TYPE.DOUBLE_STRAIGHT]: 6,
                [HAND_TYPE.TRIPLE_STRAIGHT]: 6,
                [HAND_TYPE.TRIPLE_PLUS_TWO]: 5,
                [HAND_TYPE.PAIR]: 3,
                [HAND_TYPE.TRIPLE]: 2,
                [HAND_TYPE.SINGLE]: 1,
            };
            
            // 按策略打分排序
            const scored = nonBombs.map(p => {
                const weight = typeWeight[p.type] || 1;
                let s = weight * 1000 - p.rank;
                
                if (p.type === HAND_TYPE.TRIPLE_PLUS_TWO) s += 200;
                if (p.rank >= 14) s -= 500;
                
                // ★ 拖策略：包含拖牌的出牌选项加分（尽早甩掉拖牌）
                const dInfo = dragInfoForPlay(p);
                if (dInfo.dragCount > 0) {
                    s += dInfo.dragCount * 300; // 每张拖加300分
                    s += dInfo.heartDragCount * 200; // 红桃拖更要尽早出
                }
                
                return { play: p, score: s };
            });
            
            scored.sort((a, b) => b.score - a.score);
            
            const best = scored[0];
            if (best.play.type === HAND_TYPE.SINGLE && scored.length > 1) {
                const combo = scored.find(s => s.play.type !== HAND_TYPE.SINGLE);
                if (combo && combo.play.rank <= 12) {
                    return combo.play;
                }
            }
            
            return best.play;
        }
        
        // 只有炸弹——出最小的炸弹
        playable.sort((a, b) => {
            const ai = BOMB_ORDER.indexOf(a.type);
            const bi = BOMB_ORDER.indexOf(b.type);
            if (ai !== bi) return ai - bi;
            return a.rank - b.rank;
        });
        return playable[0];
    }

    // ======== 跟牌/压牌策略 ========
    const nonBombs = playable.filter(p => BOMB_ORDER.indexOf(p.type) < 0);
    const bombs = playable.filter(p => BOMB_ORDER.indexOf(p.type) >= 0);
    
    if (nonBombs.length > 0) {
        // ★ 拖策略：优先出包含拖牌的选项（尽早甩拖）
        const withDrag = nonBombs.filter(p => dragInfoForPlay(p).dragCount > 0);
        if (withDrag.length > 0) {
            withDrag.sort((a, b) => a.rank - b.rank);
            return withDrag[0];
        }
        // 出最小的能压住的同类型牌
        nonBombs.sort((a, b) => a.rank - b.rank);
        return nonBombs[0];
    }

    // 没有同类型更大的牌了，考虑使用炸弹
    if (bombs.length > 0) {
        // 手牌少时一定用炸弹（快速结束）
        // 手牌多时也要用炸弹，但优先用小炸弹
        // 只有手牌很多且对面出的是小牌时才可能放弃
        const shouldBomb = aiHand.length <= 10 || // 手牌≤10张，果断炸
            lastPlayedInfo.rank >= 12 ||           // 对面出大牌(Q以上)，炸！
            bombs.length >= 2 ||                   // 有多个炸弹，大胆用
            Math.random() < 0.7;                   // 70%概率炸
        
        if (shouldBomb) {
            // 用最小的炸弹
            bombs.sort((a, b) => {
                const ai = BOMB_ORDER.indexOf(a.type);
                const bi = BOMB_ORDER.indexOf(b.type);
                if (ai !== bi) return ai - bi;
                return a.rank - b.rank;
            });
            return bombs[0];
        }
    }

    return null; // 选择不出
}

// --- UI渲染 ---

function renderPlayerHand() {
    const container = document.getElementById('player-hand');
    const groupsContainer = document.getElementById('player-groups');
    container.innerHTML = '';
    groupsContainer.innerHTML = '';

    // 收集已归组牌的id集合
    const groupedCardIds = new Set();
    state.cardGroups.forEach(g => {
        g.cards.forEach(c => groupedCardIds.add(c.id));
    });

    // 渲染分组
    if (state.cardGroups.length > 0) {
        state.cardGroups.forEach((group, gIdx) => {
            const groupEl = document.createElement('div');
            groupEl.className = 'card-group';
            // 如果该分组被选中，添加高亮样式
            if (state.selectedGroupIndex === gIdx) {
                groupEl.classList.add('group-selected');
            }

            // 标签
            const label = document.createElement('div');
            label.className = 'group-label';
            label.textContent = group.label;
            groupEl.appendChild(label);

            // 卡牌容器
            const cardsEl = document.createElement('div');
            cardsEl.className = 'group-cards';

            group.cards.forEach(card => {
                const el = createCardElement(card, true);
                // 点击归组中的牌: 选中它用于出牌
                el.addEventListener('click', () => {
                    if (!state.gameActive || state.currentTurn !== 'player') return;
                    // 选中整组
                    selectGroupCards(gIdx);
                });
                cardsEl.appendChild(el);
            });

            groupEl.appendChild(cardsEl);

            // 删除按钮(将牌退回手牌)
            const removeBtn = document.createElement('button');
            removeBtn.className = 'group-remove-btn';
            removeBtn.textContent = '✕';
            removeBtn.title = '取消此组';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeGroup(gIdx);
            });
            groupEl.appendChild(removeBtn);

            groupsContainer.appendChild(groupEl);
        });

        // 分隔线
        const divider = document.createElement('div');
        divider.className = 'groups-divider';
        groupsContainer.appendChild(divider);
    }

    // 渲染散牌(未归组的牌)
    state.playerHand.forEach((card, index) => {
        if (groupedCardIds.has(card.id)) return; // 已归组的不在散牌区显示
        const el = createCardElement(card, true);
        if (state.selectedIndices.has(index)) {
            el.classList.add('selected');
        }
        el.dataset.cardIndex = index; // 用于拖选识别
        // 单击选牌（仅在非拖选时触发）
        el.addEventListener('click', (e) => {
            if (state._dragDidMove) return; // 拖选过程中不触发click
            toggleCardSelection(index);
        });
        // 拖选：mousedown开始
        el.addEventListener('mousedown', (e) => {
            if (!state.gameActive || state.currentTurn !== 'player') return;
            e.preventDefault();
            startDragSelect(index);
        });
        // 拖选：鼠标经过时自动选中
        el.addEventListener('mouseenter', () => {
            if (!state._isDragging) return;
            dragOverCard(index);
        });
        // 移动端触摸拖选
        el.addEventListener('touchstart', (e) => {
            if (!state.gameActive || state.currentTurn !== 'player') return;
            e.preventDefault();
            startDragSelect(index);
        }, { passive: false });
        el.addEventListener('touchmove', (e) => {
            if (!state._isDragging) return;
            e.preventDefault();
            const touch = e.touches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            if (target) {
                const cardEl = target.closest('.card[data-card-index]');
                if (cardEl) {
                    const touchIndex = parseInt(cardEl.dataset.cardIndex);
                    if (!isNaN(touchIndex)) dragOverCard(touchIndex);
                }
            }
        }, { passive: false });
        el.addEventListener('touchend', (e) => {
            if (state._isDragging && !state._dragDidMove) {
                // 触摸点击 - 切换选中
                endDragSelect();
                toggleCardSelection(index);
                return;
            }
            endDragSelect();
        });
        container.appendChild(el);
    });

    document.getElementById('player-card-count').textContent = state.playerHand.length;
}

function renderAiHand() {
    const container = document.getElementById('ai-hand');
    container.innerHTML = '';
    state.aiHand.forEach(() => {
        const el = document.createElement('div');
        el.className = 'card';
        container.appendChild(el);
    });
    document.getElementById('ai-card-count').textContent = state.aiHand.length;
}

// 可爱花色符号映射
const CUTE_SUITS = {
    '♠': '♠',
    '♥': '♥',
    '♣': '♣',
    '♦': '♦'
};

function createCardElement(card, isPlayerCard = false) {
    const el = document.createElement('div');
    el.className = 'card';

    if (card.isJoker) {
        el.classList.add(card.jokerType === 'big' ? 'joker-red' : 'joker-black');
        // Q版可爱大小王
        if (card.jokerType === 'big') {
            el.innerHTML = `
                <div class="card-rank-top">大</div>
                <div class="card-suit-top">王</div>
                <div class="card-center">👑</div>
            `;
        } else {
            el.innerHTML = `
                <div class="card-rank-top">小</div>
                <div class="card-suit-top">王</div>
                <div class="card-center">🤡</div>
            `;
        }
    } else {
        el.classList.add(isRed(card) ? 'red' : 'black');
        const isWild = isWildCard(card, state.trumpRank);
        const isDrag = isDragCard(card, state.trumpRank);
        const suitDisplay = CUTE_SUITS[card.suit] || card.suit;
        el.innerHTML = `
            <div class="card-rank-top">${card.rank}</div>
            <div class="card-suit-top">${suitDisplay}</div>
            <div class="card-center">${suitDisplay}</div>
            ${isWild ? '<div class="wild-badge">癞</div>' : ''}
            ${isDrag ? '<div class="drag-badge">拖</div>' : ''}
        `;
        if (isWild) {
            el.classList.add('wild-card');
        }
    }

    return el;
}

function renderPlayedCards(containerId, cards) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (!cards) return;

    if (cards === 'pass') {
        const marker = document.createElement('div');
        marker.className = 'pass-marker';
        marker.textContent = '不 出';
        container.appendChild(marker);
        return;
    }

    cards.forEach(card => {
        container.appendChild(createCardElement(card));
    });
}

function showMessage(msg) {
    document.getElementById('game-message').textContent = msg;
}

function updateLevelDisplay() {
    const rankStr = getLevelRank(state.playerLevel);
    const aiRankStr = getLevelRank(state.aiLevel);
    document.getElementById('player-level').textContent = state.playerLevel;
    document.getElementById('ai-level').textContent = state.aiLevel;
    document.getElementById('trump-rank').textContent = rankStr;
    document.getElementById('wild-card-display').textContent = '♥' + rankStr;
    document.getElementById('drag-card-display').textContent = getDragRank(rankStr);
    document.getElementById('start-player-level').textContent = state.playerLevel;
    document.getElementById('start-ai-level').textContent = state.aiLevel;
    document.getElementById('round-num').textContent = state.round;
    state.trumpRank = rankStr;
    state.aiTrumpRank = aiRankStr;
}

// --- 拖选功能 ---
// 拖选状态存储在state对象上
state._isDragging = false;
state._dragStartIndex = -1;
state._dragDidMove = false;
state._dragSelectedRange = new Set(); // 拖选过程中经过的索引
state._preDragSelection = new Set(); // 拖选开始前已选中的牌

function startDragSelect(index) {
    state._isDragging = true;
    state._dragStartIndex = index;
    state._dragDidMove = false;
    // 保存拖选开始前的选中状态
    state._preDragSelection = new Set(state.selectedIndices);
    state._dragSelectedRange = new Set([index]);
    // 手动选牌时清除分组选中状态
    state.selectedGroupIndex = -1;
}

function dragOverCard(index) {
    if (!state._isDragging) return;
    if (state._dragSelectedRange.has(index)) return;
    
    state._dragDidMove = true;
    state._dragSelectedRange.add(index);
    
    // 计算从起始到当前的范围内所有未归组的牌
    const groupedCardIds = new Set();
    state.cardGroups.forEach(g => g.cards.forEach(c => groupedCardIds.add(c.id)));
    
    // 找出散牌区的index顺序
    const scatterIndices = [];
    state.playerHand.forEach((card, i) => {
        if (!groupedCardIds.has(card.id)) {
            scatterIndices.push(i);
        }
    });
    
    const startPos = scatterIndices.indexOf(state._dragStartIndex);
    const currentPos = scatterIndices.indexOf(index);
    if (startPos < 0 || currentPos < 0) return;
    
    const from = Math.min(startPos, currentPos);
    const to = Math.max(startPos, currentPos);
    
    // 选中范围内的所有牌
    const newSelection = new Set(state._preDragSelection);
    for (let i = from; i <= to; i++) {
        newSelection.add(scatterIndices[i]);
    }
    
    state.selectedIndices = newSelection;
    renderPlayerHand();
}

function endDragSelect() {
    if (!state._isDragging) return;
    
    const didMove = state._dragDidMove;
    state._isDragging = false;
    state._dragStartIndex = -1;
    state._dragSelectedRange = new Set();
    state._preDragSelection = new Set();
    
    if (didMove) {
        // 拖选结束后确保显示正确
        state._dragDidMove = false;
        renderPlayerHand();
    } else {
        state._dragDidMove = false;
    }
}

// 全局mouseup监听（结束拖选）
document.addEventListener('mouseup', () => {
    endDragSelect();
});

// 全局touchend监听（结束触摸拖选）
document.addEventListener('touchend', () => {
    endDragSelect();
});

// 防止双击缩放（移动端）
document.addEventListener('dblclick', (e) => {
    e.preventDefault();
}, { passive: false });

function toggleCardSelection(index) {
    if (!state.gameActive || state.currentTurn !== 'player') return;
    // 手动选牌时清除分组选中状态
    state.selectedGroupIndex = -1;
    if (state.selectedIndices.has(index)) {
        state.selectedIndices.delete(index);
    } else {
        state.selectedIndices.add(index);
    }
    renderPlayerHand();
}

// --- 游戏流程 ---

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

function startRound() {
    // 先更新级牌信息，确保排序使用正确的trumpRank
    updateLevelDisplay();

    const { player, ai } = deal();
    state.playerHand = sortHand(player, state.trumpRank);
    state.aiHand = sortHand(ai, state.aiTrumpRank);
    state.lastPlayed = null;
    state.lastPlayedBy = null;
    state.selectedIndices = new Set();
    state.gameActive = true;
    state.hintIndex = 0;
    state.hintOptions = [];
    state.cardGroups = [];
    state.selectedGroupIndex = -1;
    state.playerLastPlayedCards = [];
    state.aiLastPlayedCards = [];

    // 决定谁先出
    if (state.lastRoundWinner) {
        state.currentTurn = state.lastRoundWinner;
        state.firstPlayer = state.lastRoundWinner;
    } else {
        state.currentTurn = Math.random() < 0.5 ? 'player' : 'ai';
        state.firstPlayer = state.currentTurn;
    }
    showScreen('game-screen');
    renderPlayerHand();
    renderAiHand();
    renderPlayedCards('player-played', null);
    renderPlayedCards('ai-played', null);

    updateButtons();

    if (state.currentTurn === 'player') {
        showMessage('你先出牌！');
    } else {
        showMessage('电脑先出牌...');
        setTimeout(() => aiTurn(), 800);
    }
}

function updateButtons() {
    const isPlayerTurn = state.currentTurn === 'player' && state.gameActive;
    document.getElementById('btn-play').disabled = !isPlayerTurn;
    document.getElementById('btn-hint').disabled = !isPlayerTurn;
    // 不出按钮：必须有上家出牌且不是自己上次出的
    const canPass = isPlayerTurn && state.lastPlayed && state.lastPlayedBy !== 'player';
    document.getElementById('btn-pass').disabled = !canPass;
}

function playerPlay() {
    if (state.currentTurn !== 'player' || !state.gameActive) return;

    const indices = Array.from(state.selectedIndices).sort((a, b) => a - b);
    if (indices.length === 0) {
        showMessage('请先选择要出的牌！');
        return;
    }

    const cards = indices.map(i => state.playerHand[i]);
    const handInfo = identifyHand(cards, state.trumpRank);

    if (handInfo.type === HAND_TYPE.INVALID) {
        showMessage('无效的牌型！');
        return;
    }

    // 检查是否能压过上家
    const lastInfo = (state.lastPlayed && state.lastPlayedBy !== 'player') ? state.lastPlayed : null;
    if (lastInfo && !canBeat(handInfo, lastInfo)) {
        showMessage('出的牌不够大！');
        return;
    }

    // 出牌成功
    state.lastPlayed = handInfo;
    state.lastPlayed.cards = cards;
    state.lastPlayedBy = 'player';
    state.playerLastPlayedCards = [...cards]; // 记录最后一手出的牌

    // 从手牌中移除
    const removedIds = new Set(cards.map(c => c.id));
    const newHand = state.playerHand.filter((_, i) => !state.selectedIndices.has(i));
    state.playerHand = newHand;
    state.selectedIndices = new Set();
    state.selectedGroupIndex = -1;
    state.hintIndex = 0;
    state.hintOptions = [];

    // 同步清理分组中被打出的牌
    syncGroupsAfterPlay(removedIds);

    renderPlayerHand();
    renderPlayedCards('player-played', cards);
    renderPlayedCards('ai-played', null);

    // 检查胜利
    if (state.playerHand.length === 0) {
        endRound('player');
        return;
    }

    showMessage('电脑思考中...');
    state.currentTurn = 'ai';
    updateButtons();
    setTimeout(() => aiTurn(), 800);
}

function playerPass() {
    if (state.currentTurn !== 'player' || !state.gameActive) return;
    if (!state.lastPlayed || state.lastPlayedBy === 'player') return;

    state.selectedIndices = new Set();
    state.selectedGroupIndex = -1;
    state.hintIndex = 0;
    state.hintOptions = [];
    renderPlayerHand();
    renderPlayedCards('player-played', 'pass');

    // 玩家不出，如果上家是AI出的，则AI获得自由出牌权
    if (state.lastPlayedBy === 'ai') {
        state.lastPlayed = null;
        state.lastPlayedBy = null;
    }

    showMessage('电脑出牌...');
    state.currentTurn = 'ai';
    updateButtons();
    setTimeout(() => aiTurn(), 800);
}

function aiTurn() {
    if (!state.gameActive) return;

    const lastInfo = (state.lastPlayed && state.lastPlayedBy !== 'ai') ? state.lastPlayed : null;
    const decision = aiDecide(state.aiHand, lastInfo, state.aiTrumpRank);

    if (!decision) {
        // AI不出
        renderPlayedCards('ai-played', 'pass');
        renderPlayedCards('player-played', null);
        showMessage('电脑不出，轮到你了！');
        // 如果上家是玩家出的且AI不出，则玩家自由出
        if (state.lastPlayedBy === 'player') {
            state.lastPlayed = null;
            state.lastPlayedBy = null;
        }
        state.currentTurn = 'player';
        updateButtons();
        return;
    }

    // AI出牌
    const cards = decision.indices.map(i => state.aiHand[i]);
    const handInfo = identifyHand(cards, state.aiTrumpRank);
    handInfo.cards = cards;

    state.lastPlayed = handInfo;
    state.lastPlayedBy = 'ai';
    state.aiLastPlayedCards = [...cards]; // 记录AI最后一手出的牌

    // 移除AI手牌
    const indicesToRemove = new Set(decision.indices);
    state.aiHand = state.aiHand.filter((_, i) => !indicesToRemove.has(i));

    renderAiHand();
    renderPlayedCards('ai-played', cards);
    renderPlayedCards('player-played', null);

    // 检查AI胜利
    if (state.aiHand.length === 0) {
        endRound('ai');
        return;
    }

    const typeName = getHandTypeName(handInfo.type);
    showMessage(`电脑出了 ${typeName}，轮到你！`);
    state.currentTurn = 'player';
    updateButtons();
}

function getHandTypeName(type) {
    const names = {
        [HAND_TYPE.SINGLE]: '单张',
        [HAND_TYPE.PAIR]: '对子',
        [HAND_TYPE.TRIPLE]: '三张',
        [HAND_TYPE.TRIPLE_PLUS_TWO]: '三带二',
        [HAND_TYPE.STRAIGHT]: '顺子',
        [HAND_TYPE.DOUBLE_STRAIGHT]: '连对',
        [HAND_TYPE.TRIPLE_STRAIGHT]: '钢板',
        [HAND_TYPE.BOMB_4]: '炸弹',
        [HAND_TYPE.BOMB_5]: '5张炸弹',
        [HAND_TYPE.BOMB_6]: '6张炸弹',
        [HAND_TYPE.BOMB_7]: '7张炸弹',
        [HAND_TYPE.BOMB_8]: '8张炸弹',
        [HAND_TYPE.ROCKET]: '天王炸',
        [HAND_TYPE.BOMB_TONGHUA]: '同花顺',
    };
    return names[type] || '未知';
}

function endRound(winner) {
    state.gameActive = false;
    state.lastRoundWinner = winner;

    // 赢家使用的trumpRank（用于判定拖）
    const winnerTrumpRank = winner === 'player' ? state.trumpRank : state.aiTrumpRank;
    const loserTrumpRank = winner === 'player' ? state.aiTrumpRank : state.trumpRank;
    const dragRank = getDragRank(winnerTrumpRank);
    const dragRankDisplay = dragRank;

    const loserHand = winner === 'player' ? state.aiHand : state.playerHand;
    const loserRemaining = loserHand.length;
    const baseLevelUp = Math.ceil(loserRemaining / 5);

    // --- 拖牌额外升级计算 ---
    let winnerDragBonus = 0; // 赢家末手拖牌带来的额外升级
    let loserDragBonus = 0;  // 输家手中拖牌带来的额外升级
    let winnerDragDetail = '';
    let loserDragDetail = '';

    // 1. 赢家最后一手牌是否纯拖
    const winnerLastCards = winner === 'player' ? state.playerLastPlayedCards : state.aiLastPlayedCards;
    if (winnerLastCards.length > 0 && isAllDragCards(winnerLastCards, winnerTrumpRank)) {
        const { dragCount, heartDragCount } = countDragCards(winnerLastCards, winnerTrumpRank);
        winnerDragBonus = dragCount + heartDragCount; // 每张拖+1级，红桃拖再+1级
        const parts = [];
        parts.push(`${dragCount}张拖(+${dragCount}级)`);
        if (heartDragCount > 0) {
            parts.push(`其中${heartDragCount}张♥拖(再+${heartDragCount}级)`);
        }
        winnerDragDetail = `🏃 ${winner === 'player' ? '你' : '电脑'}最后一手全是拖(${dragRankDisplay})！${parts.join('，')}`;
    }

    // 2. 输家手中的拖牌
    if (loserHand.length > 0) {
        const { dragCount, heartDragCount } = countDragCards(loserHand, loserTrumpRank);
        if (dragCount > 0) {
            loserDragBonus = dragCount + heartDragCount; // 每张拖+1级，红桃拖再+1级
            const parts = [];
            parts.push(`${dragCount}张拖(+${dragCount}级)`);
            if (heartDragCount > 0) {
                parts.push(`其中${heartDragCount}张♥拖(再+${heartDragCount}级)`);
            }
            loserDragDetail = `😱 ${winner === 'player' ? '电脑' : '你'}手中憋了${parts.join('，')}`;
        }
    }

    const totalLevelUp = baseLevelUp + winnerDragBonus + loserDragBonus;

    if (winner === 'player') {
        state.playerLevel = Math.min(14, state.playerLevel + totalLevelUp);
    } else {
        state.aiLevel = Math.min(14, state.aiLevel + totalLevelUp);
    }

    state.round++;

    // 显示结算
    const titleEl = document.getElementById('result-title');
    const detailsEl = document.getElementById('result-details');

    if (winner === 'player') {
        titleEl.textContent = '🎉 你赢了！';
        titleEl.className = 'result-title win';
    } else {
        titleEl.textContent = '😔 你输了';
        titleEl.className = 'result-title lose';
    }

    let detailsHTML = `
        <p>输家剩余 ${loserRemaining} 张牌 → 基础升 ${baseLevelUp} 级</p>
    `;

    if (winnerDragDetail) {
        detailsHTML += `<p style="color:#ff6b6b;">${winnerDragDetail}</p>`;
    }
    if (loserDragDetail) {
        detailsHTML += `<p style="color:#ff6b6b;">${loserDragDetail}</p>`;
    }

    if (winnerDragBonus > 0 || loserDragBonus > 0) {
        detailsHTML += `<p style="font-weight:bold;color:#ffd700;">📈 总计：${winner === 'player' ? '你' : '电脑'}升 ${totalLevelUp} 级 (基础${baseLevelUp} + 拖奖励${winnerDragBonus + loserDragBonus})</p>`;
    } else {
        detailsHTML += `<p>${winner === 'player' ? '你' : '电脑'}升 ${totalLevelUp} 级</p>`;
    }

    detailsEl.innerHTML = detailsHTML;

    document.getElementById('result-player-level').textContent = state.playerLevel;
    document.getElementById('result-ai-level').textContent = state.aiLevel;

    // 检查是否有人通关(到A)
    if (state.playerLevel >= 14 || state.aiLevel >= 14) {
        const gameWinner = state.playerLevel >= 14 ? '你' : '电脑';
        detailsEl.innerHTML += `<p style="color:#ffd700;font-size:24px;margin-top:12px;">🏆 ${gameWinner}打到A,游戏通关！</p>`;
        document.getElementById('btn-next-round').textContent = '重新开始';
    } else {
        document.getElementById('btn-next-round').textContent = '下一回合';
    }

    showScreen('result-screen');
}

// 提示功能
function showHint() {
    if (state.currentTurn !== 'player' || !state.gameActive) return;

    const lastInfo = (state.lastPlayed && state.lastPlayedBy !== 'player') ? state.lastPlayed : null;

    if (state.hintOptions.length === 0) {
        state.hintOptions = findPlayableHands(state.playerHand, lastInfo, state.trumpRank);
        // 去重(按indices排序后比较)
        const seen = new Set();
        state.hintOptions = state.hintOptions.filter(opt => {
            const key = opt.indices.sort((a, b) => a - b).join(',');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        // 按牌型小到大排
        state.hintOptions.sort((a, b) => {
            if (a.type !== b.type) {
                const order = [HAND_TYPE.SINGLE, HAND_TYPE.PAIR, HAND_TYPE.TRIPLE, HAND_TYPE.TRIPLE_PLUS_TWO, HAND_TYPE.STRAIGHT, HAND_TYPE.DOUBLE_STRAIGHT, HAND_TYPE.TRIPLE_STRAIGHT, HAND_TYPE.BOMB_4, HAND_TYPE.BOMB_5, HAND_TYPE.BOMB_TONGHUA, HAND_TYPE.BOMB_6, HAND_TYPE.BOMB_7, HAND_TYPE.BOMB_8, HAND_TYPE.ROCKET];
                return order.indexOf(a.type) - order.indexOf(b.type);
            }
            return a.rank - b.rank;
        });
        state.hintIndex = 0;
    }

    if (state.hintOptions.length === 0) {
        showMessage('没有能出的牌，请选择不出');
        return;
    }

    const hint = state.hintOptions[state.hintIndex];
    state.selectedIndices = new Set(hint.indices);
    state.selectedGroupIndex = -1;
    renderPlayerHand();

    const typeName = getHandTypeName(hint.type);
    showMessage(`提示 ${state.hintIndex + 1}/${state.hintOptions.length}: ${typeName}`);

    state.hintIndex = (state.hintIndex + 1) % state.hintOptions.length;
}

// ========== 理牌功能 ==========

// 手动归组: 将选中的牌设为一个组
function manualGroup() {
    if (!state.gameActive) return;
    const indices = Array.from(state.selectedIndices).sort((a, b) => a - b);
    if (indices.length === 0) {
        showMessage('请先选择要归组的牌！');
        return;
    }

    const cards = indices.map(i => state.playerHand[i]);
    const handInfo = identifyHand(cards, state.trumpRank);

    if (handInfo.type === HAND_TYPE.INVALID) {
        showMessage('所选牌不构成有效牌型，无法归组！');
        return;
    }

    // 检查这些牌是否已经在某个组中
    const groupedCardIds = new Set();
    state.cardGroups.forEach(g => g.cards.forEach(c => groupedCardIds.add(c.id)));
    const alreadyGrouped = cards.some(c => groupedCardIds.has(c.id));
    if (alreadyGrouped) {
        showMessage('所选牌中有已归组的牌，请先取消该组！');
        return;
    }

    const label = getHandTypeName(handInfo.type);
    state.cardGroups.push({ cards: [...cards], type: handInfo.type, label });

    state.selectedIndices = new Set();
    state.hintIndex = 0;
    state.hintOptions = [];
    renderPlayerHand();
    showMessage(`已归组: ${label}`);
}

// 点击一个组 -> 选中该组所有牌(用于快速出牌), 再次点击取消选中
function selectGroupCards(groupIndex) {
    const group = state.cardGroups[groupIndex];
    if (!group) return;

    // 如果点击的是已选中的组，取消选中
    if (state.selectedGroupIndex === groupIndex) {
        state.selectedGroupIndex = -1;
        state.selectedIndices = new Set();
        state.hintIndex = 0;
        state.hintOptions = [];
        renderPlayerHand();
        showMessage('已取消选中');
        return;
    }

    // 找到这些牌在playerHand中的index
    const newSelected = new Set();
    group.cards.forEach(gc => {
        const idx = state.playerHand.findIndex(c => c.id === gc.id);
        if (idx >= 0) newSelected.add(idx);
    });

    state.selectedGroupIndex = groupIndex;
    state.selectedIndices = newSelected;
    state.hintIndex = 0;
    state.hintOptions = [];
    renderPlayerHand();

    const typeName = getHandTypeName(group.type);
    showMessage(`已选中组: ${typeName}（${group.cards.length}张）- 点击"出牌"打出`);
}

// 删除一个组(牌退回散牌区)
function removeGroup(groupIndex) {
    state.cardGroups.splice(groupIndex, 1);
    state.selectedIndices = new Set();
    renderPlayerHand();
}

// 清除所有分组
function clearAllGroups() {
    state.cardGroups = [];
    state.selectedGroupIndex = -1;
    state.selectedIndices = new Set();
    renderPlayerHand();
    showMessage('已清除所有分组');
}

// 出牌后同步清理分组
function syncGroupsAfterPlay(removedIds) {
    state.cardGroups = state.cardGroups.map(g => ({
        ...g,
        cards: g.cards.filter(c => !removedIds.has(c.id))
    })).filter(g => g.cards.length > 0);
}

// ========== 自动理牌AI ==========

function autoGroupCards() {
    if (!state.gameActive) return;

    // 收集所有手牌(复制一份用于分析)
    let remaining = state.playerHand.map((c, i) => ({ ...c, _origIdx: i }));
    const groups = [];
    const trumpRank = state.trumpRank;

    // 辅助: 按rank分组(不含王和癞子)
    function groupByRankLocal() {
        const g = {};
        remaining.forEach(c => {
            if (c.isJoker || isWildCard(c, trumpRank)) return;
            if (!g[c.rank]) g[c.rank] = [];
            g[c.rank].push(c);
        });
        return g;
    }

    // 辅助: 从remaining中移除指定牌
    function removeCards(cards) {
        const ids = new Set(cards.map(c => c.id));
        remaining = remaining.filter(c => !ids.has(c.id));
    }

    // 获取当前remaining中的癞子
    function getWilds() {
        return remaining.filter(c => isWildCard(c, trumpRank));
    }

    // 获取当前remaining中的王
    function getJokers() {
        return remaining.filter(c => c.isJoker);
    }

    // 第0步: 提取天王炸(4个王)
    const jokers = getJokers();
    if (jokers.length === 4) {
        groups.push({ cards: [...jokers], type: HAND_TYPE.ROCKET, label: '天王炸' });
        removeCards(jokers);
    }

    // 第1步: 提取纯炸弹(≥4张同点数, 不用癞子)
    let rg = groupByRankLocal();
    Object.entries(rg).forEach(([rank, arr]) => {
        if (arr.length >= 4) {
            const bombTypes = { 4: HAND_TYPE.BOMB_4, 5: HAND_TYPE.BOMB_5, 6: HAND_TYPE.BOMB_6, 7: HAND_TYPE.BOMB_7, 8: HAND_TYPE.BOMB_8 };
            const bt = bombTypes[Math.min(arr.length, 8)] || HAND_TYPE.BOMB_8;
            groups.push({ cards: [...arr], type: bt, label: getHandTypeName(bt) });
            removeCards(arr);
        }
    });

    // 第2步: 提取同花顺(固定5张, 含癞子填补)
    function findFlushStraight() {
        const bySuit = {};
        remaining.filter(c => !c.isJoker && !isWildCard(c, trumpRank) && c.rank !== '2').forEach(c => {
            if (!bySuit[c.suit]) bySuit[c.suit] = [];
            bySuit[c.suit].push(c);
        });

        const len = 5; // 同花顺固定5张
        let bestResult = null;
        Object.entries(bySuit).forEach(([suit, suitCards]) => {
            suitCards.sort((a, b) => cardValue(a, trumpRank) - cardValue(b, trumpRank));
            // 去重
            const unique = [];
            const seenVals = new Set();
            suitCards.forEach(c => {
                const v = cardValue(c, trumpRank);
                if (!seenVals.has(v)) {
                    seenVals.add(v);
                    unique.push(c);
                }
            });

            const availableWilds = getWilds();
            for (let startVal = 3; startVal <= 14 - len + 1; startVal++) {
                const endVal = startVal + len - 1;
                const usedCards = [];
                let wildsNeeded = 0;

                for (let v = startVal; v <= endVal; v++) {
                    const card = unique.find(c => cardValue(c, trumpRank) === v);
                    if (card) {
                        usedCards.push(card);
                    } else {
                        wildsNeeded++;
                    }
                }

                if (wildsNeeded <= availableWilds.length && usedCards.length + wildsNeeded === len) {
                    const wildCards = availableWilds.slice(0, wildsNeeded);
                    const allCards = [...usedCards, ...wildCards];
                    const score = endVal; // 固定长度，只比最高点数
                    if (!bestResult || score > bestResult.score) {
                        bestResult = { cards: allCards, score };
                    }
                }
            }
        });

        return bestResult;
    }

    let flushResult = findFlushStraight();
    while (flushResult) {
        groups.push({ cards: flushResult.cards, type: HAND_TYPE.BOMB_TONGHUA, label: '同花顺' });
        removeCards(flushResult.cards);
        flushResult = findFlushStraight();
    }

    // 第3步: 用癞子补炸弹(3张同点数+1癞子=4炸)
    function findWildBomb() {
        const wilds = getWilds();
        if (wilds.length === 0) return null;

        rg = groupByRankLocal();
        const candidates = Object.entries(rg)
            .filter(([rank, arr]) => arr.length === 3)
            .map(([rank, arr]) => ({ rank, cards: arr, value: cardValue(arr[0], trumpRank) }))
            .sort((a, b) => b.value - a.value);

        if (candidates.length > 0 && wilds.length >= 1) {
            const best = candidates[0];
            const bombCards = [...best.cards, wilds[0]];
            return { cards: bombCards, type: HAND_TYPE.BOMB_4, label: '炸弹(含癞)' };
        }
        return null;
    }

    let wildBomb = findWildBomb();
    while (wildBomb) {
        groups.push(wildBomb);
        removeCards(wildBomb.cards);
        wildBomb = findWildBomb();
    }

    // 第4步: 提取顺子(固定5张连续不同点数, 不含2, 含癞子填补)
    function findBestStraight() {
        const wilds = getWilds();
        rg = groupByRankLocal();
        const nonTwo = Object.entries(rg)
            .filter(([rank]) => rank !== '2')
            .map(([rank, arr]) => ({ rank, card: arr[0], value: cardValue(arr[0], trumpRank) }))
            .sort((a, b) => a.value - b.value);

        const len = 5; // 顺子固定5张
        if (nonTwo.length + wilds.length < len) return null;

        let best = null;
        for (let startVal = 3; startVal <= 14 - len + 1; startVal++) {
            const endVal = startVal + len - 1;
            if (endVal > 14) continue;

            const usedCards = [];
            let gaps = 0;
            for (let v = startVal; v <= endVal; v++) {
                const entry = nonTwo.find(e => e.value === v);
                if (entry) {
                    usedCards.push(entry.card);
                } else {
                    gaps++;
                }
            }

            if (gaps <= wilds.length && usedCards.length + gaps === len) {
                const wildCards = wilds.slice(0, gaps);
                const allCards = [...usedCards, ...wildCards];
                const score = endVal;
                if (!best || score > best.score) {
                    best = { cards: allCards, score };
                }
            }
        }

        if (best) {
            return { cards: best.cards, type: HAND_TYPE.STRAIGHT, label: '顺子' };
        }
        return null;
    }

    let straightResult = findBestStraight();
    while (straightResult) {
        groups.push(straightResult);
        removeCards(straightResult.cards);
        straightResult = findBestStraight();
    }

    // 第5步: 提取连对(固定3连对=6张, 含癞子)
    function findBestDoubleStraight() {
        const wilds = getWilds();
        rg = groupByRankLocal();
        const entries = Object.entries(rg)
            .filter(([rank]) => rank !== '2')
            .map(([rank, arr]) => ({ rank, cards: arr, count: arr.length, value: cardValue(arr[0], trumpRank) }))
            .sort((a, b) => a.value - b.value);

        const pairCount = 3; // 连对固定3连对
        for (let startVal = 3; startVal <= 14 - pairCount + 1; startVal++) {
            const endVal = startVal + pairCount - 1;
            if (endVal > 14) continue;

            const usedCards = [];
            let wildsNeeded = 0;
            let valid = true;
            for (let v = startVal; v <= endVal; v++) {
                const entry = entries.find(d => d.value === v);
                if (entry) {
                    if (entry.count >= 2) {
                        usedCards.push(entry.cards[0], entry.cards[1]);
                    } else {
                        usedCards.push(entry.cards[0]);
                        wildsNeeded += 1;
                    }
                } else {
                    wildsNeeded += 2;
                }
            }

            if (valid && wildsNeeded <= wilds.length) {
                const wildCards = wilds.slice(0, wildsNeeded);
                const allCards = [...usedCards, ...wildCards];
                return { cards: allCards, type: HAND_TYPE.DOUBLE_STRAIGHT, label: '连对' };
            }
        }
        return null;
    }

    let dsResult = findBestDoubleStraight();
    while (dsResult) {
        groups.push(dsResult);
        removeCards(dsResult.cards);
        dsResult = findBestDoubleStraight();
    }

    // 第6步: 提取三带二(含癞子补充)
    function findTriplePlusTwo() {
        const wilds = getWilds();
        rg = groupByRankLocal();

        const tripleCandidates = Object.entries(rg)
            .map(([rank, arr]) => ({ rank, cards: arr, count: arr.length, value: cardValue(arr[0], trumpRank) }))
            .filter(t => t.count >= 2)
            .sort((a, b) => a.value - b.value);

        for (const tc of tripleCandidates) {
            const needWild = Math.max(0, 3 - tc.count);
            if (needWild > wilds.length) continue;

            const tripleCards = tc.cards.slice(0, Math.min(3, tc.count));
            const tripleWilds = wilds.slice(0, needWild);
            const remainingWilds = wilds.slice(needWild);

            const otherEntries = Object.entries(rg)
                .filter(([rank]) => rank !== tc.rank)
                .map(([rank, arr]) => ({ rank, cards: arr, count: arr.length, value: cardValue(arr[0], trumpRank) }))
                .sort((a, b) => a.value - b.value);

            // 找纯对子配
            const pairEntry = otherEntries.find(e => e.count >= 2);
            if (pairEntry) {
                const pairCards = [pairEntry.cards[0], pairEntry.cards[1]];
                const allCards = [...tripleCards, ...tripleWilds, ...pairCards];
                return { cards: allCards, type: HAND_TYPE.TRIPLE_PLUS_TWO, label: '三带二' };
            }

            // 用癞子凑对
            if (remainingWilds.length >= 1) {
                const singleEntry = otherEntries.find(e => e.count >= 1);
                if (singleEntry) {
                    const allCards = [...tripleCards, ...tripleWilds, singleEntry.cards[0], remainingWilds[0]];
                    return { cards: allCards, type: HAND_TYPE.TRIPLE_PLUS_TWO, label: '三带二' };
                }
            }
            if (remainingWilds.length >= 2) {
                const allCards = [...tripleCards, ...tripleWilds, remainingWilds[0], remainingWilds[1]];
                return { cards: allCards, type: HAND_TYPE.TRIPLE_PLUS_TWO, label: '三带二' };
            }

            // 纯三张
            if (tc.count >= 3) {
                const tCards = tc.cards.slice(0, 3);
                return { cards: tCards, type: HAND_TYPE.TRIPLE, label: '三张' };
            }
        }
        return null;
    }

    let t2Result = findTriplePlusTwo();
    while (t2Result) {
        groups.push(t2Result);
        removeCards(t2Result.cards);
        t2Result = findTriplePlusTwo();
    }

    // 第7步: 提取对子(含癞子配对)
    function findPair() {
        const wilds = getWilds();
        rg = groupByRankLocal();

        // 先找纯对子
        for (const [rank, arr] of Object.entries(rg)) {
            if (arr.length >= 2) {
                return { cards: [arr[0], arr[1]], type: HAND_TYPE.PAIR, label: '对子' };
            }
        }

        // 用癞子配对
        if (wilds.length >= 1) {
            const singles = Object.entries(rg)
                .filter(([, arr]) => arr.length === 1)
                .map(([rank, arr]) => ({ rank, card: arr[0], value: cardValue(arr[0], trumpRank) }))
                .sort((a, b) => b.value - a.value);

            if (singles.length > 0) {
                return { cards: [singles[0].card, wilds[0]], type: HAND_TYPE.PAIR, label: '对子(含癞)' };
            }
        }

        return null;
    }

    let pairResult = findPair();
    while (pairResult) {
        groups.push(pairResult);
        removeCards(pairResult.cards);
        pairResult = findPair();
    }

    // 第8步: 剩余单张不归组(留在散牌区)

    // 应用分组
    state.cardGroups = groups;
    state.selectedIndices = new Set();
    state.selectedGroupIndex = -1;
    renderPlayerHand();

    const groupCount = groups.length;
    const ungrouped = remaining.length;
    showMessage(`自动理牌完成: ${groupCount}组${ungrouped > 0 ? ', ' + ungrouped + '张散牌' : ''}`);
}

// --- 事件绑定 ---
document.getElementById('btn-start').addEventListener('click', () => {
    startRound();
});

document.getElementById('btn-play').addEventListener('click', () => {
    playerPlay();
});

document.getElementById('btn-pass').addEventListener('click', () => {
    playerPass();
});

document.getElementById('btn-hint').addEventListener('click', () => {
    showHint();
});

document.getElementById('btn-group').addEventListener('click', () => {
    manualGroup();
});

document.getElementById('btn-auto-group').addEventListener('click', () => {
    autoGroupCards();
});

document.getElementById('btn-clear-groups').addEventListener('click', () => {
    clearAllGroups();
});

document.getElementById('btn-next-round').addEventListener('click', () => {
    if (state.playerLevel >= 14 || state.aiLevel >= 14) {
        // 重新开始
        state.playerLevel = 2;
        state.aiLevel = 2;
        state.round = 1;
        state.lastRoundWinner = null;
        updateLevelDisplay();
        showScreen('start-screen');
    } else {
        startRound();
    }
});

// 初始化
updateLevelDisplay();
