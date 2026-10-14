/** Turns an HTTP or SDK error into a message an Access360 user can act on. */
export function describe(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status: unknown }).status);
    if (status === 401 || status === 403) {
      return 'Access360 refused the request. Sign in to Access360 again.';
    }
    if (status === 0) {
      return 'Access360 could not be reached. Check your network connection.';
    }
    return fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
