interface WorkerSqlResultLike {
  limited?: boolean
  truncated?: boolean
}

export function adaptWorkerSqlResult<T extends WorkerSqlResultLike>(result: T): T & { truncated?: boolean } {
  return {
    ...result,
    truncated: result.truncated ?? result.limited,
  }
}
