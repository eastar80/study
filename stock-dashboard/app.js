const el = {
  input: document.getElementById("q"),
  form: document.getElementById("search-form"),
  button: document.getElementById("search-btn"),
  suggest: document.getElementById("suggest"),
  results: document.getElementById("results"),
  empty: document.getElementById("empty"),
};

const fmt = new Intl.NumberFormat("ko-KR");
const fmtDate = (str) => {
  const d = new Date(str);
  if (isNaN(d)) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

function trend(change) {
  if (change > 0) return { cls: "up", sign: "▲" };
  if (change < 0) return { cls: "down", sign: "▼" };
  return { cls: "flat", sign: "―" };
}

let activeSuggest = -1;
let currentSuggestions = [];

function closeSuggest() {
  el.suggest.classList.remove("open");
  el.suggest.innerHTML = "";
  activeSuggest = -1;
  currentSuggestions = [];
}

function openSuggest() {
  const list = suggestTickers(el.input.value);
  currentSuggestions = list;
  activeSuggest = -1;
  if (list.length === 0) {
    closeSuggest();
    return;
  }
  el.suggest.innerHTML = list
    .map(
      (t, i) => `
      <div class="suggest-item" data-idx="${i}" data-name="${t.name}">
        <span class="s-name">${t.name}</span>
        <span class="s-code">${t.code} · ${t.market === "KQ" ? "코스닥" : "코스피"}</span>
      </div>`
    )
    .join("");
  el.suggest.classList.add("open");
}

el.suggest.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".suggest-item");
  if (!item) return;
  e.preventDefault();
  el.input.value = item.dataset.name;
  closeSuggest();
  runSearch();
});

el.input.addEventListener("input", openSuggest);
el.input.addEventListener("focus", () => {
  if (el.input.value.trim()) openSuggest();
});
el.input.addEventListener("blur", () => setTimeout(closeSuggest, 120));

el.input.addEventListener("keydown", (e) => {
  if (!el.suggest.classList.contains("open")) return;
  const items = [...el.suggest.querySelectorAll(".suggest-item")];
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeSuggest = Math.min(activeSuggest + 1, items.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeSuggest = Math.max(activeSuggest - 1, 0);
  } else if (e.key === "Enter" && activeSuggest >= 0) {
    e.preventDefault();
    el.input.value = currentSuggestions[activeSuggest].name;
    closeSuggest();
    runSearch();
    return;
  } else {
    return;
  }
  items.forEach((it, i) => it.classList.toggle("active", i === activeSuggest));
});

el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  closeSuggest();
  runSearch();
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    el.input.value = chip.textContent;
    runSearch();
  });
});

function skeletonCards() {
  return `
    <section class="card card-quote">
      <div class="card-head"><h2 class="card-title">주가</h2></div>
      <div class="card-body">
        <div class="skeleton sk-line" style="width:40%"></div>
        <div class="skeleton sk-line" style="width:25%"></div>
        <div class="skeleton sk-chart"></div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2 class="card-title">최근 뉴스</h2></div>
      <div class="card-body">
        <div class="skeleton sk-line" style="width:90%"></div>
        <div class="skeleton sk-line" style="width:70%"></div>
        <div class="skeleton sk-line" style="width:80%"></div>
        <div class="skeleton sk-line" style="width:60%"></div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2 class="card-title">최근 공시</h2></div>
      <div class="card-body">
        <div class="skeleton sk-line" style="width:85%"></div>
        <div class="skeleton sk-line" style="width:50%"></div>
      </div>
    </section>`;
}

function renderQuote(stock) {
  const t = trend(stock.change);
  const first = stock.series[0]?.close ?? stock.current;
  const last = stock.series[stock.series.length - 1]?.close ?? stock.current;
  const periodPct = first ? ((last - first) / first) * 100 : 0;
  return `
    <section class="card card-quote">
      <div class="card-head"><h2 class="card-title">주가</h2></div>
      <div class="card-body">
        <div class="quote-top">
          <div>
            <p class="quote-name">${stock.name}</p>
            <span class="quote-symbol">${stock.symbol} · ${stock.exchange}</span>
          </div>
          <div class="quote-price">
            <div class="price-now">${fmt.format(Math.round(stock.current))} ${stock.currency}</div>
            <div class="price-change ${t.cls}">
              ${t.sign} ${fmt.format(Math.abs(Math.round(stock.change)))}
              (${stock.changePct >= 0 ? "+" : ""}${stock.changePct.toFixed(2)}%)
            </div>
          </div>
        </div>
        <div class="chart-wrap">${renderLineChart(stock.series, { up: periodPct >= 0 })}</div>
        <div class="chart-meta">
          <span>최근 3개월</span>
          <span class="${periodPct >= 0 ? "up" : "down"}">
            기간 ${periodPct >= 0 ? "+" : ""}${periodPct.toFixed(2)}%
          </span>
        </div>
      </div>
    </section>`;
}

function renderNews(items) {
  const rows = items
    .map(
      (n) => `
      <li class="news-item">
        <a href="${n.link}" target="_blank" rel="noopener noreferrer">${n.title}</a>
        <div class="news-meta">
          ${n.source ? `<span>${n.source}</span><span class="dot"></span>` : ""}
          <span>${fmtDate(n.pubDate)}</span>
        </div>
      </li>`
    )
    .join("");
  return `
    <section class="card">
      <div class="card-head"><h2 class="card-title">최근 뉴스</h2></div>
      <div class="card-body">
        <ul class="news-list" role="list">${rows}</ul>
      </div>
    </section>`;
}

function renderNewsError() {
  return `
    <section class="card">
      <div class="card-head"><h2 class="card-title">최근 뉴스</h2></div>
      <div class="card-body">
        <p class="disclosure-note">
          무료 뉴스 소스(Google News)를 지금 불러오지 못했습니다.
          공개 프록시 상태에 따라 일시적으로 실패할 수 있습니다.
        </p>
      </div>
    </section>`;
}

const iconExternal = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;

function renderDisclosure(companyName) {
  return `
    <section class="card">
      <div class="card-head"><h2 class="card-title">최근 공시</h2></div>
      <div class="card-body">
        <p class="disclosure-note">
          한국 공시 원문(DART)은 API 키가 필요해 정적 페이지에서 직접 목록을 가져올 수 없습니다.
          아래 버튼으로 금융감독원 전자공시시스템에서 <strong>${companyName}</strong>의 최근 공시를 바로 확인하세요.
        </p>
        <a class="btn-link" href="${buildDartUrl(companyName)}" target="_blank" rel="noopener noreferrer">
          ${iconExternal} DART에서 공시 보기
        </a>
      </div>
    </section>`;
}

let searchToken = 0;

async function runSearch() {
  const raw = el.input.value;
  const ticker = resolveTicker(raw);
  el.empty.style.display = "none";

  if (!ticker) {
    el.results.innerHTML = `<div class="state error">
      "${raw.trim()}"에 해당하는 종목을 찾지 못했습니다. 기업명 또는 6자리 종목코드를 입력해 주세요.
    </div>`;
    return;
  }

  const token = ++searchToken;
  el.button.disabled = true;
  el.results.innerHTML = skeletonCards();

  let stock = null;
  try {
    stock = await fetchStock(ticker);
  } catch (err) {
    if (token !== searchToken) return;
    el.results.innerHTML = `<div class="state error">
      주가 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.<br>
      <span style="font-size:13px">(${(err && err.message) || "네트워크 오류"})</span>
    </div>`;
    el.button.disabled = false;
    return;
  }
  if (token !== searchToken) return;

  const companyName = ticker.resolvedBy?.startsWith("code") ? stock.name : ticker.name;

  el.results.innerHTML =
    renderQuote(stock) +
    `<div id="news-slot"></div>` +
    renderDisclosure(companyName);
  el.button.disabled = false;

  try {
    const news = await fetchNews(companyName);
    if (token !== searchToken) return;
    document.getElementById("news-slot").outerHTML = renderNews(news);
  } catch (_) {
    if (token !== searchToken) return;
    const slot = document.getElementById("news-slot");
    if (slot) slot.outerHTML = renderNewsError();
  }
}
