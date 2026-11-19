import type { CSSProperties, ReactNode } from "react";

const LINE = { 10: 10, 12: 12, 13: 13, 17: 17, 24: 24 } as const;
type LineHeight = keyof typeof LINE;

function bone(style: CSSProperties, className = "") {
  return <span aria-hidden="true" className={`skeleton-bone ${className}`.trim()} style={style} />;
}

export function Block({ width = "100%", height = 16, radius = 8, className = "" }: { width?: number | string; height?: number | string; radius?: number; className?: string }) {
  return bone({ width, height, borderRadius: radius }, className);
}

export function TextLine({ height = 13, width = "40%", className = "" }: { height?: LineHeight; width?: number | string; className?: string }) {
  return bone({ width, height: LINE[height], borderRadius: 6 }, className);
}

export function Circle({ size = 40, className = "" }: { size?: number; className?: string }) {
  return bone({ width: size, height: size, borderRadius: 999 }, `shrink-0 ${className}`.trim());
}

export function CheckBone({ className = "" }: { className?: string }) {
  return bone({ width: 22, height: 22, borderRadius: 6 }, className);
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[20px] border border-line bg-surface ${className}`.trim()}>{children}</div>;
}

export function SkeletonRow() {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4">
      <Circle size={40} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <TextLine height={13} width="46%" />
        <TextLine height={10} width="28%" />
      </span>
      <TextLine height={13} width={64} />
    </div>
  );
}

export function RefreshBar() {
  return (
    <span className="refresh-bar" data-refresh="true" role="progressbar" aria-label="Refreshing">
      <span />
    </span>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="px-5 py-16 text-center" data-state="error">
      <p className="text-body">Couldn't load.</p>
      <button type="button" onClick={onRetry} className="mx-auto mt-6 flex h-11 w-full max-w-[280px] items-center justify-center rounded-2xl bg-ink text-body font-medium text-page">
        Retry
      </button>
    </div>
  );
}

export function OverviewSkeleton() {
  return (
    <div data-skeleton="overview" aria-busy="true" className="px-5 pb-8 pt-5">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <span className="flex flex-col gap-2">
            <TextLine height={12} width={72} />
            <TextLine height={24} width={168} />
            <TextLine height={13} width={112} />
          </span>
          <TextLine height={12} width={36} />
        </div>
      </Card>
      <div className="mt-4 flex gap-1" data-skeleton-pills="5">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} aria-hidden="true" className="skeleton-bone h-11 min-w-0 flex-1 rounded-full" />
        ))}
      </div>
      <Card className="mt-4 p-4">
        <TextLine height={17} width={148} />
        <div className="mt-4 flex items-center justify-between">
          <TextLine height={13} width={72} />
          <TextLine height={13} width={56} />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <TextLine height={13} width={56} />
          <TextLine height={13} width={56} />
        </div>
        <Block height={148} className="mt-4" />
        <div className="mt-4 flex items-center justify-between">
          <TextLine height={12} width={64} />
          <TextLine height={13} width={56} />
        </div>
      </Card>
      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between">
          <TextLine height={13} width={120} />
          <TextLine height={12} width={72} />
        </div>
        <TextLine height={24} width={96} className="mt-3" />
        <TextLine height={12} width={180} className="mt-3" />
        <Block height={10} radius={999} className="mt-4" />
      </Card>
    </div>
  );
}

function BreakdownBone() {
  return (
    <div className="flex min-h-11 items-center gap-3 px-1 py-3">
      <Circle size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="skeleton-bone block h-[1.40625rem] w-[42%] rounded-md" />
          <span className="skeleton-bone block h-[1.40625rem] w-14 shrink-0 rounded-md" />
        </span>
        <span className="skeleton-bone mt-1 block h-3 w-24 rounded-md" />
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full">
          <span className="skeleton-bone block h-full w-full rounded-full" />
        </span>
      </span>
      <span aria-hidden="true" className="h-4 w-4 shrink-0" />
    </div>
  );
}

export function SpendingSkeleton() {
  return (
    <div data-skeleton="spending" aria-busy="true" className="pb-8">
      <div className="px-5 pt-5">
        <Card className="p-4">
          <TextLine height={13} width={120} />
          <TextLine height={24} width={96} className="mt-3" />
          <TextLine height={12} width={160} className="mt-3" />
        </Card>
      </div>
      <ul className="mt-4 px-4">
        <li><BreakdownBone /></li>
        <li><BreakdownBone /></li>
        <li><BreakdownBone /></li>
        <li><BreakdownBone /></li>
      </ul>
      <div className="mt-2 flex h-11 items-end gap-4 overflow-hidden px-5">
        <TextLine height={13} width={32} />
        <TextLine height={13} width={84} />
        <TextLine height={13} width={72} />
      </div>
      <div className="mt-4 px-5">
        <TextLine height={17} width={120} />
      </div>
      <div className="mt-2">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </div>
  );
}

export function MonthSkeleton() {
  return (
    <div className="mt-6" data-skeleton="month">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <TextLine height={13} width={120} />
          <TextLine height={12} width={72} />
        </div>
        <TextLine height={24} width={96} className="mt-3" />
        <TextLine height={12} width={180} className="mt-3" />
        <Block height={10} radius={999} className="mt-4" />
      </Card>
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div data-skeleton="home" aria-busy="true" className="px-4 pb-8 pt-2">
      <div className="flex items-start justify-between px-1">
        <span className="flex flex-col gap-2">
          <TextLine height={12} width={120} />
          <TextLine height={24} width={168} />
        </span>
        <Circle size={40} />
      </div>
      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between">
          <TextLine height={13} width={72} />
          <TextLine height={12} width={24} />
        </div>
        <div className="mt-3 flex gap-3">
          <Block width={72} height={64} />
          <Block width={72} height={64} />
          <Block width={72} height={64} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Circle size={28} />
          <TextLine height={13} width="46%" />
          <TextLine height={13} width={48} />
        </div>
        <Block height={40} radius={12} className="mt-3" />
      </Card>
      <Card className="mt-3 p-4">
        <TextLine height={13} width={88} />
        <TextLine height={17} width="55%" className="mt-3" />
        <TextLine height={12} width="40%" className="mt-2" />
        <Block height={10} radius={999} className="mt-4" />
      </Card>
      <Card className="mt-3 p-4">
        <TextLine height={13} width={64} />
        <div className="mt-3 flex gap-4">
          <Block width={64} height={56} />
          <Block width={64} height={56} />
          <Block width={64} height={56} />
        </div>
      </Card>
    </div>
  );
}

export function BillsSkeleton() {
  return (
    <div data-skeleton="bills" aria-busy="true">
      {["Overdue", "This week", "Later"].map((group) => (
        <div key={group} className="mt-5">
          <TextLine height={17} width={96} className="mx-5" />
          <Card className="mx-4 mt-2 py-1">
            <SkeletonRow />
            <SkeletonRow />
          </Card>
        </div>
      ))}
    </div>
  );
}

export function JobsSkeleton() {
  return (
    <div data-skeleton="jobs" aria-busy="true" className="px-4 pt-4">
      <div className="grid grid-cols-3 gap-2.5">
        {[0, 1, 2].map((item) => (
          <Card key={item} className="p-3">
            <TextLine height={12} width="70%" />
            <TextLine height={24} width="50%" className="mt-2" />
          </Card>
        ))}
      </div>
      <div className="mt-4 space-y-2.5">
        {[0, 1, 2, 3].map((item) => (
          <Card key={item} className="flex min-h-[52px] items-center gap-3 p-3">
            <Circle size={40} />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <TextLine height={13} width="60%" />
              <TextLine height={10} width="40%" />
            </span>
            <TextLine height={13} width={48} />
          </Card>
        ))}
      </div>
    </div>
  );
}

export function JournalSkeleton() {
  return (
    <div data-skeleton="journal" aria-busy="true" className="px-4 pt-4">
      <Card className="p-4">
        <div className="flex items-start justify-between">
          <TextLine height={24} width={80} />
          <TextLine height={13} width={72} />
        </div>
        <div className="mt-4 flex justify-between">
          {Array.from({ length: 7 }, (_, index) => (
            <Circle key={index} size={32} />
          ))}
        </div>
      </Card>
      {[0, 1, 2].map((item) => (
        <Card key={item} className="mt-3 p-4">
          <TextLine height={13} width="40%" />
          <TextLine height={13} width="90%" className="mt-3" />
          <TextLine height={13} width="75%" className="mt-2" />
        </Card>
      ))}
    </div>
  );
}

export function TasksSkeleton() {
  return (
    <div data-skeleton="tasks" aria-busy="true" className="mt-3 space-y-3 px-4">
      {[0, 1, 2, 3].map((item) => (
        <Card key={item} className="flex min-h-[52px] items-center gap-3 p-3">
          <CheckBone />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <TextLine height={13} width="70%" />
            <TextLine height={10} width="45%" />
          </span>
          <TextLine height={10} width={56} />
        </Card>
      ))}
    </div>
  );
}

export function GrocerySkeleton() {
  return (
    <div data-skeleton="grocery" aria-busy="true" className="px-4 pt-2">
      {[0, 1].map((section) => (
        <div key={section} className="mt-4">
          <TextLine height={17} width={88} className="mx-1" />
          <div className="mt-2 space-y-2">
            {[0, 1].map((item) => (
              <Card key={item} className="flex min-h-[52px] items-center gap-3 px-2">
                <CheckBone />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <TextLine height={13} width="55%" />
                  <TextLine height={10} width="30%" />
                </span>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GoalsSkeleton({ wide = false }: { wide?: boolean }) {
  const inset = wide ? "" : "px-5";
  return (
    <div data-skeleton="goals" aria-busy="true">
      <div className={inset}>
        <TextLine height={13} width={72} />
      </div>
      <div className={`mt-2.5 space-y-2.5 ${inset}`}>
        {[0, 1, 2].map((index) => (
          <Card key={index} className="flex min-h-11 items-center gap-4 p-4">
            <Circle size={72} />
            <span className="flex min-w-0 flex-1 flex-col">
              <TextLine height={17} width={140} />
              <TextLine height={13} width={108} className="mt-2" />
              <TextLine height={13} width={168} className="mt-2" />
            </span>
          </Card>
        ))}
      </div>
      <div className={`mt-3 ${inset}`}>
        <TextLine height={13} width={96} />
      </div>
    </div>
  );
}

export function AccountsSkeleton({ wide = false }: { wide?: boolean }) {
  const inset = wide ? "" : "mx-4";
  return (
    <div data-skeleton="accounts" aria-busy="true">
      <Card className={`${inset} mt-3 p-4`}>
        <TextLine height={12} width={72} />
        <TextLine height={24} width={180} className="mt-3" />
        <div className="mt-4 flex gap-8">
          <span className="flex flex-col gap-2">
            <TextLine height={10} width={48} />
            <TextLine height={17} width={88} />
          </span>
          <span className="flex flex-col gap-2">
            <TextLine height={10} width={64} />
            <TextLine height={17} width={88} />
          </span>
        </div>
      </Card>
      <div className={`${inset} mt-5`}>
        <TextLine height={17} width={88} />
        <Card className="mt-2 py-1">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </Card>
      </div>
    </div>
  );
}
