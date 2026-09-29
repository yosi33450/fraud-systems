import https from "node:https";

const CREDIMATCH_API_BASE = "https://api.credimatch.co.il";
const DEFAULT_TOKEN_TTL_MS = 5 * 60_000;
const MAX_RESPONSE_BYTES = 512_000;
const MAX_DIAGNOSTIC_BODY_CHARS = 4_000;
const REQUEST_TIMEOUT_MS = 20_000;

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

type CrediMatchTransport = (input: string | URL, init?: RequestInit) => Promise<Response>;

declare global {
  // eslint-disable-next-line no-var
  var __crediMatchTokenCache: TokenCache | undefined;
  // eslint-disable-next-line no-var
  var __crediMatchAuthentication: Promise<TokenCache> | undefined;
  // Test seam. Production deliberately uses node:https because CrediMatch returns
  // an empty 500 response to Node's fetch/Undici request fingerprint.
  // eslint-disable-next-line no-var
  var __crediMatchTransport: CrediMatchTransport | undefined;
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

const diagnosticHeaders = (headers: Headers) => {
  const names = ["content-type", "date", "server", "via", "cf-ray", "x-request-id", "x-correlation-id", "traceparent"];
  return Object.fromEntries(names.flatMap((name) => {
    const value = headers.get(name);
    return value ? [[name, value]] : [];
  }));
};

const redactDiagnosticValue = (value: unknown, secrets: string[], depth = 0): unknown => {
  if (depth > 5) return "[MAX_DEPTH]";
  if (typeof value === "string") {
    let redacted = value;
    for (const secret of secrets) {
      if (secret) redacted = redacted.split(secret).join("[REDACTED]");
    }
    redacted = redacted.replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
    redacted = redacted.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]");
    return redacted.slice(0, MAX_DIAGNOSTIC_BODY_CHARS);
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactDiagnosticValue(item, secrets, depth + 1));
  if (value && typeof value === "object") {
    const sensitiveKey = /password|pass|token|secret|api.?key|authorization|credential/i;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redactDiagnosticValue(item, secrets, depth + 1),
    ]));
  }
  return value;
};

const diagnosticBody = (text: string, secrets: string[]) => {
  if (!text) return null;
  try {
    return redactDiagnosticValue(JSON.parse(text), secrets);
  } catch {
    return redactDiagnosticValue(text, secrets);
  }
};

const nodeHttpsTransport: CrediMatchTransport = (input, init = {}) => new Promise((resolve, reject) => {
  const url = input instanceof URL ? input : new URL(input);
  const headers = new Headers(init.headers);
  const body = typeof init.body === "string" ? init.body : undefined;
  if (init.body && body === undefined) {
    reject(new TypeError("CREDIMATCH_BODY_TYPE_UNSUPPORTED"));
    return;
  }
  if (body !== undefined && !headers.has("Content-Length")) {
    headers.set("Content-Length", String(Buffer.byteLength(body, "utf8")));
  }
  if (!headers.has("Accept")) headers.set("Accept", "*/*");
  if (!headers.has("User-Agent")) headers.set("User-Agent", "fraud-systems/1.0");

  const request = https.request(url, {
    method: init.method ?? "GET",
    headers: Object.fromEntries(headers.entries()),
    timeout: REQUEST_TIMEOUT_MS,
  }, (incoming) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    incoming.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        request.destroy(new CrediMatchApiError("CREDIMATCH_RESPONSE_TOO_LARGE", incoming.statusCode));
        return;
      }
      chunks.push(buffer);
    });
    incoming.on("end", () => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
        else if (value !== undefined) responseHeaders.set(name, String(value));
      }
      resolve(new Response(Buffer.concat(chunks), {
        status: incoming.statusCode ?? 500,
        statusText: incoming.statusMessage,
        headers: responseHeaders,
      }));
    });
  });
  request.on("timeout", () => request.destroy(new Error("CREDIMATCH_REQUEST_TIMEOUT")));
  request.on("error", reject);
  request.end(body);
});

const crediMatchTransport: CrediMatchTransport = (input, init) =>
  globalThis.__crediMatchTransport?.(input, init) ?? nodeHttpsTransport(input, init);

async function authenticate(): Promise<TokenCache> {
  const configuration = getCrediMatchConfiguration();
  const url = `${CREDIMATCH_API_BASE}/authentication/authenticate`;
  const attemptId = crypto.randomUUID();
  const startedAt = Date.now();
  console.info(JSON.stringify({
    level: "info",
    message: "CrediMatch authentication request",
    attemptId,
    method: "POST",
    url,
    headerNames: ["Content-Type", "x-cm-api-key"],
    credentials: {
      usernamePresent: Boolean(configuration.username),
      usernameLength: configuration.username.length,
      passwordPresent: Boolean(configuration.password),
      passwordLength: configuration.password.length,
      apiKeyPresent: Boolean(configuration.apiKey),
      apiKeyLength: configuration.apiKey.length,
    },
  }));

  let response: Response;
  try {
    response = await crediMatchTransport(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cm-api-key": configuration.apiKey,
      },
      body: JSON.stringify({ username: configuration.username, password: configuration.password }),
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      message: "CrediMatch authentication network failure",
      attemptId,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    }));
    throw new CrediMatchApiError("CREDIMATCH_AUTH_NETWORK_FAILED");
  }

  const responseText = await response.text();
  if (Buffer.byteLength(responseText, "utf8") > MAX_RESPONSE_BYTES) {
    throw new CrediMatchApiError("CREDIMATCH_RESPONSE_TOO_LARGE", response.status);
  }
  const secrets = [configuration.username, configuration.password, configuration.apiKey];
  const responseLog = {
    level: response.ok ? "info" : "error",
    message: "CrediMatch authentication response",
    attemptId,
    durationMs: Date.now() - startedAt,
    status: response.status,
    statusText: response.statusText,
    headers: diagnosticHeaders(response.headers),
    bodyBytes: Buffer.byteLength(responseText, "utf8"),
    body: response.ok ? undefined : diagnosticBody(responseText, secrets),
  };
  if (response.ok) console.info(JSON.stringify(responseLog));
  else console.error(JSON.stringify(responseLog));

  let payload: unknown = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText) as unknown;
    } catch {
      throw new CrediMatchApiError("CREDIMATCH_INVALID_JSON", response.status);
    }
  }
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
    const response = await crediMatchTransport(url, {
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
