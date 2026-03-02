import type { ReactNode } from "react";

export function AppLayout({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full">
      <aside className="w-[260px] flex-shrink-0 border-r border-border bg-bg-secondary flex flex-col">
        {sidebar}
      </aside>
      <main className="flex-1 flex flex-col min-w-0 bg-bg-primary">{children}</main>
    </div>
  );
}
