export type ErrorCode =
  | 'INVALID_NAME'
  | 'INVALID_PATH'
  | 'DUPLICATE_NAME'
  | 'NOT_FOUND'
  | 'LIMIT_EXCEEDED'
  | 'ZIP_INVALID'
  | 'ZIP_TOO_LARGE'
  | 'QUOTA_EXCEEDED'
  | 'STORAGE_UNAVAILABLE'
  | 'CORRUPT_DATA'
  | 'INVALID_REGEX'
  | 'UNSUPPORTED_RUNTIME'
  | 'UNSUPPORTED_DEPENDENCY'
  | 'BUILD_FAILED'
  | 'NO_ENTRY'
  | 'TIMEOUT';

/** Structured, user-presentable error. `details` is for the developer, never contains user file contents. */
export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AppError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: ErrorCode, message: string, details?: string): Result<T> {
  return { ok: false, error: details === undefined ? { code, message } : { code, message, details } };
}

export function isQuotaError(cause: unknown): boolean {
  return cause instanceof DOMException && (cause.name === 'QuotaExceededError' || cause.code === 22);
}
