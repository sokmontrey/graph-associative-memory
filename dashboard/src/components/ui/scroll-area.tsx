import { cn } from "@/lib/utils";

export function ScrollArea({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("nice-scroll min-h-0 overflow-y-auto", className)}>{children}</div>
  );
}
