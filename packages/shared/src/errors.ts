/** A non-2xx response; `code` is the body's `error`. */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message = `${status} ${code}`) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The session is gone: sign in again. Pending events must be kept. */
export class AuthError extends ApiError {
  constructor(code = 'unauthenticated') {
    super(401, code);
    this.name = 'AuthError';
  }
}

/** The request never got a response. */
export class NetworkError extends Error {
  constructor(message = 'network request failed', options?: ErrorOptions) {
    super(message, options);
    this.name = 'NetworkError';
  }
}
