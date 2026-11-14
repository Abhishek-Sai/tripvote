class ApiError extends Error {
  // details: optional extra fields for the client, e.g. which option is a duplicate.
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message) => new ApiError(400, 'invalid_input', message);

module.exports = { ApiError, badRequest };
