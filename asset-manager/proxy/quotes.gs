/**
 * 시세·환율 중계 (Google Apps Script)
 *
 * 브라우저는 CORS 때문에 Yahoo Finance를 직접 부를 수 없다. 이 스크립트를 웹 앱으로
 * 배포하면 그 자리를 대신한다. Cloudflare Workers 대신 Apps Script를 쓴 이유는 이미
 * 쓰는 Google 계정 안에서 끝나고, 브라우저만으로 배포할 수 있어서다.
 *
 * 배포 절차는 docs/07-시세-프록시.md 에 있다.
 *
 * 엔드포인트
 *   ?symbols=069500.KS,TSLA,8058.T   시세
 *   ?fx=USDKRW,JPYKRW                환율
 *   둘을 함께 줘도 된다.
 *
 * 이 앱은 사용자의 데이터를 받지 않는다 — 심볼만 보낸다. 보유 수량이나 금액은
 * 절대 여기로 오지 않으므로, 이 URL이 새더라도 알려지는 것은 관심 종목뿐이다.
 */

var CACHE_SECONDS = 15 * 60
var YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/'

function doGet(e) {
  var params = (e && e.parameter) || {}
  var out = { ok: true, asOf: new Date().toISOString() }

  try {
    var symbols = splitList(params.symbols)
    if (symbols.length > 0) out.quotes = fetchQuotes(symbols)

    var pairs = splitList(params.fx)
    if (pairs.length > 0) out.fx = fetchFx(pairs)

    if (symbols.length === 0 && pairs.length === 0) {
      out.ok = false
      out.error = 'symbols 또는 fx 파라미터가 필요합니다.'
    }
  } catch (error) {
    out.ok = false
    out.error = String(error && error.message ? error.message : error)
  }

  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(
    ContentService.MimeType.JSON,
  )
}

function splitList(value) {
  if (!value) return []
  return String(value)
    .split(',')
    .map(function (part) {
      return part.trim()
    })
    .filter(function (part) {
      return part !== ''
    })
}

/**
 * 심볼별 최신 종가.
 *
 * 한 심볼이 실패해도 나머지는 돌려준다. 하나 때문에 전체가 비면 화면에서 원인을
 * 좁힐 수 없다 — 실패한 심볼에는 error 를 담는다.
 */
function fetchQuotes(symbols) {
  var cache = CacheService.getScriptCache()
  var result = {}
  var missing = []

  for (var i = 0; i < symbols.length; i++) {
    var hit = cache.get('q:' + symbols[i])
    if (hit) result[symbols[i]] = JSON.parse(hit)
    else missing.push(symbols[i])
  }

  for (var j = 0; j < missing.length; j++) {
    var symbol = missing[j]
    try {
      var quote = fetchOne(symbol)
      result[symbol] = quote
      cache.put('q:' + symbol, JSON.stringify(quote), CACHE_SECONDS)
    } catch (error) {
      result[symbol] = { error: String(error && error.message ? error.message : error) }
    }
  }

  return result
}

function fetchOne(symbol) {
  var url = YAHOO + encodeURIComponent(symbol) + '?range=5d&interval=1d'
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })

  if (response.getResponseCode() !== 200) {
    throw new Error('Yahoo ' + response.getResponseCode())
  }

  var body = JSON.parse(response.getContentText())
  var chart = body && body.chart
  if (!chart || chart.error) throw new Error((chart && chart.error && chart.error.description) || 'chart 오류')

  var meta = chart.result && chart.result[0] && chart.result[0].meta
  if (!meta) throw new Error('meta 없음')

  return {
    price: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose,
    currency: meta.currency,
    name: meta.longName || meta.shortName || symbol,
    exchange: meta.fullExchangeName,
  }
}

/**
 * 환율. **항상 원/1단위로 돌려준다.**
 *
 * 한국 고시는 `원/100엔` 이 흔하고 Yahoo `JPYKRW=X` 는 `원/1엔` 이다. 두 표기는 정확히
 * 100배 다르고, 이 프로젝트는 이미 그 차이로 한 번 틀렸다. 그래서 단위를 여기서 한 번만
 * 정하고 응답에 `unit` 으로 명시한다 — 앱이 다시 변환하면 같은 실수가 반복된다.
 */
function fetchFx(pairs) {
  var cache = CacheService.getScriptCache()
  var result = {}

  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i].toUpperCase()
    var key = 'fx:' + pair
    var hit = cache.get(key)
    if (hit) {
      result[pair] = JSON.parse(hit)
      continue
    }

    try {
      var quote = fetchOne(pair + '=X')
      var entry = {
        rate: quote.price,
        unit: '1',
        note: 'KRW per 1 unit of ' + pair.slice(0, 3),
      }
      result[pair] = entry
      cache.put(key, JSON.stringify(entry), CACHE_SECONDS)
    } catch (error) {
      result[pair] = { error: String(error && error.message ? error.message : error) }
    }
  }

  return result
}
