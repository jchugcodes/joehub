const warm = new Map();
const WARM_MS = 20_000;

export function accountUrls(id, asOf = "") {
  const accounts = new URLSearchParams();
  if (asOf) accounts.set("asOf", asOf);
  const transactions = new URLSearchParams();
  if (id) transactions.set("accountId", id);
  if (asOf) transactions.set("asOf", asOf);
  return {
    accounts: `/api/finance/accounts${accounts.size ? `?${accounts}` : ""}`,
    transactions: `/api/finance/transactions?${transactions.toString()}`,
  };
}

export function warmGet(url) {
  const hit = warm.get(url);
  if (hit && Date.now() - hit.at < WARM_MS) return hit.promise;
  const promise = fetch(url, { cache: "no-store" }).then(async (response) => {
    const body = await response.json().catch(() => null);
    if (!response.ok || body == null) {
      const error = new Error("finance");
      throw error;
    }
    return body;
  });
  warm.set(url, { at: Date.now(), promise });
  promise.catch(() => {
    if (warm.get(url)?.promise === promise) warm.delete(url);
  });
  return promise;
}

export function prefetchAccount(id, asOf = "") {
  if (!id) return;
  const urls = accountUrls(id, asOf);
  void warmGet(urls.accounts).catch(() => {});
  void warmGet(urls.transactions).catch(() => {});
}
