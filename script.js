const SEOUL = { latitude: 37.5665, longitude: 126.978, label: "서울" };

const WEATHER_CODES = {
  0: { icon: "☀️", label: "맑음" },
  1: { icon: "🌤️", label: "대체로 맑음" },
  2: { icon: "⛅", label: "부분적으로 흐림" },
  3: { icon: "☁️", label: "흐림" },
  45: { icon: "🌫️", label: "안개" },
  48: { icon: "🌫️", label: "짙은 안개" },
  51: { icon: "🌦️", label: "약한 이슬비" },
  53: { icon: "🌦️", label: "이슬비" },
  55: { icon: "🌦️", label: "강한 이슬비" },
  56: { icon: "🌧️", label: "약한 어는 비" },
  57: { icon: "🌧️", label: "어는 비" },
  61: { icon: "🌧️", label: "약한 비" },
  63: { icon: "🌧️", label: "비" },
  65: { icon: "🌧️", label: "강한 비" },
  66: { icon: "🌧️", label: "약한 어는 비" },
  67: { icon: "🌧️", label: "강한 어는 비" },
  71: { icon: "🌨️", label: "약한 눈" },
  73: { icon: "🌨️", label: "눈" },
  75: { icon: "🌨️", label: "강한 눈" },
  77: { icon: "🌨️", label: "가루눈" },
  80: { icon: "🌦️", label: "약한 소나기" },
  81: { icon: "🌦️", label: "소나기" },
  82: { icon: "🌦️", label: "강한 소나기" },
  85: { icon: "🌨️", label: "약한 소낙눈" },
  86: { icon: "🌨️", label: "강한 소낙눈" },
  95: { icon: "⛈️", label: "뇌우" },
  96: { icon: "⛈️", label: "우박을 동반한 뇌우" },
  99: { icon: "⛈️", label: "강한 우박을 동반한 뇌우" },
};

function setTodayLabel() {
  const el = document.getElementById("today-label");
  const now = new Date();
  el.textContent = now.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(SEOUL);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          label: null,
        }),
      () => resolve(SEOUL),
      { timeout: 5000 }
    );
  });
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ko`
    );
    if (!res.ok) throw new Error("reverse geocode failed");
    const data = await res.json();
    return data.city || data.locality || data.principalSubdivision || "내 위치";
  } catch {
    return "내 위치";
  }
}

async function loadWeather() {
  const body = document.getElementById("weather-body");
  body.innerHTML = '<p class="status">날씨 정보를 불러오는 중...</p>';

  try {
    const loc = await getLocation();
    const label = loc.label || (await reverseGeocode(loc.latitude, loc.longitude));

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", loc.latitude);
    url.searchParams.set("longitude", loc.longitude);
    url.searchParams.set(
      "current",
      "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m"
    );
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
    url.searchParams.set("timezone", "auto");

    const res = await fetch(url);
    if (!res.ok) throw new Error("weather fetch failed");
    const data = await res.json();

    const current = data.current;
    const weather = WEATHER_CODES[current.weather_code] || { icon: "🌡️", label: "-" };
    const tMax = Math.round(data.daily.temperature_2m_max[0]);
    const tMin = Math.round(data.daily.temperature_2m_min[0]);

    body.innerHTML = `
      <div class="weather-location">${label}</div>
      <div class="weather-main">
        <div class="weather-icon">${weather.icon}</div>
        <div>
          <div class="weather-temp">${Math.round(current.temperature_2m)}°C</div>
          <div class="weather-desc">${weather.label} · 체감 ${Math.round(current.apparent_temperature)}°C</div>
        </div>
      </div>
      <div class="weather-details">
        <span>최고 <strong>${tMax}°C</strong> / 최저 <strong>${tMin}°C</strong></span>
        <span>습도 <strong>${current.relative_humidity_2m}%</strong></span>
        <span>풍속 <strong>${current.wind_speed_10m}km/h</strong></span>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<p class="status error">날씨 정보를 불러오지 못했습니다. (${err.message})</p>`;
  }
}

async function fetchKospiData() {
  const target = "https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?interval=1d&range=1d";

  // Yahoo's endpoint doesn't send CORS headers to browsers, so a direct fetch
  // usually fails there. Try it first (works in some environments), then fall
  // back through a few public CORS proxies.
  const attempts = [
    () => fetch(target),
    () => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`),
    () => fetch(`https://corsproxy.io/?url=${encodeURIComponent(target)}`),
    () => fetch(`https://thingproxy.freeboard.io/fetch/${target}`),
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.chart?.result?.[0]?.meta) return data;
      throw new Error("예상치 못한 응답 형식");
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(errors[errors.length - 1] || "모든 요청 실패");
}

async function loadStock() {
  const body = document.getElementById("stock-body");
  body.innerHTML = '<p class="status">지수 정보를 불러오는 중...</p>';

  try {
    const data = await fetchKospiData();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error("데이터 없음");

    const price = meta.regularMarketPrice;
    const prevClose = meta.previousClose ?? meta.chartPreviousClose;
    const diff = price - prevClose;
    const pct = (diff / prevClose) * 100;
    const direction = diff >= 0 ? "up" : "down";
    const sign = diff >= 0 ? "+" : "";
    const updated = meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toLocaleTimeString("ko-KR")
      : "-";

    body.innerHTML = `
      <div class="stock-index">${price.toFixed(2)}</div>
      <div class="stock-change ${direction}">
        ${sign}${diff.toFixed(2)} (${sign}${pct.toFixed(2)}%)
      </div>
      <div class="stock-updated">업데이트: ${updated}</div>
    `;
  } catch (err) {
    body.innerHTML = `
      <p class="status error">지수 정보를 불러오지 못했습니다. (${err.message})</p>
      <p class="status"><a href="https://finance.naver.com/sise/sise_index.naver?code=KOSPI" target="_blank" rel="noopener">네이버 증권에서 확인하기 →</a></p>
    `;
  }
}

document.getElementById("weather-refresh").addEventListener("click", loadWeather);
document.getElementById("stock-refresh").addEventListener("click", loadStock);

setTodayLabel();
loadWeather();
loadStock();
