/**
 * ChatLab API — Error codes and factory functions
 */

export enum ApiErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  INVALID_FORMAT = 'INVALID_FORMAT',
  INVALID_PAYLOAD = 'INVALID_PAYLOAD',
  SQL_READONLY_VIOLATION = 'SQL_READONLY_VIOLATION',
  SQL_EXECUTION_ERROR = 'SQL_EXECUTION_ERROR',
  EXPORT_TOO_LARGE = 'EXPORT_TOO_LARGE',
  BODY_TOO_LARGE = 'BODY_TOO_LARGE',
  IMPORT_IN_PROGRESS = 'IMPORT_IN_PROGRESS',
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  IMPORT_FAILED = 'IMPORT_FAILED',
  SERVER_ERROR = 'SERVER_ERROR',
}

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  [ApiErrorCode.UNAUTHORIZED]: 401,
  [ApiErrorCode.SESSION_NOT_FOUND]: 404,
  [ApiErrorCode.INVALID_FORMAT]: 400,
  [ApiErrorCode.INVALID_PAYLOAD]: 400,
  [ApiErrorCode.SQL_READONLY_VIOLATION]: 400,
  [ApiErrorCode.SQL_EXECUTION_ERROR]: 400,
  [ApiErrorCode.EXPORT_TOO_LARGE]: 400,
  [ApiErrorCode.BODY_TOO_LARGE]: 413,
  [ApiErrorCode.IMPORT_IN_PROGRESS]: 409,
  [ApiErrorCode.IDEMPOTENCY_CONFLICT]: 409,
  [ApiErrorCode.IMPORT_FAILED]: 500,
  [ApiErrorCode.SERVER_ERROR]: 500,
}

export class ApiError extends Error {
  code: ApiErrorCode
  statusCode: number

  constructor(code: ApiErrorCode, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = HTTP_STATUS[code]
  }
}

export function unauthorized(message = 'Invalid or missing token'): ApiError {
  return new ApiError(ApiErrorCode.UNAUTHORIZED, message)
}

export function sessionNotFound(id: string): ApiError {
  return new ApiError(ApiErrorCode.SESSION_NOT_FOUND, `Session not found: ${id}`)
}

export function invalidFormat(message: string): ApiError {
  return new ApiError(ApiErrorCode.INVALID_FORMAT, message)
}

export function invalidPayload(message: string): ApiError {
  return new ApiError(ApiErrorCode.INVALID_PAYLOAD, message)
}

export function idempotencyConflict(): ApiError {
  return new ApiError(ApiErrorCode.IDEMPOTENCY_CONFLICT, 'Same Idempotency-Key with different request body hash')
}

export function sqlReadonlyViolation(): ApiError {
  return new ApiError(ApiErrorCode.SQL_READONLY_VIOLATION, 'Only SELECT queries are allowed')
}

export function sqlExecutionError(message: string): ApiError {
  return new ApiError(ApiErrorCode.SQL_EXECUTION_ERROR, message)
}

export function exportTooLarge(count: number, limit: number): ApiError {
  return new ApiError(
    ApiErrorCode.EXPORT_TOO_LARGE,
    `Message count ${count} exceeds export limit ${limit}. Use paginated /messages API instead.`
  )
}

export function importInProgress(): ApiError {
  return new ApiError(ApiErrorCode.IMPORT_IN_PROGRESS, 'An import operation is already in progress')
}

export function importFailed(message: string): ApiError {
  return new ApiError(ApiErrorCode.IMPORT_FAILED, message)
}

export function serverError(message = 'Internal server error'): ApiError {
  return new ApiError(ApiErrorCode.SERVER_ERROR, message)
}

export function successResponse<T>(data: T, meta?: Record<string, unknown>) {
  return {
    success: true as const,
    data,
    meta: {
      timestamp: Math.floor(Date.now() / 1000),
      version: '0.0.2',
      ...meta,
    },
  }
}

export function errorResponse(error: ApiError) {
  return {
    success: false as const,
    error: {
      code: error.code,
      message: error.message,
    },
  }
}
