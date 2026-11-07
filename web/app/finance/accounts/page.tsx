import Link from "next/link";
import { FinanceTabs } from "../../../components/FinanceTabs";

export default function AccountsPage() {
  return (
    <div>
      <p className="px-5 text-ui-13 mut">Finance</p>
      <h1 className="px-5 text-ui-22 font-bold">Accounts</h1>
      <FinanceTabs />
      <div className="mx-4 mt-4 card p-4">
        <p className="text-ui-13 font-semibold text-finance-primary">Not designed yet</p>
        <p className="mt-2 text-ui-14">
          Accounts is a Finance section, not another app tab. This screen is not designed yet and it is not working. Nothing is saved.
        </p>
      </div>
      <p className="mt-4 px-5">
        <Link href="/finance" className="text-ui-14 font-semibold text-finance-primary">
          Back to overview
        </Link>
      </p>
    </div>
  );
}
