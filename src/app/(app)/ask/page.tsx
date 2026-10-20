import { AskChat } from "./chat";

export default function AskPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Ask</h1>
        <p className="text-sm text-muted">Ask anything about orders, refunds, products, costs and ad spend. Claude queries the synced store data (read-only) and shows how it got the answer.</p>
      </header>
      <AskChat hasKey={!!process.env.ANTHROPIC_API_KEY} />
    </div>
  );
}
