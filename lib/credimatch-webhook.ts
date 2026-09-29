const CREDIMATCH_HOST = "api.credimatch.co.il";
const MAX_EVENTS = 50;
const MAX_PATHS_PER_EVENT = 100;

export class CrediMatchWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrediMatchWebhookValidationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function discrepancyIdFromCrediMatchPath(path: string) {
  if (path.length > 2_048) throw new CrediMatchWebhookValidationError("CREDIMATCH_PATH_TOO_LONG");
  let url: URL;
  try {
    url = new URL(path);
  } catch {
    throw new CrediMatchWebhookValidationError("CREDIMATCH_PATH_INVALID");
  }
  if (url.protocol !== "https:" || url.hostname !== CREDIMATCH_HOST || url.port || url.username || url.password) {
    throw new CrediMatchWebhookValidationError("CREDIMATCH_PATH_ORIGIN_INVALID");
  }
  if (!/^\/reports\/[^/]+\/discrepancies\/?$/.test(url.pathname)) {
    throw new CrediMatchWebhookValidationError("CREDIMATCH_PATH_RESOURCE_INVALID");
  }
  const discrepancyId = url.searchParams.get("discrepancyId")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(discrepancyId)) {
    throw new CrediMatchWebhookValidationError("CREDIMATCH_DISCREPANCY_ID_INVALID");
  }
  return discrepancyId;
}

export function parseCrediMatchWebhook(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.events) || payload.events.length === 0 || payload.events.length > MAX_EVENTS) {
    throw new CrediMatchWebhookValidationError("CREDIMATCH_EVENTS_INVALID");
  }
  const discrepancyIds: string[] = [];
  let ignoredEvents = 0;
  for (const event of payload.events) {
    if (!isRecord(event) || typeof event.name !== "string" || event.name.length > 64 || !Array.isArray(event.paths) || event.paths.length > MAX_PATHS_PER_EVENT) {
      throw new CrediMatchWebhookValidationError("CREDIMATCH_EVENT_INVALID");
    }
    if (!event.paths.every((path) => typeof path === "string")) {
      throw new CrediMatchWebhookValidationError("CREDIMATCH_EVENT_PATHS_INVALID");
    }
    if (event.name !== "chargeback") {
      ignoredEvents += 1;
      continue;
    }
    if (event.paths.length === 0) throw new CrediMatchWebhookValidationError("CREDIMATCH_CHARGEBACK_PATHS_EMPTY");
    discrepancyIds.push(...event.paths.map(discrepancyIdFromCrediMatchPath));
  }
  return { discrepancyIds: [...new Set(discrepancyIds)], ignoredEvents };
}

