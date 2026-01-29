/**
 * Error classification utility for Twitter DIY scraper
 * Categorizes errors to determine retry behavior
 */

export enum TwitterErrorType {
  SESSION = 'session',
  TIMEOUT = 'timeout',
  NETWORK = 'network',
  PARSING = 'parsing',
  UNKNOWN = 'unknown',
}

/**
 * Classify error type from error message or object
 */
export function classifyError(error: any): TwitterErrorType {
  const message = (error?.message || '').toLowerCase();
  const stderr = (error?.stderr || '').toLowerCase();
  const combined = `${message} ${stderr}`;

  // Session/authentication errors
  if (
    combined.includes('session') ||
    combined.includes('auth') ||
    combined.includes('expired') ||
    combined.includes('login') ||
    combined.includes('unauthorized') ||
    combined.includes('forbidden') ||
    combined.includes('401') ||
    combined.includes('403')
  ) {
    return TwitterErrorType.SESSION;
  }

  // Timeout errors
  if (
    combined.includes('timeout') ||
    combined.includes('timedout') ||
    combined.includes('timed out')
  ) {
    return TwitterErrorType.TIMEOUT;
  }

  // Network errors
  if (
    combined.includes('network') ||
    combined.includes('connection') ||
    combined.includes('econnrefused') ||
    combined.includes('econnreset') ||
    combined.includes('enotfound') ||
    combined.includes('socket hang up') ||
    combined.includes('connect etimedout')
  ) {
    return TwitterErrorType.NETWORK;
  }

  // Parsing errors
  if (
    combined.includes('json') ||
    combined.includes('parse') ||
    combined.includes('syntaxerror') ||
    combined.includes('unexpected token')
  ) {
    return TwitterErrorType.PARSING;
  }

  return TwitterErrorType.UNKNOWN;
}

/**
 * Check if error type is retryable
 * Only timeout and network errors should be retried
 */
export function isRetryableError(type: TwitterErrorType): boolean {
  return type === TwitterErrorType.TIMEOUT || type === TwitterErrorType.NETWORK;
}

/**
 * Get human-readable error description
 */
export function getErrorDescription(type: TwitterErrorType): string {
  switch (type) {
    case TwitterErrorType.SESSION:
      return 'Twitter session expired or invalid. Please refresh cookies.';
    case TwitterErrorType.TIMEOUT:
      return 'Request timed out. Will retry if attempts remain.';
    case TwitterErrorType.NETWORK:
      return 'Network error. Will retry if attempts remain.';
    case TwitterErrorType.PARSING:
      return 'Failed to parse response. The scraper may need updating.';
    case TwitterErrorType.UNKNOWN:
      return 'Unknown error occurred.';
    default:
      return 'Unexpected error.';
  }
}
