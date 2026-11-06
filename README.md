# joehub

Personal data hub for finance (Ledger), job search (Scout), and a journal (Cato).

The database, encrypted exports, and keys stay outside this repository. Seed data is fictional. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for install, tests, export, restore, and the dashboard. See [docs/SCHEMA.md](docs/SCHEMA.md) for tables and write rules.

```bash
python -m pip install -e ".[dev]"
pytest
python scripts/seed_synthetic.py
python scripts/hash_password.py
python scripts/run_dashboard.py
```

The dashboard listens on `127.0.0.1:8501`.
