import { FinanceGoals } from "../../../components/FinanceGoals";
import { store } from "../../../lib/store.mjs";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  try {
    const goals = await store.financeGoals();
    return <FinanceGoals goals={Array.isArray(goals) ? goals : []} />;
  } catch {
    return <FinanceGoals goals={null} failed />;
  }
}
