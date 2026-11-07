"""Job search page owned by Scout."""

from __future__ import annotations

import datetime as dt

import streamlit as st

from joehub.actions import perform
from joehub.dashboard.common import (
    flash,
    form_token,
    h,
    open_db,
    require_auth,
    rotate_token,
    session_credential,
)
from joehub.queries import applications, companies, contacts, status_counts
from joehub.registry import APPLICATION_STATUSES

st.set_page_config(page_title="Jobs", page_icon="◉", layout="centered", initial_sidebar_state="collapsed")
require_auth()

st.title("Jobs")
st.caption("Company and contact links are set only from an explicit id or one exact name match.")

conn = open_db()
try:
    rows = applications(conn)
    counts = status_counts(conn)
    company_rows = companies(conn)
    contact_rows = contacts(conn)
finally:
    conn.close()

if counts:
    summary = " · ".join(f"{row['status']} {row['total']}" for row in counts)
    st.markdown(f"<div class='jh-card'>{summary}</div>", unsafe_allow_html=True)
else:
    st.caption("No applications yet.")

for row in rows:
    company = h(row["company_name"] or row["raw_company"] or "Unlinked company")
    bits = [row["status"]]
    if row["applied_on"]:
        bits.append(str(row["applied_on"]))
    if row["raw_source"]:
        bits.append(str(row["raw_source"]))
    st.markdown(
        f"""
        <div class='jh-card'>
          <div class='jh-title'>{h(row['role_title'])}</div>
          <div class='jh-muted'>{company}</div>
          <div class='jh-pill' style='margin-top:8px'>{h(" · ".join(bits))}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

st.subheader("Add application")
company_labels = {"none": "(no company id)"} | {row["id"]: row["name"] for row in company_rows}
contact_labels = {"none": "(no contact id)"} | {row["id"]: row["name"] for row in contact_rows}
with st.form("add-application"):
    role_title = st.text_input("Role")
    status = st.selectbox("Status", APPLICATION_STATUSES, index=1)
    raw_company = st.text_input("Company (raw)")
    raw_contact = st.text_input("Contact (raw)")
    raw_status = st.text_input("Status (raw)")
    raw_source = st.text_input("Source (raw)")
    company_id = st.selectbox("Link company", list(company_labels), format_func=lambda key: company_labels[key])
    contact_id = st.selectbox("Link contact", list(contact_labels), format_func=lambda key: contact_labels[key])
    applied_on = st.date_input("Applied on", value=None)
    notes = st.text_area("Notes")
    submitted = st.form_submit_button("Save application")
if submitted:
    token = form_token("application")
    if not role_title.strip():
        st.error("Role is required")
    else:
        payload = {
            "role_title": role_title.strip(),
            "status": status,
            "raw_company": raw_company or None,
            "raw_contact": raw_contact or None,
            "raw_status": raw_status or None,
            "raw_source": raw_source or None,
            "notes": notes or None,
            "event_kind": "transition",
        }
        if company_id != "none":
            payload["company_id"] = company_id
        if contact_id != "none":
            payload["contact_id"] = contact_id
        if applied_on:
            payload["applied_on"] = applied_on.isoformat() if isinstance(applied_on, dt.date) else str(applied_on)
        _result, err = perform(
            credential=session_credential(),
            table="applications",
            operation="insert",
            payload=payload,
            idempotency_key=token,
        )
        if err:
            st.error(err)
            rotate_token("application")
        else:
            rotate_token("application")
            flash("Application saved")
            st.rerun()

if rows:
    st.subheader("Update status")
    labels = {row["id"]: f"{row['role_title']} ({row['status']})" for row in rows}
    with st.form("update-status"):
        application_id = st.selectbox("Application", list(labels), format_func=lambda key: labels[key])
        new_status = st.selectbox("New status", APPLICATION_STATUSES)
        status_submitted = st.form_submit_button("Record transition")
    if status_submitted:
        token = form_token("application-status")
        _result, err = perform(
            credential=session_credential(),
            table="applications",
            operation="update",
            payload={"id": application_id, "status": new_status, "event_kind": "transition"},
            idempotency_key=token,
        )
        if err:
            st.error(err)
            rotate_token("application-status")
        else:
            rotate_token("application-status")
            flash("Status recorded")
            st.rerun()
