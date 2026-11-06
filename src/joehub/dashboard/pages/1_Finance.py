"""Finance page. Dark, card-based, and meant to be readable on a phone."""

from __future__ import annotations

import datetime as dt

import streamlit as st

from joehub.actions import perform
from joehub.dashboard.common import flash, form_token, h, open_db, require_auth, rotate_token
from joehub.errors import ValidationError
from joehub.money import dollars_to_cents, format_cents
from joehub.queries import account_balances, accounts, budgets_with_spend, categories, goals, recent_transactions

st.set_page_config(page_title="Finance", page_icon="◉", layout="centered", initial_sidebar_state="collapsed")
require_auth()

st.title("Finance")
st.caption("Balances are the sum of integer-cent transactions.")

conn = open_db()
try:
    balances = account_balances(conn)
    recent = recent_transactions(conn)
    budget_rows = budgets_with_spend(conn)
    goal_rows = goals(conn)
    account_rows = accounts(conn)
    category_rows = categories(conn)
finally:
    conn.close()

net = sum(int(row["balance_cents"]) for row in balances)
st.markdown(
    f"<div class='jh-hero'><div class='jh-label'>Net</div><div class='jh-value'>{format_cents(net)}</div></div>",
    unsafe_allow_html=True,
)

if not balances:
    st.info("No accounts yet. Seed synthetic data or add one from the inspector.")
for row in balances:
    st.markdown(
        f"""
        <div class='jh-card'>
          <div class='jh-row'>
            <div>
              <div class='jh-title'>{h(row['name'])}</div>
              <div class='jh-muted'>{h(row['account_type'])}</div>
            </div>
            <div class='{"jh-pos" if row["balance_cents"] >= 0 else "jh-neg"}'>{format_cents(int(row["balance_cents"]))}</div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

st.subheader("Recent")
if not recent:
    st.caption("No transactions yet.")
for row in recent:
    amount = int(row["amount_cents"])
    label = h(row["payee"] or row["category_name"] or "Transaction")
    detail = h(" · ".join(part for part in (row["date"], row["account_name"], row["category_name"]) if part))
    st.markdown(
        f"""
        <div class='jh-card'>
          <div class='jh-row'>
            <div>
              <div class='jh-title'>{label}</div>
              <div class='jh-muted'>{detail}</div>
            </div>
            <div class='{"jh-pos" if amount >= 0 else "jh-neg"}'>{format_cents(amount)}</div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

if budget_rows:
    st.subheader("Budgets")
    for row in budget_rows:
        spent = int(row["spent_cents"])
        limit = int(row["amount_cents"])
        st.markdown(
            f"<div class='jh-card'><div class='jh-row'><span>{h(row['name'])}</span>"
            f"<span>{format_cents(spent)} / {format_cents(limit)}</span></div>"
            f"<div class='jh-muted'>{h(row['category_name'])} · {h(row['period'])}</div></div>",
            unsafe_allow_html=True,
        )
        if limit > 0:
            st.progress(min(spent / limit, 1.0))

if goal_rows:
    st.subheader("Goals")
    for row in goal_rows:
        current = int(row["current_cents"])
        target = int(row["target_cents"])
        st.markdown(
            f"<div class='jh-card'><div class='jh-row'><span>{h(row['name'])}</span>"
            f"<span class='jh-pill'>{h(row['status'])}</span></div>"
            f"<div class='jh-muted'>{format_cents(current)} of {format_cents(target)}</div></div>",
            unsafe_allow_html=True,
        )
        if target > 0:
            st.progress(min(current / target, 1.0))

st.subheader("Add transaction")
if not account_rows:
    st.caption("Add an account before recording a transaction.")
else:
    account_labels = {row["id"]: row["name"] for row in account_rows}
    category_labels = {"none": "(none)"} | {row["id"]: row["name"] for row in category_rows}
    goal_labels = {"none": "(none)"} | {row["id"]: row["name"] for row in goal_rows}
    with st.form("add-transaction"):
        account_id = st.selectbox("Account", list(account_labels), format_func=lambda key: account_labels[key])
        category_id = st.selectbox("Category", list(category_labels), format_func=lambda key: category_labels[key])
        goal_id = st.selectbox("Goal", list(goal_labels), format_func=lambda key: goal_labels[key])
        amount = st.text_input("Amount (dollars)", placeholder="-12.34")
        when = st.date_input("Date", value=dt.date.today())
        payee = st.text_input("Payee")
        memo = st.text_input("Memo")
        submitted = st.form_submit_button("Save transaction")
    if submitted:
        token = form_token("transaction")
        try:
            payload = {
                "account_id": account_id,
                "amount_cents": dollars_to_cents(amount),
                "date": when.isoformat(),
                "payee": payee or None,
                "memo": memo or None,
            }
            if category_id != "none":
                payload["category_id"] = category_id
            if goal_id != "none":
                payload["goal_id"] = goal_id
        except ValidationError as exc:
            st.error(str(exc))
        else:
            _result, err = perform(
                table="transactions",
                operation="insert",
                payload=payload,
                idempotency_key=token,
            )
            if err:
                st.error(err)
                rotate_token("transaction")
            else:
                rotate_token("transaction")
                flash("Transaction saved")
                st.rerun()
