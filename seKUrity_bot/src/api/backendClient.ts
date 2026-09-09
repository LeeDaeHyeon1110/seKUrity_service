const DEFAULT_TIMEOUT_MS = 2_000;

interface BackendErrorBody {
  code?: string;
  message?: string;
}

export class BackendApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BackendApiError';
  }
}

function getBackendConfig(): {
  baseUrl: string;
  token: string;
} {
  const baseUrl = process.env.BACKEND_API_URL?.trim() || 'http://localhost:3000';
  const token = process.env.BACKEND_API_TOKEN?.trim();

  if (!token) {
    throw new Error('BACKEND_API_TOKEN is required.');
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
  };
}

async function parseError(response: Response): Promise<BackendApiError> {
  let body: BackendErrorBody = {};

  try {
    body = await response.json() as BackendErrorBody;
  } catch {
    // The status code remains enough context when the body is not JSON.
  }

  return new BackendApiError(
    response.status,
    body.code ?? 'BACKEND_REQUEST_FAILED',
    body.message ?? `Backend request failed with status ${response.status}.`,
  );
}

export async function backendRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const config = getBackendConfig();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${config.token}`);
  headers.set('accept', 'application/json');

  if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}
