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
      <div className="mt-4 flex gap-2">
        <Block width={76} height={44} radius={999} />
        <Block width={76} height={44} radius={999} />
        <Block width={76} height={44} radius={999} />
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
