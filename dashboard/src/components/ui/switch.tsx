import * as React from "react";
import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange">) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-primary justify-end" : "bg-input justify-start",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow ring-0 transition-transform mx-0.5",
          checked ? "bg-primary-foreground" : "bg-foreground/70"
        )}
      />
    </button>
  );
}
