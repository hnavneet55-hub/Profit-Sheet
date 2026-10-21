import { cookies } from "next/headers";
import { Nav } from "@/components/nav";
import { logout, toggleMenu } from "../actions";

// Every page reads live data; never prerender at build time.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // "Hide menu" gives the sheets the whole screen; remembered per browser.
  const hidden = (await cookies()).get("ps_menu")?.value === "hidden";
  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      {hidden ? (
        <form action={toggleMenu} className="border-b border-border px-2 py-2 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
          <button className="btn-ghost px-2" title="Show the menu" aria-label="Show the menu">☰</button>
        </form>
      ) : (
        <aside className="border-b border-border px-4 py-4 md:sticky md:top-0 md:h-screen md:w-52 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
          <div className="mb-4 flex items-center justify-between px-3">
            <span className="text-sm font-semibold">Profit Sheet</span>
            <form action={toggleMenu} className="hidden md:block">
              <button className="text-xs text-muted hover:text-text" title="Hide the menu to use the whole screen">« Hide</button>
            </form>
          </div>
          <Nav />
          {process.env.DASHBOARD_PASSWORD && (
            <form action={logout} className="mt-4 hidden md:block">
              <button className="px-3 text-xs text-muted hover:text-text">Sign out</button>
            </form>
          )}
        </aside>
      )}
      <main className="min-w-0 flex-1 px-4 py-6 md:px-6">{children}</main>
    </div>
  );
}
