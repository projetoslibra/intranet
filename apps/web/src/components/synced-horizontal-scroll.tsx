"use client";

import { useEffect, useRef, useState } from "react";
import { synchronizeScrollLeft } from "@/components/dashboard-layout-behavior";
import { cn } from "@/lib/utils";

type SyncedHorizontalScrollProps = {
  children: React.ReactNode;
  className?: string;
  label: string;
};

export function SyncedHorizontalScroll({
  children,
  className,
  label,
}: SyncedHorizontalScrollProps) {
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const tableScroll = tableScrollRef.current;
    if (!tableScroll) return;

    const measure = () => {
      setScrollWidth(tableScroll.scrollWidth);
      setHasOverflow(tableScroll.scrollWidth > tableScroll.clientWidth);
    };

    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(tableScroll);
    const content = tableScroll.firstElementChild;
    if (content) resizeObserver.observe(content);

    return () => resizeObserver.disconnect();
  }, [children]);

  return (
    <div className={className}>
      <div
        aria-label={`Rolagem horizontal superior: ${label}`}
        className={cn(
          "h-5 overflow-x-scroll overflow-y-hidden border-b border-slate-200 bg-slate-50",
          !hasOverflow && "hidden"
        )}
        onScroll={(event) => {
          if (tableScrollRef.current) {
            synchronizeScrollLeft(event.currentTarget, tableScrollRef.current);
          }
        }}
        ref={topScrollRef}
        role="region"
        tabIndex={0}
      >
        <div aria-hidden="true" className="h-px" style={{ width: scrollWidth }} />
      </div>
      <div
        aria-label={label}
        className="overflow-x-auto"
        onScroll={(event) => {
          if (topScrollRef.current) {
            synchronizeScrollLeft(event.currentTarget, topScrollRef.current);
          }
        }}
        ref={tableScrollRef}
        role="region"
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
