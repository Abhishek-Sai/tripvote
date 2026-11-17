import { useEffect, useState } from 'react';
import { readSession, request, writeSession } from './api.js';
import CopyLink from './CopyLink.jsx';
import Poll from './Poll.jsx';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const [, segment, tripId, mode, extra] = window.location.pathname.replace(/\/$/, '').split('/');
const openOrganizerLink = mode === 'organizer';
const linkToken = openOrganizerLink ? window.location.hash.slice(1) : '';

if (openOrganizerLink && linkToken) {
  window.history.replaceState(null, '', window.location.pathname);
}

export default function App() {
  let content = <Home />;
  if (segment) {
    content = segment === 'trip' && uuid.test(tripId) && !extra && (!mode || openOrganizerLink)
      ? <Trip tripId={tripId} organizerRoute={openOrganizerLink} initialToken={linkToken} />
      : <Home initialError="That trip link is invalid." />;
  }

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <a className="wordmark" href="/"><span aria-hidden="true">↗</span> TripVote</a>
        <a className="header-link" href="/#create">Create a trip</a>
      </header>
      <main id="main">{content}</main>
    </>
  );
}

function Home({ initialError = '' }) {
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (initialError) window.history.replaceState(null, '', '/');
  }, [initialError]);

  async function createTrip(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const localDeadline = fields.get('deadline');
    setBusy(true);
    setError('');
    try {
      const deadline = localDeadline ? new Date(localDeadline) : null;
      if (deadline && (!Number.isFinite(deadline.getTime()) || deadline <= new Date())) {
        throw new Error('Choose a voting deadline in the future.');
      }
      const data = await request('', {
        method: 'POST',
        body: {
          name: fields.get('name').trim(),
          organizerName: fields.get('organizerName').trim(),
          deadline: deadline?.toISOString(),
        },
      });
      writeSession(data.trip.tripId, data.memberToken);
      setCreated(data);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="home-grid">
      <section className="intro">
        <div className="eyebrow"><span aria-hidden="true" /> Group trip planning</div>
        <h1>Pick a place.<br /><em>Make it happen.</em></h1>
        <p>Suggest destinations, rank your favorites, and decide where to go together. Your friends can join with one link.</p>
        <div className="example" aria-label="Example ranked ballot">
          <div className="example-head"><strong>Weekend on the coast</strong><span>Example ballot</span></div>
          <ol>
            {['Cannon Beach', 'Manzanita', 'Astoria'].map((place, index) => (
              <li key={place}><span className="rank">{index + 1}</span>{place}<span aria-hidden="true">↗</span></li>
            ))}
          </ol>
        </div>
      </section>
      <section className="panel create-panel" id="create">
        <h2>{created ? 'Your trip is ready' : 'Create a trip'}</h2>
        {error && <p className="notice error" role="alert">{error}</p>}
        {created ? (
          <>
            <p>Send the invite link to your group. Save the organizer link somewhere private.</p>
            <CopyLink label="Member invite" path={created.sharePath} />
            <CopyLink label="Private organizer link" path={created.organizerPath} />
            <a className="button primary full" href={created.organizerPath}>Open organizer view <span aria-hidden="true">→</span></a>
          </>
        ) : (
          <form onSubmit={createTrip}>
            <p>Start a poll for up to 20 people.</p>
            <label>Trip name<input name="name" placeholder="Weekend on the coast" maxLength={80} required /></label>
            <label>Your display name<input name="organizerName" placeholder="Alex" maxLength={30} required /></label>
            <label>Voting deadline <small>Optional</small><input name="deadline" type="datetime-local" aria-describedby="deadline-help" /></label>
            <p className="hint" id="deadline-help">Uses your local time. The organizer closes voting manually in this version.</p>
            <button className="primary full" disabled={busy}>{busy ? 'Creating trip…' : 'Create trip'} <span aria-hidden="true">→</span></button>
          </form>
        )}
      </section>
    </div>
  );
}

function Trip({ tripId, organizerRoute, initialToken }) {
  const path = '/' + tripId;
  const [token, setToken] = useState(() => initialToken || readSession(tripId));
  const [view, setView] = useState({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    function update(value) {
      if (!signal.aborted) setView(value);
    }

    async function load() {
      try {
        if (token) {
          let memberView;
          try {
            memberView = await request(path, { token, signal });
          } catch (failure) {
            if (failure.status !== 401) throw failure;
            if (organizerRoute) {
              if (!initialToken) writeSession(tripId, null);
              update({ kind: 'invalid', message: 'This organizer link is invalid or has expired.' });
              return;
            }
            writeSession(tripId, null);
          }
          if (memberView) {
            if (organizerRoute && !memberView.me.isOrganizer) {
              update({ kind: 'invalid', message: 'This organizer link is invalid or has expired.' });
              return;
            }
            const [{ destinations }, { ballot }] = await Promise.all([
              request(path + '/destinations', { token, signal }),
              request(path + '/ballot', { token, signal }),
            ]);
            if (!signal.aborted) writeSession(tripId, token);
            update({ kind: 'poll', ...memberView, destinations, ballot });
            return;
          }
        }

        if (organizerRoute) {
          update({ kind: 'invalid', message: 'Open the private organizer link you saved when creating this trip.' });
          return;
        }
        const preview = await request(path + '/preview', { signal });
        update({ kind: 'join', ...preview });
      } catch (failure) {
        const kind = failure.status === 404 ? 'invalid' : 'error';
        update({ kind, message: failure.message });
      }
    }
    load();
    return () => controller.abort();
  }, [attempt, initialToken, organizerRoute, path, token, tripId]);

  async function join(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      const result = await request(path + '/members', {
        method: 'POST',
        body: { displayName: fields.get('displayName').trim() },
      });
      writeSession(tripId, result.memberToken);
      setView({ kind: 'loading' });
      setToken(result.memberToken);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  if (view.kind === 'poll') {
    return <Poll key={tripId} initial={view} token={token} organizerRoute={organizerRoute} />;
  }
  if (view.kind === 'invalid') return <Home initialError={view.message} />;

  return (
    <section className="panel narrow">
      <h1>{view.kind === 'join' ? view.name : 'TripVote'}</h1>
      {view.kind === 'loading' && <p role="status">Loading trip…</p>}
      {view.kind === 'error' && (
        <>
          <p className="notice error" role="alert">{view.message}</p>
          <button className="secondary" onClick={() => {
            setView({ kind: 'loading' });
            setAttempt((value) => value + 1);
          }}>Try again</button>
        </>
      )}
      {view.kind === 'join' && (
        view.isFull ? <p className="notice" role="status">This trip is full.</p> : (
          <form onSubmit={join}>
            <p>Enter a display name to join your group’s trip.</p>
            <label>Display name<input name="displayName" maxLength={30} required /></label>
            {error && <p className="notice error" role="alert">{error}</p>}
            <button className="primary full" disabled={busy}>{busy ? 'Joining…' : 'Join trip'}</button>
          </form>
        )
      )}
    </section>
  );
}
