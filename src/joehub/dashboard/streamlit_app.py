"""joehub home. Run with scripts/run_dashboard.py so the server binds to localhost."""

from __future__ import annotations

import streamlit as st

from joehub.dashboard.common import open_db, require_auth
from joehub.money import format_cents
from joehub.queries import domain_counts, net_worth_cents

st.set_page_config(page_title="joehub", page_icon="◉", layout="centered", initial_sidebar_state="collapsed")
require_auth()

st.title("joehub")
st.caption("Ledger, Scout, and Cato. Edits on every page go through the hall-pass write layer.")

conn = open_db()
try:
    counts = domain_counts(conn)
    net = net_worth_cents(conn)
finally:
    conn.close()

st.markdown(
    f"<div class='jh-hero'><div class='jh-label'>Net</div><div class='jh-value'>{format_cents(net)}</div></div>",
    unsafe_allow_html=True,
)
st.markdown(
    f"""
    <div class='jh-card'><div class='jh-row'><span>Transactions</span><span>{counts['transactions']}</span></div></div>
    <div class='jh-card'><div class='jh-row'><span>Applications</span><span>{counts['applications']}</span></div></div>
    <div class='jh-card'><div class='jh-row'><span>Journal entries</span><span>{counts['journal_entries']}</span></div></div>
    <div class='jh-card'><div class='jh-row'><span>Events</span><span>{counts['events']}</span></div></div>
    """,
    unsafe_allow_html=True,
)
st.caption("Open Finance, Jobs, Journal, or the database inspector from the sidebar.")
