const { badRequest } = require('./errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

// Trims and checks a required text field's length.
function requiredText(value, field, max) {
  if (typeof value !== 'string') throw badRequest(`${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw badRequest(`${field} must be 1-${max} characters`);
  }
  return trimmed;
}

// Optional deadline: an ISO 8601 date-time with a timezone, in the future (FR-28).
function optionalFutureDeadline(value, now = new Date()) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw badRequest('deadline must be an ISO 8601 date-time with a timezone, e.g. 2026-12-01T18:00:00Z');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest('deadline is not a valid date-time');
  if (date <= now) throw badRequest('deadline must be in the future');
  return date.toISOString();
}

module.exports = { isUuid, requiredText, optionalFutureDeadline };
