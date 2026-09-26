// One request at a time; explicit refresh supersedes an in-flight background read.
export function createSnapshotRefresh<T>(options: {
  load: (signal: AbortSignal) => Promise<T>;
  apply: (value: T) => void;
  canRefresh: () => boolean;
  state: (state: "loading" | "live" | "error" | "expired") => void;
}) {
  let active: AbortController | undefined;
  let expired = false;
  let failures = 0;
  let background = false;
  const cancel = () => { active?.abort(); active = undefined; };
  return {
    cancel,
    interrupt: () => { if (background) cancel(); },
    async refresh(quiet = false) {
      if (expired || (quiet && (active || !options.canRefresh()))) return;
      cancel();
      const controller = new AbortController();
      active = controller;
      background = quiet;
      if (!quiet) options.state("loading");
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const value = await options.load(controller.signal);
        if (controller.signal.aborted || active !== controller) return;
        if (quiet && !options.canRefresh()) return;
        failures = 0;
        options.apply(value);
        options.state("live");
      } catch (error) {
        if (active !== controller) return;
        if (error instanceof Error && error.message === "SESSION_EXPIRED") {
          expired = true;
          options.state("expired");
        } else if (!quiet || ++failures >= 3) {
          options.state("error");
        }
      } finally {
        clearTimeout(timeout);
        if (active === controller) active = undefined;
      }
    },
  };
}
