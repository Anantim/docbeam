export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The API's error code, for example PLATFORM_UNAVAILABLE. */
    readonly code?: string,
    /** The whole error body, for fields such as `notFound` on a DESTINATION_NOT_FOUND. */
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
  }
}
