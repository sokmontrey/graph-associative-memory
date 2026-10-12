import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollapsibleSection({
  title,
  description,
  badge,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={cn("rounded-lg border border-border bg-background/60", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left cursor-pointer"
      >
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground flex-1">
          {title}
        </span>
        {badge}
        <ChevronDown
          className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {description && !open && (
        <div className="px-3 pb-2 text-xs text-muted-foreground truncate">{description}</div>
      )}
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </div>
  );
}
