/**
 * Error-monitoring readiness (Phase 20) — same interface + swappable
 * default pattern as LogoStorage/WhatsAppService: one place decides
 * where an unexpected (500-class) error goes, so wiring in a real
 * error-monitoring service (Sentry, Rollbar, ...) later is "implement
 * this interface and change getErrorReporter()", not a change to every
 * call site. No monitoring SDK is bundled here — keeps this dependency-
 * light until a real production target actually needs one.
 */
export interface ErrorContext {
  requestId: string;
  method: string;
  path: string;
}

export interface ErrorReporter {
  report(err: unknown, context: ErrorContext): void;
}

/** Structured single-line JSON to stderr — safe to ship to any log aggregator without extra parsing config. */
class ConsoleErrorReporter implements ErrorReporter {
  report(err: unknown, context: ErrorContext): void {
    console.error(
      JSON.stringify({
        level: 'error',
        ...context,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
  }
}

let instance: ErrorReporter | undefined;

export function getErrorReporter(): ErrorReporter {
  instance ??= new ConsoleErrorReporter();
  return instance;
}
