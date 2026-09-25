const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-07";

export const SHOP_IDENTITY_QUERY = `#graphql
  query ShieldLedgerShopIdentity {
    shop {
      name
      myshopifyDomain
      primaryDomain {
        host
        url
      }
    }
  }
`;

export const CREATE_WEBHOOK_SUBSCRIPTION_MUTATION = `#graphql
  mutation ShieldLedgerWebhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
        topic
        uri
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const WEBHOOK_SUBSCRIPTIONS_QUERY = `#graphql
  query ShieldLedgerWebhookSubscriptions($first: Int!) {
    webhookSubscriptions(first: $first) {
      nodes { id topic uri }
    }
  }
`;

export const ADD_CUSTOMER_TAGS_MUTATION = `#graphql
  mutation ShieldLedgerBlockCustomer($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

export const REMOVE_CUSTOMER_TAGS_MUTATION = `#graphql
  mutation ShieldLedgerUnblockCustomer($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

type GraphqlResponse<T> = { data?: T; errors?: { message: string }[] };

export const normalizeShopDomain = (shopDomain: string) => {
  const domain = shopDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new Error("INVALID_SHOP_DOMAIN");
  return domain;
};

export async function requestOrganizationAccessToken(input: { shopDomain: string; clientId: string; clientSecret: string }) {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: input.clientId.trim(),
      client_secret: input.clientSecret.trim(),
    }),
    cache: "no-store",
  });
  const rawBody = await response.text();
  type TokenPayload = { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  let payload: TokenPayload | null = null;
  try { payload = JSON.parse(rawBody) as TokenPayload; } catch { payload = null; }
  if (!response.ok || !payload?.access_token) {
    const shopifyMessage = `${payload?.error ?? ""} ${payload?.error_description ?? ""} ${rawBody}`.toLowerCase();
    if (shopifyMessage.includes("shop_not_permitted") || shopifyMessage.includes("cannot be performed on this shop")) throw new Error("SHOP_NOT_PERMITTED");
    if (shopifyMessage.includes("invalid_client") || shopifyMessage.includes("invalid client")) throw new Error("INVALID_CLIENT_CREDENTIALS");
    if (shopifyMessage.includes("app_not_installed") || shopifyMessage.includes("not installed")) throw new Error("APP_NOT_INSTALLED");
    if (response.status === 404) throw new Error("SHOP_NOT_FOUND");
    throw new Error(response.status === 400 ? "CREDENTIALS_OR_INSTALLATION_INVALID" : `SHOPIFY_TOKEN_HTTP_${response.status}`);
  }
  return { accessToken: payload.access_token, expiresIn: payload.expires_in ?? 86_399, shopDomain };
}

export async function shopifyAdminRequest<T>(input: {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
}) {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  const response = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": input.accessToken,
    },
    body: JSON.stringify({ query: input.query, variables: input.variables ?? {} }),
    cache: "no-store",
  });
  const payload = await response.json() as GraphqlResponse<T>;
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((error) => error.message).join("; ") || `SHOPIFY_HTTP_${response.status}`);
  }
  if (!payload.data) throw new Error("SHOPIFY_EMPTY_RESPONSE");
  return payload.data;
}

export async function testShopifyConnection(shopDomain: string, accessToken: string) {
  return shopifyAdminRequest<{
    shop: { name: string; myshopifyDomain: string; primaryDomain: { host: string; url: string } };
  }>({ shopDomain, accessToken, query: SHOP_IDENTITY_QUERY });
}

export async function registerOrderWebhook(input: {
  shopDomain: string;
  accessToken: string;
  topic: "ORDERS_CREATE" | "ORDERS_PAID" | "ORDERS_UPDATED" | "REFUNDS_CREATE";
  uri: string;
}) {
  const data = await shopifyAdminRequest<{
    webhookSubscriptionCreate: {
      webhookSubscription: { id: string; topic: string; uri: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: CREATE_WEBHOOK_SUBSCRIPTION_MUTATION,
    variables: { topic: input.topic, webhookSubscription: { uri: input.uri } },
  });
  const result = data.webhookSubscriptionCreate;
  if (result.userErrors.length) throw new Error(result.userErrors.map((error) => error.message).join("; "));
  if (!result.webhookSubscription) throw new Error("WEBHOOK_SUBSCRIPTION_NOT_CREATED");
  return result.webhookSubscription;
}

export async function ensureOrderCreateWebhook(input: { shopDomain: string; accessToken: string; uri: string }) {
  const existing = await shopifyAdminRequest<{
    webhookSubscriptions: { nodes: Array<{ id: string; topic: string; uri: string }> };
  }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: WEBHOOK_SUBSCRIPTIONS_QUERY,
    variables: { first: 100 },
  });
  const subscription = existing.webhookSubscriptions.nodes.find((item) => item.topic === "ORDERS_CREATE" && item.uri === input.uri);
  if (subscription) return { ...subscription, created: false as const };
  const created = await registerOrderWebhook({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    topic: "ORDERS_CREATE",
    uri: input.uri,
  });
  return { ...created, created: true as const };
}

export async function tagBlockedCustomer(input: { shopDomain: string; accessToken: string; customerId: string }) {
  const data = await shopifyAdminRequest<{
    tagsAdd: { node: { id: string } | null; userErrors: Array<{ field: string[] | null; message: string }> };
  }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: ADD_CUSTOMER_TAGS_MUTATION,
    variables: { id: input.customerId, tags: ["shield-ledger-blocked"] },
  });
  if (data.tagsAdd.userErrors.length) throw new Error(data.tagsAdd.userErrors.map((error) => error.message).join("; "));
  if (!data.tagsAdd.node) throw new Error("CUSTOMER_TAG_NOT_ADDED");
  return data.tagsAdd.node;
}

export async function untagBlockedCustomer(input: { shopDomain: string; accessToken: string; customerId: string }) {
  const data = await shopifyAdminRequest<{
    tagsRemove: { node: { id: string } | null; userErrors: Array<{ field: string[] | null; message: string }> };
  }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: REMOVE_CUSTOMER_TAGS_MUTATION,
    variables: { id: input.customerId, tags: ["shield-ledger-blocked"] },
  });
  if (data.tagsRemove.userErrors.length) throw new Error(data.tagsRemove.userErrors.map((error) => error.message).join("; "));
  if (!data.tagsRemove.node) throw new Error("CUSTOMER_TAG_NOT_REMOVED");
  return data.tagsRemove.node;
}
