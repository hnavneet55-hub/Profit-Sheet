import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { expensesByDay } from "@/lib/expenses";
import { addDays, today } from "@/lib/dates";
import { money, monthLabel } from "@/lib/format";
import { BASE_CURRENCY } from "@/lib/config";
import { addExpense, deleteExpense, stopExpense } from "../../actions";

const CATEGORIES = ["Staff salary", "Software", "Services", "Agency", "Office", "Other"];

export default async function ExpensesPage() {
  const db = await getDb();
  const rows = await db.select().from(schema.expenses).orderBy(desc(schema.expenses.monthly), desc(schema.expenses.date)).limit(300);
  // Totals for the last six months, monthly costs included.
  const from = `${addDays(today(), -150).slice(0, 7)}-01`;
  const byMonth = new Map<string, number>();
  for (const [d, amount] of await expensesByDay(from, today())) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) ?? 0) + amount);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Business expenses</h1>
        <p className="text-sm text-muted">Costs of the business as a whole (salaries, software, services). They are taken off the whole-business profit, not off any one store.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[...byMonth].sort().map(([m, amount]) => (
          <div key={m} className="card px-4 py-3">
            <div className="text-xs text-muted">{monthLabel(m)}</div>
            <div className="num mt-1 text-lg font-semibold">{money(amount, BASE_CURRENCY)}</div>
          </div>
        ))}
      </section>

      <form action={addExpense} className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="label" htmlFor="category">Category</label>
            <input id="category" name="category" className="input" list="categories" defaultValue="Staff salary" required />
            <datalist id="categories">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="lg:col-span-2">
            <label className="label" htmlFor="description">Description</label>
            <input id="description" name="description" className="input" placeholder="e.g. Customer support (Anna), Shopify apps" />
          </div>
          <div>
            <label className="label" htmlFor="amount">Amount</label>
            <input id="amount" name="amount" className="input" inputMode="decimal" required />
          </div>
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <input id="currency" name="currency" className="input uppercase" maxLength={3} defaultValue={BASE_CURRENCY} required />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="date">Date (first payment, for monthly costs)</label>
            <input id="date" name="date" type="date" className="input" defaultValue={today()} required />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" name="monthly" /> Repeats every month
          </label>
          <div>
            <label className="label" htmlFor="until">Until (optional, monthly only)</label>
            <input id="until" name="until" type="date" className="input" />
          </div>
        </div>
        <button className="btn">Add expense</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="table num">
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th className="text-right">Amount</th><th>Repeats</th><th></th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td>{e.category}</td>
                <td className="text-muted">{e.description}</td>
                <td className="text-right">{money(e.amount, e.currency)}</td>
                <td>{e.monthly ? (e.until ? `monthly until ${e.until}` : "monthly") : ""}</td>
                <td className="whitespace-nowrap">
                  {e.monthly && !e.until && (
                    <form action={stopExpense} className="mr-3 inline">
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="until" value={today()} />
                      <button className="text-xs text-muted hover:text-text">Stop from today</button>
                    </form>
                  )}
                  <form action={deleteExpense} className="inline">
                    <input type="hidden" name="id" value={e.id} />
                    <button className="text-xs text-muted hover:text-negative">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="py-8 text-center text-muted">No expenses yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
