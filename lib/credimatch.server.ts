const CREDIMATCH_API_BASE = "https://api.credimatch.co.il";
const DEFAULT_TOKEN_TTL_MS = 5 * 60_000;
const MAX_RESPONSE_BYTES = 512_000;

type CrediMatchConfiguration = {
  username: string;
  password: string;
  reportId: string;
  apiKey: string;
};

type TokenCache = {
  token: string;
  expiresAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __crediMatchTokenCache: TokenCache | undefined;
  // eslint-disable-next-line no-var
  var __crediMatchAuthentication: Promise<TokenCache> | undefined;
}

export class CrediMatchConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrediMatchConfigurationError";
  }
}

export class CrediMatchApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CrediMatchApiError";
    this.status = status;
  }
}

const safePathSegment = (value: string, label: string) => {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(normalized)) {
    throw new CrediMatchConfigurationError(`${label}_INVALID`);
  }
  return normalized;
};

export function getCrediMatchConfiguration(): CrediMatchConfiguration {
  const username = process.env.CREDIMATCH_USERNAME?.trim();
  const password = process.env.CREDIMATCH_PASSWORD;
  const reportId = process.env.CREDIMATCH_ID?.trim();
  const apiKey = process.env.x_cm_api_key;
  const missing = [
    ["CREDIMATCH_USERNAME", username],
    ["CREDIMATCH_PASSWORD", password],
    ["CREDIMATCH_ID", reportId],
    ["x_cm_api_key", apiKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new CrediMatchConfigurationError(`CREDIMATCH_ENV_MISSING:${missing.join(",")}`);
  return {
    username: username!,
    password: password!,
    reportId: safePathSegment(reportId!, "CREDIMATCH_ID"),
    apiKey: apiKey!,
  };
}

const tokenExpiry = (token: string, response: Record<string, unknown>) => {
  const now = Date.now();
  const expiresIn = Number(response.expiresIn ?? response.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 60) return now + (expiresIn * 1_000) - 60_000;
  const [, payload] = token.split(".");
  if (payload) {
    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
      const expiry = Number(parsed.exp) * 1_000;
      if (Number.isFinite(expiry) && expiry > now + 60_000) return expiry - 60_000;
    } catch {
      // Opaque tokens are valid too; a 401 response also forces re-authentication.
    }
  }
  return now + DEFAULT_TOKEN_TTL_MS;
};

const readJsonResponse = async (response: Response) => {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new CrediMatchApiError("CREDIMATCH_RESPONSE_TOO_LARGE", response.status);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CrediMatchApiError("CREDIMATCH_INVALID_JSON", response.status);
  }
};

async function authenticate(): Promise<TokenCache> {
  const configuration = getCrediMatchConfiguration();
  const response = await fetch(`${CREDIMATCH_API_BASE}/authentication/authenticate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-cm-api-key": configuration.apiKey,
    },
    body: JSON.stringify({ username: configuration.username, password: configuration.password }),
    cache: "no-store",
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new CrediMatchApiError(`CREDIMATCH_AUTH_FAILED_${response.status}`, response.status);
  const token = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).token
    : undefined;
  if (typeof token !== "string" || !token) throw new CrediMatchApiError("CREDIMATCH_AUTH_TOKEN_MISSING", response.status);
  return { token, expiresAt: tokenExpiry(token, payload as Record<string, unknown>) };
}

async function accessToken(forceRefresh = false) {
  if (forceRefresh) globalThis.__crediMatchTokenCache = undefined;
  const cached = globalThis.__crediMatchTokenCache;
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (!globalThis.__crediMatchAuthentication) {
    globalThis.__crediMatchAuthentication = authenticate()
      .then((result) => {
        globalThis.__crediMatchTokenCache = result;
        return result;
      })
      .finally(() => {
        globalThis.__crediMatchAuthentication = undefined;
      });
  }
  return (await globalThis.__crediMatchAuthentication).token;
}

const externalIdentifier = (value: string, label: string) => {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) throw new CrediMatchApiError(`${label}_INVALID`);
  return normalized;
};

async function reportRequest(action: "discrepancies" | "transactions", queryKey: "discrepancyId" | "transactionId", identifier: string) {
  const configuration = getCrediMatchConfiguration();
  const url = new URL(`/reports/${encodeURIComponent(configuration.reportId)}/${action}`, CREDIMATCH_API_BASE);
  url.searchParams.set(queryKey, externalIdentifier(identifier, queryKey));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await accessToken(attempt === 1);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "x-cm-api-key": configuration.apiKey,
      },
      cache: "no-store",
    });
    if (response.status === 401 && attempt === 0) continue;
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new CrediMatchApiError(`CREDIMATCH_REQUEST_FAILED_${response.status}`, response.status);
    return payload;
  }
  throw new CrediMatchApiError("CREDIMATCH_AUTH_RETRY_FAILED", 401);
}

export const getCrediMatchDiscrepancy = (discrepancyId: string) =>
  reportRequest("discrepancies", "discrepancyId", discrepancyId);

export const getCrediMatchTransaction = (transactionId: string) =>
  reportRequest("transactions", "transactionId", transactionId);
