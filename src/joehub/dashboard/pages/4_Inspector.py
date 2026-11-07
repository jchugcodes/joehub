"""Sortable, filterable view of every table. Edits use the write layer."""

from __future__ import annotations

import streamlit as st

from joehub.actions import coerce_form_value, editable_field_names, perform
from joehub.dashboard.common import (
    flash,
    form_token,
    open_db,
    require_auth,
    rotate_token,
    session_credential,
)
from joehub.db import list_tables, table_columns
from joehub.errors import ValidationError
from joehub.queries import inspect_table, pending_delete
from joehub.registry import TABLES

st.set_page_config(page_title="Inspector", page_icon="◉", layout="centered", initial_sidebar_state="collapsed")
require_auth()

st.title("Inspector")
st.caption("Every table. Domain edits and deletes go through the single-writer queue.")

conn = open_db()
try:
    tables = list_tables(conn)
    table = st.selectbox("Table", tables)
    search = st.text_input("Filter")
    column_names = [row["name"] for row in table_columns(conn, table)]
    sort = st.selectbox("Sort", column_names)
    descending = st.checkbox("Descending")
    rows = inspect_table(conn, table, search=search or None, sort=sort, descending=descending)
    editable = editable_field_names(table)
finally:
    conn.close()

st.dataframe(rows, use_container_width=True, hide_index=True)
st.caption(f"{len(rows)} row(s)")

if table not in TABLES:
    st.info("Meta tables are read-only here. The write layer does not accept Ledger, Scout, or Cato writes to them.")
    st.stop()

if not rows:
    st.caption("Nothing to edit in this table.")
    st.stop()

labels = {row["id"]: row["id"] for row in rows}
selected_id = st.selectbox("Row", list(labels))
selected = next(row for row in rows if row["id"] == selected_id)

st.subheader("Edit row")
with st.form("edit-row"):
    drafts = {}
    for name in editable:
        current = selected.get(name)
        drafts[name] = st.text_input(name, value="" if current is None else str(current))
    submitted = st.form_submit_button("Save changes")
if submitted:
    token = form_token("inspector-edit")
    payload: dict = {"id": selected_id}
    try:
        for name, raw in drafts.items():
            new_value = coerce_form_value(table, name, raw)
            current = selected.get(name)
            if new_value != current:
                payload[name] = new_value
    except ValidationError as exc:
        st.error(str(exc))
    else:
        if len(payload) == 1:
            st.info("No changes to save.")
        else:
            _result, err = perform(
                credential=session_credential(),
                table=table,
                operation="update",
                payload=payload,
                idempotency_key=token,
            )
            if err:
                st.error(err)
                rotate_token("inspector-edit")
            else:
                rotate_token("inspector-edit")
                flash("Row updated")
                st.rerun()

st.subheader("Delete")
st.caption("Hard delete is two steps. Only this table's owner can request it, and the same owner confirms.")
conn = open_db()
try:
    pending = pending_delete(conn, table, selected_id)
finally:
    conn.close()
if pending:
    st.warning("A delete is pending confirmation.")
if st.button("Request delete"):
    _result, err = perform(
        credential=session_credential(),
        table=table,
        operation="delete_request",
        payload={"id": selected_id},
        idempotency_key=form_token("inspector-delete-request"),
    )
    rotate_token("inspector-delete-request")
    if err:
        st.error(err)
    else:
        flash("Delete requested")
        st.rerun()
if pending and st.button("Confirm delete"):
    _result, err = perform(
        credential=session_credential(),
        table=table,
        operation="delete_confirm",
        payload={"id": selected_id},
        idempotency_key=form_token("inspector-delete-confirm"),
    )
    rotate_token("inspector-delete-confirm")
    if err:
        st.error(err)
    else:
        flash("Row deleted")
        st.rerun()
