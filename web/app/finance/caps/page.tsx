import Link from "next/link";
import { finance } from "../../../lib/design-fixtures";

export default function CapsPlaceholderPage() {
  return (
    <div>
      <p className="px-5 text-ui-13 mut">Finance</p>
      <h1 className="px-5 text-ui-22 font-bold">Edit caps</h1>
      <div className="mx-4 mt-4 card p-4">
        <p className="text-ui-13 font-semibold text-finance-primary">Not designed yet</p>
        <p className="mt-2 text-ui-14">
          This will be one editor for all six weekly caps. It is not designed yet and it is not working. Nothing is saved.
        </p>
        <ul className="mt-3 space-y-1 text-ui-14">
          {finance.caps.map((cap) => (
            <li key={cap.name}>{cap.name}</li>
          ))}
        </ul>
      </div>
      <p className="mt-4 px-5">
        <Link href="/finance" className="text-ui-14 font-semibold text-finance-primary">
          Back to Finance
        </Link>
      </p>
    </div>
  );
}
