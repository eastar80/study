// market 값은 Yahoo Finance 심볼 suffix 규칙을 따른다: 코스피 = KS, 코스닥 = KQ
const TICKERS = [
  { name: "삼성전자", code: "005930", market: "KS", aliases: ["samsung", "삼전"] },
  { name: "SK하이닉스", code: "000660", market: "KS", aliases: ["하이닉스", "sk hynix"] },
  { name: "LG에너지솔루션", code: "373220", market: "KS", aliases: ["엘지에너지솔루션", "lg엔솔"] },
  { name: "삼성바이오로직스", code: "207940", market: "KS", aliases: ["삼바"] },
  { name: "현대차", code: "005380", market: "KS", aliases: ["현대자동차", "hyundai"] },
  { name: "기아", code: "000270", market: "KS", aliases: ["kia", "기아차"] },
  { name: "셀트리온", code: "068270", market: "KS", aliases: ["celltrion"] },
  { name: "NAVER", code: "035420", market: "KS", aliases: ["네이버", "naver"] },
  { name: "카카오", code: "035720", market: "KS", aliases: ["kakao"] },
  { name: "POSCO홀딩스", code: "005490", market: "KS", aliases: ["포스코홀딩스", "포스코", "posco"] },
  { name: "LG화학", code: "051910", market: "KS", aliases: ["엘지화학"] },
  { name: "삼성SDI", code: "006400", market: "KS", aliases: ["삼성에스디아이"] },
  { name: "삼성물산", code: "028260", market: "KS", aliases: [] },
  { name: "KB금융", code: "105560", market: "KS", aliases: ["케이비금융"] },
  { name: "신한지주", code: "055550", market: "KS", aliases: ["신한금융"] },
  { name: "하나금융지주", code: "086790", market: "KS", aliases: ["하나금융"] },
  { name: "현대모비스", code: "012330", market: "KS", aliases: ["모비스"] },
  { name: "LG전자", code: "066570", market: "KS", aliases: ["엘지전자", "lg electronics"] },
  { name: "삼성생명", code: "032830", market: "KS", aliases: [] },
  { name: "SK이노베이션", code: "096770", market: "KS", aliases: ["에스케이이노베이션"] },
  { name: "SK텔레콤", code: "017670", market: "KS", aliases: ["skt", "에스케이텔레콤"] },
  { name: "KT", code: "030200", market: "KS", aliases: ["케이티"] },
  { name: "한국전력", code: "015760", market: "KS", aliases: ["한전", "kepco"] },
  { name: "삼성전기", code: "009150", market: "KS", aliases: [] },
  { name: "크래프톤", code: "259960", market: "KS", aliases: ["krafton"] },
  { name: "HD현대중공업", code: "329180", market: "KS", aliases: ["현대중공업"] },
  { name: "두산에너빌리티", code: "034020", market: "KS", aliases: ["두산"] },
  { name: "포스코퓨처엠", code: "003670", market: "KS", aliases: ["포스코케미칼"] },
  { name: "고려아연", code: "010130", market: "KS", aliases: [] },
  { name: "삼성화재", code: "000810", market: "KS", aliases: [] },
  { name: "메리츠금융지주", code: "138040", market: "KS", aliases: ["메리츠금융"] },
  { name: "우리금융지주", code: "316140", market: "KS", aliases: ["우리금융"] },
  { name: "기업은행", code: "024110", market: "KS", aliases: ["ibk"] },
  { name: "LG", code: "003550", market: "KS", aliases: ["엘지"] },
  { name: "SK", code: "034730", market: "KS", aliases: ["에스케이"] },
  { name: "한화에어로스페이스", code: "012450", market: "KS", aliases: ["한화에어로"] },
  { name: "HMM", code: "011200", market: "KS", aliases: ["에이치엠엠"] },
  { name: "카카오뱅크", code: "323410", market: "KS", aliases: ["kakaobank"] },
  { name: "카카오페이", code: "377300", market: "KS", aliases: ["kakaopay"] },
  { name: "엔씨소프트", code: "036570", market: "KS", aliases: ["ncsoft", "엔씨"] },
  { name: "넷마블", code: "251270", market: "KS", aliases: ["netmarble"] },
  { name: "에코프로비엠", code: "247540", market: "KQ", aliases: ["에코프로bm"] },
  { name: "에코프로", code: "086520", market: "KQ", aliases: [] },
  { name: "알테오젠", code: "196170", market: "KQ", aliases: [] },
  { name: "HLB", code: "028300", market: "KQ", aliases: ["에이치엘비"] },
  { name: "엔켐", code: "348370", market: "KQ", aliases: [] },
  { name: "리노공업", code: "058470", market: "KQ", aliases: [] },
  { name: "펄어비스", code: "263750", market: "KQ", aliases: ["pearlabyss"] },
  { name: "JYP Ent.", code: "035900", market: "KQ", aliases: ["jyp"] },
  { name: "셀트리온제약", code: "068760", market: "KQ", aliases: [] },
  { name: "클래시스", code: "214150", market: "KQ", aliases: [] },
];

function resolveTicker(input) {
  const q = input.trim();
  if (!q) return null;

  if (/^\d{6}$/.test(q)) {
    const known = TICKERS.find((t) => t.code === q);
    if (known) return { ...known, resolvedBy: "code" };
    return { name: q, code: q, market: "KS", aliases: [], resolvedBy: "code-unknown" };
  }

  const lower = q.toLowerCase();

  let hit = TICKERS.find((t) => t.name.toLowerCase() === lower);
  if (hit) return { ...hit, resolvedBy: "name-exact" };

  hit = TICKERS.find((t) => t.aliases.some((a) => a.toLowerCase() === lower));
  if (hit) return { ...hit, resolvedBy: "alias-exact" };

  hit = TICKERS.find(
    (t) =>
      t.name.toLowerCase().includes(lower) ||
      t.aliases.some((a) => a.toLowerCase().includes(lower))
  );
  if (hit) return { ...hit, resolvedBy: "partial" };

  return null;
}

function suggestTickers(input, limit = 8) {
  const q = input.trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const t of TICKERS) {
    const name = t.name.toLowerCase();
    let score = -1;
    if (name === q) score = 100;
    else if (t.aliases.some((a) => a.toLowerCase() === q)) score = 95;
    else if (name.startsWith(q)) score = 80;
    else if (t.aliases.some((a) => a.toLowerCase().startsWith(q))) score = 70;
    else if (name.includes(q)) score = 50;
    else if (t.aliases.some((a) => a.toLowerCase().includes(q))) score = 40;
    else if (t.code.startsWith(q)) score = 30;
    if (score >= 0) scored.push({ t, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.t);
}
