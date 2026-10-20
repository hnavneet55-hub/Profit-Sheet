"use client";

import { useActionState } from "react";
import { importSheet, type SheetImportState } from "../../actions";

export function ImportForm({ stores }: { stores: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState<SheetImportState, FormData>(importSheet, null);
  return (
    <form action={action} className="card max-w-2xl space-y-3 p-5">
      <h2 className="text-sm font-medium">Upload a profit sheet</h2>
      <div>
        <label className="label" htmlFor="file">Sheet (Excel with one tab per store, or a CSV)</label>
        <input id="file" type="file" name="file" required accept=".xlsx,.xls,.csv" className="input" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="storeId">Store</label>
          <select id="storeId" name="storeId" className="input" defaultValue="">
            <option value="">Every tab named after a store</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="year">Year of the data (if the sheet shows the wrong year)</label>
          <input id="year" name="year" className="input" inputMode="numeric" placeholder="e.g. 2026" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="expenses" defaultChecked /> Add the sheet&apos;s Services and Employee costs as business expenses
      </label>
      <button className="btn" disabled={pending}>{pending ? "Importing… (converting currencies, this can take a minute)" : "Import"}</button>

      {state?.error && <p className="text-sm text-negative">{state.error}</p>}
      {state?.results.map((r) => (
        <p key={r.store} className="text-sm">
          ✓ <span className="font-medium">{r.store}</span>: {r.from} to {r.to} · ad spend on {r.adSpendDays} days
          {r.adSpendSkipped > 0 && ` (${r.adSpendSkipped} days already entered by hand, kept)`} · cost of goods on {r.cogsDays} days
          {r.cogsMissingDays > 0 && `, ${r.cogsMissingDays} days with sales but no cost in the sheet`}
          {r.expenses > 0 && ` · ${r.expenses} expenses`}
        </p>
      ))}
      {state && !state.error && !state.results.length && <p className="text-sm text-warn-text">No tab matched a store. Choose the store, or name the tabs like the stores.</p>}
      {state?.unmatched.length ? <p className="text-sm text-warn-text">Not imported (no store with that name yet): {state.unmatched.join(", ")}</p> : null}
    </form>
  );
}
