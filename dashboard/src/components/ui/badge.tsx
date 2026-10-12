import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive/15 text-destructive border-destructive/30",
        outline: "text-foreground border-border",
        success: "border-transparent bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
        warning: "border-transparent bg-amber-500/15 text-amber-500 border-amber-500/30",
        info: "border-transparent bg-sky-500/15 text-sky-500 border-sky-500/30",
        violet: "border-transparent bg-violet-500/15 text-violet-400 border-violet-500/30",
        teal: "border-transparent bg-teal-500/15 text-teal-400 border-teal-500/30",
        orange: "border-transparent bg-orange-500/15 text-orange-400 border-orange-500/30",
      },
    },
    defaultVariants: { variant: "secondary" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
