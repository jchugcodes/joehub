"""Shared Streamlit chrome: auth gate, mobile styles, flash messages."""

from __future__ import annotations

import uuid
from html import escape

import streamlit as st

from joehub.auth import load_password_hash, verify_password
from joehub.config import load_settings
from joehub.db import connect, migrate
from joehub.errors import AuthConfigError

CSS = """
<style>
section.main > div { max-width: 720px; }
.block-container { padding-top: 1rem; padding-left: 0.85rem; padding-right: 0.85rem; }
div.stButton > button, div.stFormSubmitButton > button {
  width: 100%;
  min-height: 44px;
  border-radius: 12px;
}
.jh-hero {
  background: linear-gradient(180deg, #173024 0%, #12161b 70%);
  border-radius: 20px;
  padding: 22px 18px 18px;
  margin-bottom: 14px;
}
.jh-label {
  color: #9aa39c;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.jh-value {
  font-size: 2.5rem;
  font-weight: 650;
  letter-spacing: -0.04em;
  line-height: 1.1;
  margin-top: 4px;
}
.jh-card {
  background: #151a20;
  border-radius: 16px;
  padding: 14px 16px;
  margin-bottom: 10px;
}
.jh-row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.jh-title { font-weight: 600; }
.jh-pos { color: #00c805; font-variant-numeric: tabular-nums; font-weight: 650; }
.jh-neg { color: #ff5a5a; font-variant-numeric: tabular-nums; font-weight: 650; }
.jh-muted { color: #9aa39c; font-size: 0.85rem; }
.jh-pill {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 8px;
  background: #1e2a22;
  color: #b7f5c2;
  font-size: 0.75rem;
}
</style>
"""


def h(value: object) -> str:
    return escape("" if value is None else str(value))


def inject_css() -> None:
    st.markdown(CSS, unsafe_allow_html=True)


def show_flash() -> None:
    message = st.session_state.pop("flash", None)
    if message:
        st.success(message)


def flash(message: str) -> None:
    st.session_state["flash"] = message


def require_auth() -> None:
    inject_css()
    if st.session_state.get("joehub_auth") is True:
        show_flash()
        if st.sidebar.button("Lock"):
            st.session_state["joehub_auth"] = False
            st.rerun()
        return
    st.title("joehub")
    st.caption("Personal data hub. The app binds to localhost and does not ship credentials.")
    try:
        stored = load_password_hash()
    except AuthConfigError as exc:
        st.error(str(exc))
        st.stop()
    with st.form("unlock"):
        password = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Unlock")
    if submitted:
        if password and verify_password(password, stored):
            st.session_state["joehub_auth"] = True
            st.rerun()
        st.error("Wrong password")
    st.stop()


def open_db():
    settings = load_settings()
    migrate(settings.db_path)
    return connect(settings.db_path)


def form_token(name: str) -> str:
    key = f"idem_{name}"
    if key not in st.session_state:
        st.session_state[key] = str(uuid.uuid4())
    return st.session_state[key]


def rotate_token(name: str) -> None:
    st.session_state[f"idem_{name}"] = str(uuid.uuid4())
