"use client";

import { useParams } from "next/navigation";
import { FinanceDebts } from "../../../../components/FinanceDebts";

export default function DebtDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  return <FinanceDebts selectedId={id} />;
}
