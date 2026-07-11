# -*- coding: utf-8 -*-
"""fetch_prices.py / log_rebalance.py / refresh_etf_list.py 공용 헬퍼."""
import datetime


def find_headers(ws, header_row):
    """header_row 행을 왼쪽부터 읽어 {헤더텍스트: 열번호} 딕셔너리를 만든다."""
    headers = {}
    col = 1
    while True:
        val = ws.cell(row=header_row, column=col).value
        if val is None:
            break
        headers[val] = col
        col += 1
    return headers


def find_data_rows(ws, header_row, key_col):
    """header_row 다음 행부터 key_col 이 비어있기 전까지의 행 번호 목록을 반환."""
    rows = []
    r = header_row + 1
    while ws.cell(row=r, column=key_col).value not in (None, ""):
        rows.append(r)
        r += 1
    return rows


def normalize_ticker(val):
    """엑셀 셀 값(문자열/숫자)을 6자리 KRX 티커 문자열로 정규화."""
    if val is None:
        return None
    if isinstance(val, float):
        val = int(val)
    return str(val).strip().zfill(6)


def latest_etf_ohlcv(stock_module, max_lookback_days=10):
    """최근 영업일 기준 전 ETF 종목 OHLCV DataFrame을 반환. (기준일_YYYYMMDD, DataFrame)"""
    today = datetime.date.today()
    for i in range(max_lookback_days):
        d = today - datetime.timedelta(days=i)
        date_str = d.strftime("%Y%m%d")
        df = stock_module.get_etf_ohlcv_by_ticker(date_str)
        if not df.empty:
            return date_str, df
    raise RuntimeError(f"최근 {max_lookback_days}일 내 ETF 시세를 찾지 못했습니다 (휴장일이 길게 이어졌거나 네트워크 문제일 수 있습니다).")
