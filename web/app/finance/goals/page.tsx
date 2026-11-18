import { Suspense } from "react";
import { FinanceGoals } from "../../../components/FinanceGoals";
import { store } from "../../../lib/store.mjs";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  try {
    const goals = await store.financeGoals();
    return (
      <Suspense fallback={null}>
        <FinanceGoals goals={Array.isArray(goals) ? goals : []} />
      </Suspense>
    );
  } catch {
    return (
      <Suspense fallback={null}>
        <FinanceGoals goals={null} failed />
      </Suspense>
    );
  }
}
