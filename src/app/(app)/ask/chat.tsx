"use client";

import { useState, useTransition } from "react";
import { askQuestion } from "../../actions";

type Turn = { role: "user" | "assistant"; content: string; queries?: string[] };

const EXAMPLES = [
  "How many refunds did we have in the last 14 days, and for how much?",
  "Which products got the most returns this month?",
  "Which store had the best POAS last week?",
  "Which products have no cost of goods yet?",
];

// Minimal markdown: tables, bold and line breaks are what the answers use.
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const lines = b.trim().split("\n");
        if (lines.length >= 2 && lines[0].includes("|") && /^\s*\|?\s*:?-+/.test(lines[1])) {
          const cells = (l: string) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
          return (
            <div key={i} className="overflow-x-auto">
              <table className="table num">
                <thead><tr>{cells(lines[0]).map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
                <tbody>{lines.slice(2).map((l, k) => <tr key={k}>{cells(l).map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        return <p key={i} className="whitespace-pre-wrap">{inline(b)}</p>;
      })}
    </div>
  );
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
    part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part,
  );
}

export function AskChat({ hasKey }: { hasKey: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();

  function send(question: string) {
    if (!question.trim() || pending) return;
    const next: Turn[] = [...turns, { role: "user", content: question.trim() }];
    setTurns(next);
    setInput("");
    start(async () => {
      const res = await askQuestion(next.map(({ role, content }) => ({ role, content })));
      setTurns([...next, { role: "assistant", content: res.answer, queries: res.queries }]);
    });
  }

  if (!hasKey) {
    return <div className="rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn-text">Set <code>ANTHROPIC_API_KEY</code> to use Ask.</div>;
  }

  return (
    <div className="space-y-4">
      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} className="btn-ghost text-left" onClick={() => send(e)}>{e}</button>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ml-auto max-w-2xl rounded-lg bg-accent-soft px-4 py-2 text-sm">{t.content}</div>
          ) : (
            <div key={i} className="card max-w-4xl px-4 py-3 text-sm">
              <Markdown text={t.content} />
              {!!t.queries?.length && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted">How this was calculated ({t.queries.length} quer{t.queries.length === 1 ? "y" : "ies"})</summary>
                  {t.queries.map((q, j) => (
                    <pre key={j} className="mt-2 overflow-x-auto rounded bg-bg p-2 text-xs">{q}</pre>
                  ))}
                </details>
              )}
            </div>
          ),
        )}
        {pending && <div className="text-sm text-muted">Claude is looking at the data…</div>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} className="input" placeholder="e.g. What was our refund rate per store in September?" />
        <button className="btn" disabled={pending || !input.trim()}>Ask</button>
        {turns.length > 0 && <button type="button" className="btn-ghost" onClick={() => setTurns([])}>New</button>}
      </form>
    </div>
  );
}
