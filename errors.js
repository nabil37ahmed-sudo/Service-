// A small typed error so the route layer can map failures to the right
// HTTP status and a clear, human-readable message — never a raw provider
// error or stack trace, and never a secret key.

class AppError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode || AppError.defaultStatusFor(code);
  }

  static defaultStatusFor(code) {
    switch (code) {
      case 'INVALID_IMAGE':
      case 'IMAGE_TOO_LARGE':
        return 400;
      case 'FACE_NOT_DETECTED':
      case 'MULTIPLE_FACES':
        return 422;
      case 'RATE_LIMITED':
        return 429;
      case 'PROVIDER_NOT_CONFIGURED':
      case 'PREVIEW_NOT_CONFIGURED':
      case 'PREVIEW_NOT_IMPLEMENTED':
        return 503;
      case 'PROVIDER_TIMEOUT':
      case 'NETWORK_ERROR':
        return 504;
      case 'PROVIDER_AUTH_FAILED':
      case 'PROVIDER_ERROR':
      case 'PROVIDER_UNAVAILABLE':
      case 'PREVIEW_GENERATION_FAILED':
        return 502;
      default:
        return 500;
    }
  }

  toJSON() {
    return { error: this.code, message: this.message };
  }
}

module.exports = { AppError };
