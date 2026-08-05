const PROXIES = [
  (url) => `https://r.jina.ai/${url}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

async function fetchViaProxy(targetUrl, { asText = true, timeoutMs = 15000 } = {}) {
  let lastErr;
  for (const build of PROXIES) {
    const proxied = build(targetUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(proxied, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} @ ${proxied}`);
        continue;
      }
      const body = await res.text();
      if (!body || body.length < 20) {
        lastErr = new Error(`Empty body @ ${proxied}`);
        continue;
      }
      return asText ? body : JSON.parse(body);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  throw lastErr || new Error("모든 프록시 요청에 실패했습니다.");
}

// r.jina.ai 리더는 JSON을 마크다운 본문에 감싸 반환하므로 첫 번째 완전한 JSON 객체를 추출한다.
function extractJson(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      /* fall through to brace-scan */
    }
  }
  const start = raw.indexOf("{");
  if (start === -1) throw new Error("응답에서 JSON을 찾지 못했습니다.");
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
    }
  }
  throw new Error("응답에서 완결된 JSON을 찾지 못했습니다.");
}

async function fetchStock(ticker) {
  const suffixes = ticker.market === "KQ" ? ["KQ", "KS"] : ["KS", "KQ"];
  let lastErr;
  for (const suffix of suffixes) {
    const symbol = `${ticker.code}.${suffix}`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=3mo&interval=1d`;
    try {
      const raw = await fetchViaProxy(url, { asText: true });
      const data = extractJson(raw);
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error("차트 데이터가 비어 있습니다.");
      const meta = result.meta;
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      const series = [];
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] != null) {
          series.push({ t: timestamps[i] * 1000, close: closes[i] });
        }
      }
      if (series.length === 0) throw new Error("유효한 종가가 없습니다.");
      const current = meta.regularMarketPrice ?? series[series.length - 1].close;
      const prevClose = meta.chartPreviousClose ?? series[series.length - 2]?.close ?? current;
      return {
        symbol,
        name: meta.longName || meta.shortName || ticker.name,
        currency: meta.currency || "KRW",
        exchange: meta.fullExchangeName || suffix,
        current,
        prevClose,
        change: current - prevClose,
        changePct: prevClose ? ((current - prevClose) / prevClose) * 100 : 0,
        series,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("주가 데이터를 불러오지 못했습니다.");
}

async function fetchNews(companyName) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
    companyName
  )}&hl=ko&gl=KR&ceid=KR:ko`;
  const raw = await fetchViaProxy(rssUrl, { asText: true });
  const doc = new DOMParser().parseFromString(raw, "text/xml");
  const items = [...doc.querySelectorAll("item")].slice(0, 12).map((item) => {
    const title = item.querySelector("title")?.textContent?.trim() || "";
    const link = item.querySelector("link")?.textContent?.trim() || "";
    const pubDate = item.querySelector("pubDate")?.textContent?.trim() || "";
    const source =
      item.getElementsByTagName("source")[0]?.textContent?.trim() || "";
    return { title, link, pubDate, source };
  });
  if (items.length === 0) throw new Error("뉴스 항목을 찾지 못했습니다.");
  return items;
}

function buildDartUrl(companyName) {
  return `https://dart.fss.or.kr/dsab007/main.do?textCrpNm=${encodeURIComponent(
    companyName
  )}`;
}
