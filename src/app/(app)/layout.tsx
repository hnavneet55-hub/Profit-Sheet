import { Nav } from "@/components/nav";
import { logout } from "../actions";

// Every page reads live data; never prerender at build time.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col md:flex-row">
      <aside className="border-b border-border px-4 py-4 md:sticky md:top-0 md:h-screen md:w-52 md:shrink-0 md:border-r md:border-b-0">
        <div className="mb-4 px-3 text-sm font-semibold">Profit Sheet</div>
        <Nav />
        {process.env.DASHBOARD_PASSWORD && (
          <form action={logout} className="mt-4 hidden md:block">
            <button className="px-3 text-xs text-muted hover:text-text">Sign out</button>
          </form>
        )}
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
