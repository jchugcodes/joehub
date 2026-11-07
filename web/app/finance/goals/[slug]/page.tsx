import Link from "next/link";
import { notFound } from "next/navigation";
import { goals } from "../../../../lib/design-fixtures";

export function generateStaticParams() {
  return goals.map((goal) => ({ slug: goal.slug }));
}

export default async function GoalDetailPlaceholderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const goal = goals.find((item) => item.slug === slug);
  if (!goal) notFound();
  return (
    <div>
      <p className="px-5 text-ui-13 mut">Finance · Goals</p>
      <h1 className="px-5 text-ui-22 font-bold">{goal.name}</h1>
      <div className="mx-4 mt-4 card p-4">
        <p className="text-ui-13 font-semibold text-finance-primary">Not designed yet</p>
        <p className="mt-2 text-ui-14">
          Goal detail stays inside Finance and is read-only. This screen is not designed yet and it is not working. Nothing is saved.
        </p>
        <p className="mt-3 text-ui-14 mut">{goal.detail}</p>
        <p className="mt-1 text-ui-15 font-semibold tnum">{goal.progress}</p>
      </div>
      <p className="mt-4 px-5">
        <Link href="/finance/goals" className="text-ui-14 font-semibold text-finance-primary">
          Back to Goals
        </Link>
      </p>
    </div>
  );
}
