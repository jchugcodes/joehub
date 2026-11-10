import { FinanceTabs } from "../../../components/FinanceTabs";

export default function CapsPage() {
  return (
    <main className="finance-type min-w-0 text-ink">
      <header className="px-5 pt-2">
        <p className="text-meta text-muted">joehub</p>
        <h1 className="text-title font-medium">Caps</h1>
      </header>
      <div className="mt-3">
        <FinanceTabs />
      </div>
      <p className="px-5 py-6 text-body text-muted">Weekly caps are on Overview.</p>
    </main>
  );
}
