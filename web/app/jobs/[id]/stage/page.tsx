"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "../../../../components/Icon";
import { jobDetail } from "../../../../lib/design-fixtures";

export default function StagePage() {
  const params = useParams<{ id: string }>();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (params.id !== jobDetail.id) {
    return (
      <div className="px-5" data-ready={mounted ? "true" : "false"}>
        <Link href="/jobs" className="inline-flex min-h-11 items-center gap-2 font-semibold">
          <Icon name="back" size={22} /> Back to pipeline
        </Link>
        <h1 className="mt-4 text-ui-22 font-bold">No stage screen for this role</h1>
      </div>
    );
  }

  return (
    <div className="min-w-0" data-ready={mounted ? "true" : "false"}>
      <header className="flex items-center gap-3 px-5">
        <Link href="/jobs/globex" className="grid h-11 w-11 place-items-center" aria-label="Back to job">
          <Icon name="back" size={22} />
        </Link>
        <div>
          <p className="text-ui-13 text-muted">Jobs</p>
          <h1 className="text-ui-22 font-bold">Globex</h1>
        </div>
      </header>
      <p className="mt-3 px-5 text-ui-20 font-bold">{jobDetail.title}</p>
      <section className="card mx-4 mt-4 p-4">
        <div className="flex items-center justify-between gap-4 py-3 text-ui-14">
          <span className="text-muted">Current stage</span>
          <span className="text-right font-semibold">{jobDetail.current}</span>
        </div>
        <p className="text-ui-13 text-muted">{jobDetail.round}</p>
      </section>
      <p className="mb-4 mt-6 text-center text-ui-10 text-muted">SYNTHETIC DATA · design reference</p>
    </div>
  );
}
