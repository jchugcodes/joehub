# FN-7 bucket management

Categories are the buckets. Hide, rename, add, and remove live on the Spending tab, behind the existing Spending gate. No new go-live flag.

## Remove

Removing a bucket clears that category on its transactions, including a correction or ledger overlay that still names it. The spend stays in the ledger and shows as Uncategorized. The month total does not change, because uncategorized spend still counts. The bucket itself is kept as a removed tombstone on the categories document so the seed list cannot recreate it. Adding the same name later reuses that slug and starts empty. The old transactions stay Uncategorized.

## Hide

`hidden: true` stays on the category document. A hidden bucket drops out of:

- the Spending month total, plan, category bars, and month transaction list
- the Spending week total and category bars
- the overview month spent and plan
- the overview week caps
- the current period of the overview income and spent charts
- the weekly spend chart, when that chart is built from transactions

Show puts the same cap and the same spend back. The net-worth chart is account history, so hiding a bucket does not move it. The weekly caps editor still lists a hidden bucket, so the envelope can still balance, and Show restores that cap in the spending totals.

## Stores

The same edits go to Upstash and to libSQL when `JOEHUB_BACKEND_FINANCE=sqlite`. Hidden and removed live on the categories JSON. No migration. A removed bucket is left out of the box category rows, and its transactions are stored with no category.

Rename keeps the slug. A new name that matches another live bucket is rejected. Create uses an Idempotency-Key and replays the first 201.

## Shots

Synthetic seed only. 390 and 1280.

- `390-totals-before.png`, `1280-totals-before.png` — month total before hiding Groceries
- `390-bucket-list-hidden.png`, `1280-bucket-list-hidden.png` — Groceries marked Hidden
- `390-totals-after.png`, `1280-totals-after.png` — Groceries gone from the total, the plan, and the bars
- `390-rename.png`, `1280-rename.png` — rename sheet
- `390-add.png`, `1280-add.png` — add sheet
- `390-remove.png`, `1280-remove.png` — remove confirm, transactions move to Uncategorized
