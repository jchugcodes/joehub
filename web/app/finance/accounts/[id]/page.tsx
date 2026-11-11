"use client";

import { useParams } from "next/navigation";
import { FinanceAccounts } from "../../../../components/FinanceAccounts";

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  return <FinanceAccounts selectedId={id} />;
}
