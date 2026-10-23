import "server-only";
import { SHOPIFY_API_VERSION } from "./config";
import { decrypt } from "./crypto";
import type { schema } from "@/db";

type Store = typeof schema.stores.$inferSelect;

const tokenCache = new Map<number, { token: string; expiresAt: number }>();

async function accessToken(store: Store): Promise<string> {
  if (store.authType === "token") {
    if (!store.accessTokenEnc) throw new Error("No access token saved for this store");
    return decrypt(store.accessTokenEnc);
  }
  const cached = tokenCache.get(store.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (!store.clientId || !store.clientSecretEnc) throw new Error("Client ID or secret missing");

  // Client credentials grant: works for stores in the same Shopify organization as the app.
  const res = await fetch(`https://${store.shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: store.clientId,
      client_secret: decrypt(store.clientSecretEnc),
    }),
  });
  if (!res.ok) {
    // Shopify answers with an HTML error page; keep just its message.
    const body = await res.text();
    const reason = body.match(/Oauth error [^<]+/)?.[0] ?? body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    throw new Error(`Shopify token request failed (${res.status}): ${reason}`);
  }
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(store.id, { token: access_token, expiresAt: Date.now() + expires_in * 1000 });
  return access_token;
}

export async function shopifyGraphql<T>(store: Store, query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://${store.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken(store) },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 4) throw new Error(`Shopify API error ${res.status}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Shopify API error ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
    if (body.errors?.length) {
      if (body.errors.some((e) => e.extensions?.code === "THROTTLED") && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      throw new Error(body.errors.map((e) => e.message).join("; "));
    }
    return body.data as T;
  }
}

type Money = { shopMoney: { amount: string; currencyCode?: string }; presentmentMoney?: { amount: string } };

export type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  test: boolean;
  displayFinancialStatus: string | null;
  currencyCode: string;
  presentmentCurrencyCode: string;
  subtotalPriceSet: Money;
  totalShippingPriceSet: Money;
  totalTaxSet: Money;
  totalPriceSet: Money;
  disputes: { id: string; initiatedAs: string; status: string }[];
  lineItems: { nodes: { id: string; sku: string | null; name: string; quantity: number }[] };
  refunds: {
    id: string;
    createdAt: string;
    totalRefundedSet: Money;
    refundLineItems: {
      nodes: {
        quantity: number;
        restockType: string;
        subtotalSet: Money;
        lineItem: { id: string; sku: string | null; name: string };
      }[];
    };
  }[];
  transactions: {
    id: string;
    kind: string;
    status: string;
    gateway: string | null;
    amountSet: Money;
    fees: { amount: { amount: string; currencyCode: string }; type: string }[];
  }[];
};

export type OrdersPage = {
  shop: { currencyCode: string; ianaTimezone: string };
  orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrder[] };
};

// Validated against Admin GraphQL 2026-07. Needs read_orders (and read_all_orders
// to import orders older than 60 days).
export const ORDERS_QUERY = /* GraphQL */ `
query SyncOrders($first: Int!, $after: String, $query: String) {
  shop { currencyCode ianaTimezone }
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      updatedAt
      cancelledAt
      test
      displayFinancialStatus
      currencyCode
      presentmentCurrencyCode
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } presentmentMoney { amount } }
      totalPriceSet { shopMoney { amount } presentmentMoney { amount } }
      disputes { id initiatedAs status }
      lineItems(first: 100) {
        nodes { id sku name quantity }
      }
      refunds(first: 50) {
        id
        createdAt
        totalRefundedSet { shopMoney { amount } presentmentMoney { amount } }
        refundLineItems(first: 100) {
          nodes { quantity restockType subtotalSet { shopMoney { amount } presentmentMoney { amount } } lineItem { id sku name } }
        }
      }
      transactions(first: 50) {
        id
        kind
        status
        gateway
        amountSet { shopMoney { amount currencyCode } }
        fees { amount { amount currencyCode } type }
      }
    }
  }
}`;

export type DisputesPage = {
  orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; disputes: ShopifyOrder["disputes"] }[] };
};

// Only the disputes of recent orders; used to catch disputes that don't touch an order's updated_at.
export const DISPUTES_QUERY = /* GraphQL */ `
query OrderDisputes($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { id disputes { id initiatedAs status } }
  }
}`;
