"""Journal and events page owned by Cato."""

from __future__ import annotations

import datetime as dt

import streamlit as st

from joehub.actions import perform
from joehub.dashboard.common import flash, form_token, h, open_db, require_auth, rotate_token
from joehub.queries import events, journal_entries

st.set_page_config(page_title="Journal", page_icon="◉", layout="centered", initial_sidebar_state="collapsed")
require_auth()

st.title("Journal")

conn = open_db()
try:
    entries = journal_entries(conn)
    event_rows = events(conn)
finally:
    conn.close()

if not entries:
    st.caption("No journal entries yet.")
for row in entries:
    title = h(row["title"] or "Untitled")
    mood = h(f" · {row['mood']}") if row["mood"] else ""
    st.markdown(
        f"""
        <div class='jh-card'>
          <div class='jh-row'><span class='jh-title'>{title}</span><span class='jh-muted'>{row['entry_date']}{mood}</span></div>
          <div style='margin-top:8px; white-space:pre-wrap'>{h(row['body'])}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

st.subheader("New entry")
with st.form("add-journal"):
    entry_date = st.date_input("Date", value=dt.date.today())
    title = st.text_input("Title")
    body = st.text_area("Body")
    mood = st.text_input("Mood")
    submitted = st.form_submit_button("Save entry")
if submitted:
    token = form_token("journal")
    if not body.strip():
        st.error("Body is required")
    else:
        _result, err = perform(
            table="journal_entries",
            operation="insert",
            payload={
                "entry_date": entry_date.isoformat(),
                "title": title or None,
                "body": body,
                "mood": mood or None,
            },
            idempotency_key=token,
        )
        if err:
            st.error(err)
            rotate_token("journal")
        else:
            rotate_token("journal")
            flash("Entry saved")
            st.rerun()

st.subheader("Events")
if not event_rows:
    st.caption("No events yet.")
for row in event_rows:
    where = f" · {row['location']}" if row["location"] else ""
    st.markdown(
        f"<div class='jh-card'><div class='jh-title'>{h(row['title'])}</div>"
        f"<div class='jh-muted'>{h(row['starts_at'])}{h(where)}</div></div>",
        unsafe_allow_html=True,
    )

with st.form("add-event"):
    event_title = st.text_input("Event title")
    starts = st.text_input("Starts (UTC)", placeholder="2026-05-01T15:00:00Z")
    location = st.text_input("Location")
    notes = st.text_area("Event notes")
    event_submitted = st.form_submit_button("Save event")
if event_submitted:
    token = form_token("event")
    _result, err = perform(
        table="events",
        operation="insert",
        payload={
            "title": event_title,
            "starts_at": starts.strip(),
            "location": location or None,
            "notes": notes or None,
        },
        idempotency_key=token,
    )
    if err:
        st.error(err)
        rotate_token("event")
    else:
        rotate_token("event")
        flash("Event saved")
        st.rerun()
