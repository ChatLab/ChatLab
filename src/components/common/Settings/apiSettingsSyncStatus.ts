export interface PullSyncStatus {
  lastStatus: 'idle' | 'success' | 'error'
  lastError: string
}

/**
 * Whether the data-source settings row should render the last pull error text.
 *
 * The error must not depend on `lastPullAt`: a newly subscribed session whose
 * first pull fails keeps its cursor at 0, and the failure reason still has to
 * be visible to the user.
 */
export function shouldShowSyncError(sess: PullSyncStatus, pulling: boolean): boolean {
  return !pulling && sess.lastStatus === 'error' && sess.lastError.length > 0
}
