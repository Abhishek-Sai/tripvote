const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export async function request(path, { method = 'GET', body, token, organizer, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Member-Token'] = token;
  if (organizer) headers['X-Organizer-Token'] = token;

  let response;
  try {
    response = await fetch(apiBase + '/api/trips' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Could not reach TripVote. Check your connection and try again.');
  }
  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(data?.error?.message || 'TripVote could not complete the request. Try again.');
    error.status = response.status;
    error.code = data?.error?.code;
    error.existingDestinationId = data?.error?.existingDestinationId;
    throw error;
  }
  return data;
}

export function readSession(tripId) {
  try {
    return localStorage.getItem('tripvote:member:' + tripId);
  } catch {
    return null;
  }
}

export function writeSession(tripId, token) {
  try {
    const key = 'tripvote:member:' + tripId;
    if (token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
  } catch {
    // The in-memory session still works when browser storage is unavailable.
  }
}
