"""Synthetic Finance read model. Money is integer cents. Weeks are Monday–Sunday in America/Detroit."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

DETROIT = ZoneInfo("America/Detroit")
PLAN_CENTS = 420_400
NET_WORTH_CENTS = 1_847_236
YTD_DELTA_CENTS = 128_410
ACCOUNTS_UPDATED = "2026-11-10T14:58:00.000Z"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
YTD_Y = [116, 102.8, 109.4, 89.6, 94.9, 79.1, 76.5, 84.4, 64.6, 56.7, 62, 42.2, 34.3, 39.6, 23.8, 18.5, 4]

CATEGORIES = [
    {"slug": "dining-out", "name": "Dining Out", "capCents": 8000, "color": "#E07A5F"},
    {"slug": "groceries", "name": "Groceries", "capCents": 12000, "color": "#2E8B6A"},
    {"slug": "transport", "name": "Transport", "capCents": 6000, "color": "#5B6B8C"},
    {"slug": "subscriptions", "name": "Subscriptions", "capCents": 5500, "color": "#8E7CC3"},
    {"slug": "shopping", "name": "Shopping", "capCents": 7500, "color": "#E9B949"},
    {"slug": "utilities", "name": "Utilities", "capCents": 0, "color": "#3A86C8"},
]


def _txn(row_id, payee, day, category, kind, amount, **extra):
    row = {
        "id": row_id,
        "payee": payee,
        "date": day,
        "category": category,
        "type": kind,
        "amountCents": amount,
        "source": extra.get("source", "manual"),
    }
    if "correction" in extra:
        row["correction"] = extra["correction"]
    return row


SEED_TRANSACTIONS = [
    _txn("fin-payroll", "Payroll (example)", "2026-11-09", None, "income", 235_000, source="ledger"),
    _txn("fin-pizza", "Joe's Pizza", "2026-11-10", "dining-out", "expense", -3240),
    _txn("fin-sweetgreen", "Sweetgreen", "2026-11-09", "dining-out", "expense", -2860),
    _txn("fin-deli", "Corner Deli", "2026-11-09", "dining-out", "expense", -2450),
    _txn("fin-cafe", "Cafe Norte (example)", "2026-11-10", "dining-out", "expense", -2100),
    _txn("fin-refund", "Example refund — Joe's Pizza", "2026-11-10", "dining-out", "refund", 1450),
    _txn("fin-northside", "Northside Market", "2026-11-10", "groceries", "expense", -6188),
    _txn("fin-trader", "Trader Joe's", "2026-11-09", "groceries", "expense", -4612),
    _txn("fin-bus", "City Bus pass", "2026-11-09", "transport", "expense", -2500),
    _txn("fin-shell", "Shell (example)", "2026-11-09", "transport", "expense", -2218, source="ledger", correction={"category": "transport", "amountCents": -2218}),
    _txn("fin-stream", "Streaming Club (example)", "2026-11-09", "subscriptions", "expense", -4675),
    _txn("fin-harbor", "Harbor Supply Co.", "2026-11-10", "shopping", "expense", -1800),
    _txn("fin-power", "City Power (example)", "2026-11-09", "utilities", "expense", -6410),
    _txn("fin-vendor", "SQ *DEMO VENDOR", "2026-11-10", None, "expense", -940),
    _txn("fin-transfer", "Transfer to Savings (example)", "2026-11-09", None, "transfer", -20_000),
    _txn("fin-span-dining", "Example bistro", "2026-11-01", "dining-out", "expense", -7400),
    _txn("fin-span-groceries", "Example market", "2026-11-01", "groceries", "expense", -8840),
    _txn("fin-span-transport", "Example ride", "2026-11-01", "transport", "expense", -4000),
    _txn("fin-span-subs", "Example stream", "2026-11-01", "subscriptions", "expense", -4675),
    _txn("fin-span-shop", "Example shop", "2026-11-01", "shopping", "expense", -1200),
    _txn("fin-early-dining", "Example lunch counter", "2026-11-02", "dining-out", "expense", -12_000),
    _txn("fin-early-groceries", "Example grocery run", "2026-11-03", "groceries", "expense", -15_000),
    _txn("fin-early-transport", "Example fare", "2026-11-04", "transport", "expense", -8000),
    _txn("fin-early-shop", "Example outlet", "2026-11-05", "shopping", "expense", -7042),
    _txn("fin-early-power", "Example utility", "2026-11-06", "utilities", "expense", -5900),
    _txn("fin-old", "Example 2025 shop", "2025-01-06", "shopping", "expense", -1500),
]

RECENT_IDS = ["fin-payroll", "fin-pizza", "fin-refund", "fin-northside", "fin-trader", "fin-bus", "fin-shell", "fin-stream", "fin-harbor", "fin-power", "fin-vendor", "fin-transfer", "fin-sweetgreen", "fin-deli", "fin-cafe"]

ACCOUNTS = {
    "netWorthCents": NET_WORTH_CENTS,
    "assetsCents": 2_647_236,
    "liabilitiesCents": 800_000,
    "updatedAt": ACCOUNTS_UPDATED,
    "accounts": [
        {"name": "Example checking", "group": "Cash", "amountCents": 247_236},
        {"name": "Example savings", "group": "Cash", "amountCents": 1_000_000},
        {"name": "Example brokerage", "group": "Investments", "amountCents": 1_400_000},
        {"name": "Example loan", "group": "Liability", "amountCents": 760_000},
        {"name": "Example card", "group": "Liability", "amountCents": 40_000},
    ],
}

GOALS = [
    {"slug": "student-loan-payoff", "name": "Student loan payoff", "value": 62, "amount": "$12,400", "target": "$20,000", "note": "On track"},
    {"slug": "emergency-fund", "name": "Emergency fund", "value": 41, "amount": "$4,100", "target": "$10,000", "note": "On track"},
    {"slug": "nyc-move-fund", "name": "NYC move fund", "value": 28, "amount": "$2,240", "target": "$8,000", "note": "Behind"},
    {"slug": "travel-japan", "name": "Travel — Japan", "value": 15, "amount": "$450", "target": "$3,000", "note": "Paused"},
]


def _date(ymd: str):
    year, month, day = (int(part) for part in ymd.split("-"))
    return datetime(year, month, day, 12, tzinfo=DETROIT)


def detroit_ymd(ms: int) -> str:
    moment = datetime.fromtimestamp(ms / 1000, DETROIT)
    return moment.date().isoformat()


def add_days(ymd: str, count: int) -> str:
    return (_date(ymd) + timedelta(days=count)).date().isoformat()


def week_start(ymd: str) -> str:
    return add_days(ymd, -_date(ymd).weekday())


def days_left(today: str, start: str):
    if week_start(today) != start:
        return None
    return 7 - _date(today).weekday()


def _format_day(ymd: str) -> str:
    return f"{MONTHS[int(ymd[5:7]) - 1]} {int(ymd[8:10])}"


def week_label(start: str, today: str) -> str:
    end = add_days(start, 6)
    same = start[5:7] == end[5:7]
    span = f"{_format_day(start)}–{int(end[8:10])}" if same else f"{_format_day(start)}–{_format_day(end)}"
    return f"This week · {span}" if week_start(today) == start else span


def money(cents: int) -> str:
    sign = "−" if cents < 0 else ""
    absolute = abs(cents)
    if absolute % 100:
        text = f"{absolute / 100:.2f}"
    else:
        text = str(absolute // 100)
    whole, _, frac = text.partition(".")
    grouped = f"{int(whole):,}"
    return f"{sign}${grouped}.{frac}" if frac else f"{sign}${grouped}"


def effective(row: dict) -> dict:
    correction = row.get("correction") or {}
    shown = dict(row)
    shown["amountCents"] = correction.get("amountCents", row["amountCents"])
    shown["category"] = correction["category"] if "category" in correction else row["category"]
    shown["type"] = correction.get("type", row["type"])
    shown["corrected"] = bool(row.get("correction"))
    return shown


def spend_cents(row: dict) -> int:
    if row["type"] not in {"expense", "refund"}:
        return 0
    return -row["amountCents"]


def _cap_state(spent: int, cap: int) -> dict:
    if not cap:
        return {"state": "none", "percent": None, "fill": 0, "tone": "muted", "status": "No cap set"}
    ratio = spent / cap
    percent = round(ratio * 100)
    fill = min(100, max(0, percent))
    if ratio > 1:
        return {"state": "over", "percent": percent, "fill": 100, "tone": "over", "status": f"{money(spent - cap)} over"}
    if ratio > 0.85:
        return {"state": "near", "percent": percent, "fill": fill, "tone": "over", "status": f"{money(cap - spent)} left"}
    return {"state": "under", "percent": percent, "fill": fill, "tone": "category", "status": f"{money(cap - spent)} left"}


def _rows_in_week(txns, start: str):
    end = add_days(start, 6)
    return [effective(row) for row in txns if start <= effective(row)["date"] <= end]


def caps_for_week(txns, start: str):
    rows = _rows_in_week(txns, start)
    caps = []
    for category in CATEGORIES:
        spent = sum(spend_cents(row) for row in rows if row["category"] == category["slug"])
        caps.append({**category, "spentCents": spent, "capCents": category["capCents"], **_cap_state(spent, category["capCents"])})
    return caps


def _ytd_points():
    start = NET_WORTH_CENTS - YTD_DELTA_CENTS
    points = []
    span = YTD_Y[0] - YTD_Y[-1]
    for index, value in enumerate(YTD_Y):
        if index == 0:
            points.append(start)
        elif index == len(YTD_Y) - 1:
            points.append(NET_WORTH_CENTS)
        else:
            points.append(round(start + ((YTD_Y[0] - value) / span) * (NET_WORTH_CENTS - start)))
    return points


def _weekly_series(txns):
    weeks = {}
    for row in (effective(item) for item in txns):
        start = week_start(row["date"])
        weeks[start] = weeks.get(start, 0) + spend_cents(row)
    if not weeks:
        return []
    ordered = sorted(weeks)
    points = []
    cursor = ordered[0]
    while cursor <= ordered[-1]:
        points.append({"week": cursor, "cents": weeks.get(cursor, 0)})
        cursor = add_days(cursor, 7)
    return points


def chart_for(txns, today: str, selected: str) -> dict:
    current = week_start(today)
    all_points = [point for point in _weekly_series(txns) if point["week"] <= current]
    if selected == "YTD":
        return {"range": "YTD", "kind": "net-worth", "caption": f"+{money(YTD_DELTA_CENTS)} (7.5%) YTD", "points": _ytd_points()}
    points = all_points
    if selected == "1W":
        points = [point for point in all_points if point["week"] == current]
    elif selected == "1M":
        month_start = f"{today[:7]}-01"
        month_end = add_days(month_start, 32)[:8] + "01"
        month_end = add_days(month_end, -1)
        points = [point for point in all_points if add_days(point["week"], 6) >= month_start and point["week"] <= month_end]
    elif selected == "1Y":
        points = [point for point in all_points if point["week"] >= week_start(add_days(today, -365))]
    return {"range": selected, "kind": "weekly", "caption": "", "points": [point["cents"] for point in points]}


def month_progress(txns, today: str) -> dict:
    start = f"{today[:7]}-01"
    year, month = int(today[:4]), int(today[5:7])
    end_day = (datetime(year + (month == 12), 1 if month == 12 else month + 1, 1) - timedelta(days=1)).day
    spent = sum(spend_cents(effective(row)) for row in txns if start <= row["date"] <= today)
    return {
        "label": f"{_format_day(start)}–{int(today[8:10])}",
        "spentCents": spent,
        "planCents": PLAN_CENTS,
        "percent": round(spent / PLAN_CENTS * 100),
        "day": int(today[8:10]),
        "days": end_day,
    }


def _date_label(ymd: str) -> str:
    names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    return f"{names[_date(ymd).weekday()]} {_format_day(ymd)}"


def _category_name(slug):
    found = next((item for item in CATEGORIES if item["slug"] == slug), None)
    return found["name"] if found else (slug or "Uncategorized")


def _meta(row: dict) -> str:
    if row["type"] == "income":
        return f"{_date_label(row['date'])} · Income"
    if row["type"] == "transfer":
        return f"{_date_label(row['date'])} · Transfer"
    if not row["category"]:
        return f"{_date_label(row['date'])} · Uncategorized"
    return f"{_date_label(row['date'])} · {_category_name(row['category'])}"


def overview(txns, now_ms: int, week: str = "", selected: str = "") -> dict:
    today = detroit_ymd(now_ms)
    start = week_start(week) if week and len(week) == 10 else week_start(today)
    if start > week_start(today):
        return {"status": 400, "body": {"detail": "That week has not started.", "field": "week"}}
    chosen = selected if selected in {"1W", "1M", "YTD", "1Y", "All"} else "YTD"
    rows = _rows_in_week(txns, start)
    order = {row_id: index for index, row_id in enumerate(RECENT_IDS)}
    recent = sorted(rows, key=lambda row: (order.get(row["id"], 99), row["date"]))
    return {
        "status": 200,
        "body": {
            "asOf": today,
            "weekStart": start,
            "weekEnd": add_days(start, 6),
            "label": week_label(start, today),
            "current": start == week_start(today),
            "daysLeft": days_left(today, start),
            "previousWeek": add_days(start, -7),
            "nextWeek": None if start == week_start(today) else add_days(start, 7),
            "netWorthCents": NET_WORTH_CENTS,
            "chart": chart_for(txns, today, chosen),
            "month": month_progress(txns, today),
            "caps": caps_for_week(txns, start),
            "recent": [
                {"id": row["id"], "payee": row["payee"], "amountCents": row["amountCents"], "meta": _meta(row), "corrected": row["corrected"]}
                for row in recent
            ],
            "empty": len(rows) == 0,
        },
    }


def category_view(txns, now_ms: int, week: str, category_value: str) -> dict:
    category = next((item for item in CATEGORIES if item["slug"] == category_value or item["name"].lower() == category_value.lower()), None)
    if not category:
        return {"status": 404, "body": {"detail": "That category is not here."}}
    today = detroit_ymd(now_ms)
    start = week_start(week) if week and len(week) == 10 else week_start(today)
    if start > week_start(today):
        return {"status": 400, "body": {"detail": "That week has not started.", "field": "week"}}
    rows = [row for row in _rows_in_week(txns, start) if row["category"] == category["slug"]]
    spent = sum(spend_cents(row) for row in rows)
    return {
        "status": 200,
        "body": {
            **category,
            "spentCents": spent,
            "capCents": category["capCents"],
            **_cap_state(spent, category["capCents"]),
            "weekStart": start,
            "label": week_label(start, today),
            "daysLeft": days_left(today, start),
            "rows": [
                {"id": row["id"], "payee": row["payee"], "amountCents": row["amountCents"], "meta": f"{_date_label(row['date'])} · {category['name']}", "corrected": row["corrected"]}
                for row in rows
            ],
        },
    }


def public_transactions(txns):
    shown = []
    for row in txns:
        item = effective(row)
        shown.append(
            {
                "id": item["id"],
                "payee": item["payee"],
                "amountCents": item["amountCents"],
                "date": item["date"],
                "category": item["category"],
                "type": item["type"],
                "corrected": item["corrected"],
            }
        )
    return shown
