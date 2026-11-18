import { Suspense } from "react";
import { FinanceGoals } from "../../../../components/FinanceGoals";
import { store } from "../../../../lib/store.mjs";

export const dynamic = "force-dynamic";

export default async function GoalDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const goals = await store.financeGoals();
    return (
      <Suspense fallback={null}>
        <FinanceGoals goals={Array.isArray(goals) ? goals : []} slug={slug} />
      </Suspense>
    );
  } catch {
    return (
      <Suspense fallback={null}>
        <FinanceGoals goals={null} slug={slug} failed />
      </Suspense>
    );
  }
}
