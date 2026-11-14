import { useState } from 'react';
import CopyLink from './CopyLink.jsx';
import { request } from './api.js';

export default function Poll({ initial, token, organizerRoute }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [draft, setDraft] = useState(null);
  const [feedback, setFeedback] = useState({});
  const [busy, setBusy] = useState(false);
  const { trip, destinations, ballot } = snapshot;
  const path = '/' + trip.tripId;
  const open = trip.status === 'open';
  const organizer = organizerRoute && initial.me.isOrganizer;
  const byId = new Map(destinations.map((destination) => [destination.destinationId, destination]));
  const savedRanking = ballot?.rankedDestinationIds ?? [];
  const ranking = ((open ? draft : null) ?? savedRanking).filter((id) => byId.has(id));
  const canRank = open && destinations.length >= 2 && !busy;

  function changeRanking(next) {
    setDraft(next);
    setFeedback({});
  }

  function move(index, offset) {
    const target = index + offset;
    if (!canRank || index < 0 || target < 0 || target >= ranking.length) return;
    const next = [...ranking];
    [next[index], next[target]] = [next[target], next[index]];
    changeRanking(next);
  }

  async function refresh() {
    const [{ trip: latest }, options, saved] = await Promise.all([
      request(path, { token }),
      request(path + '/destinations', { token }),
      request(path + '/ballot', { token }),
    ]);
    setSnapshot({ trip: latest, destinations: options.destinations, ballot: saved.ballot });
  }

  async function act(action, message) {
    setBusy(true);
    setFeedback({});
    try {
      await action();
      setFeedback({ message });
      try {
        await refresh();
      } catch {
        setFeedback({ message, error: 'Could not refresh the poll. Use Refresh to try again.' });
      }
    } catch (error) {
      setFeedback({ error: error.message, highlight: error.existingDestinationId });
      if (error.status === 409 || error.status === 400) {
        await refresh().catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }

  function addDestination(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    act(async () => {
      const { destination } = await request(path + '/destinations', {
        method: 'POST',
        token,
        body: { name: fields.get('name').trim(), note: fields.get('note').trim() },
      });
      setSnapshot((current) => ({ ...current, destinations: [...current.destinations, destination] }));
      form.reset();
    }, 'Destination added.');
  }

  function saveBallot(event) {
    event.preventDefault();
    act(async () => {
      const saved = await request(path + '/ballot', {
        method: 'PUT',
        token,
        body: { rankedDestinationIds: ranking },
      });
      setSnapshot((current) => ({ ...current, ballot: saved.ballot }));
      setDraft(null);
    }, 'Vote saved.');
  }

  function removeDestination(destination) {
    if (!window.confirm('Remove ' + destination.name + ' from this poll and all ballots?')) return;
    act(async () => {
      await request(path + '/destinations/' + destination.destinationId, { method: 'DELETE', token, organizer });
      setSnapshot((current) => ({
        ...current,
        destinations: current.destinations.filter(({ destinationId }) => destinationId !== destination.destinationId),
      }));
    }, 'Destination removed.');
  }

  function closePoll() {
    if (!window.confirm('Close this poll? Members will no longer be able to vote.')) return;
    act(async () => {
      const { status } = await request(path + '/close', { method: 'POST', token, organizer });
      setSnapshot((current) => ({ ...current, trip: { ...current.trip, status } }));
    }, 'Poll closed.');
  }

  async function refreshManually() {
    setBusy(true);
    try {
      await refresh();
      setFeedback({ message: 'Poll updated.' });
    } catch (error) {
      setFeedback({ error: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace">
      <section className="trip-header">
        <div>
          <div className={'eyebrow' + (open ? '' : ' closed')}><span aria-hidden="true" />{open ? 'Voting open' : 'Voting closed'}</div>
          <h1>{trip.name}</h1>
          <p>Joined as <strong>{initial.me.displayName}</strong>{organizer ? ' · Organizer' : ''}</p>
          {trip.deadline && <p>Voting deadline <time dateTime={trip.deadline}>{new Date(trip.deadline).toLocaleString()}</time></p>}
        </div>
        <div className="progress-card">
          <div><strong>{trip.votedCount} of {trip.memberCount}</strong> voted</div>
          <progress aria-label="Voting progress" value={trip.votedCount} max={trip.memberCount || 1} />
          <button className="secondary" type="button" onClick={refreshManually} disabled={busy}>Refresh</button>
        </div>
      </section>
      {feedback.error && <p className="notice error" role="alert">{feedback.error}</p>}
      {feedback.message && <p className="notice" role="status">{feedback.message}</p>}
      {!open && (
        <p className="notice">
          {byId.has(trip.winnerId)
            ? 'Winning destination: ' + byId.get(trip.winnerId).name
            : 'Voting has closed. Results are unavailable in this version.'}
        </p>
      )}
      <div className="poll-grid">
        <section className="panel">
          <h2>Destinations</h2>
          {destinations.length === 0 && <p>No destinations have been added yet.</p>}
          <ul className="options">
            {destinations.map((destination) => {
              const id = destination.destinationId;
              const ranked = ranking.includes(id);
              return (
                <li key={id} className={feedback.highlight === id ? 'highlight' : ''}>
                  <div>
                    <strong>{destination.name}</strong>
                    {destination.note && <p>{destination.note}</p>}
                  </div>
                  {open && (
                    <div className="row-actions">
                      <button className="secondary" disabled={!canRank || ranked} aria-label={'Rank ' + destination.name}
                        onClick={() => changeRanking([...ranking, id])}>{ranked ? 'Ranked' : 'Rank'}</button>
                      {organizer && <button className="text-button" disabled={busy} aria-label={'Remove ' + destination.name + ' from poll'}
                        onClick={() => removeDestination(destination)}>Remove option</button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {open && (
            <form className="add-form" onSubmit={addDestination}>
              <label>Destination name<input name="name" required maxLength={60} placeholder="Cannon Beach" /></label>
              <label>Note <small>Optional</small><textarea name="note" maxLength={200} rows={2} /></label>
              <button className="secondary" disabled={busy}>Add destination</button>
            </form>
          )}
        </section>
        <section className="panel ballot-panel">
          <h2>Your ballot</h2>
          <p>{open && destinations.length < 2
            ? 'Voting opens when there are at least two destinations.'
            : 'Rank one or more destinations. Only you can see your ballot.'}</p>
          <form onSubmit={saveBallot}>
            <ol className="ballot">
              {ranking.map((id, index) => {
                const name = byId.get(id).name;
                return (
                  <li key={id} draggable={canRank}
                    onDragStart={(event) => event.dataTransfer.setData('text/plain', id)}
                    onDragOver={(event) => { if (canRank) event.preventDefault(); }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const source = ranking.indexOf(event.dataTransfer.getData('text/plain'));
                      if (!canRank || source < 0 || source === index) return;
                      const next = ranking.filter((entry) => entry !== ranking[source]);
                      next.splice(index, 0, ranking[source]);
                      changeRanking(next);
                    }}>
                    <span className="rank" aria-hidden="true">{index + 1}</span>
                    <strong>{name}</strong>
                    {open && <div className="row-actions">
                      <button type="button" className="secondary icon" aria-label={'Move ' + name + ' up'}
                        onClick={() => move(index, -1)} disabled={!canRank || index === 0}>↑</button>
                      <button type="button" className="secondary icon" aria-label={'Move ' + name + ' down'}
                        onClick={() => move(index, 1)} disabled={!canRank || index === ranking.length - 1}>↓</button>
                      <button type="button" className="secondary icon" aria-label={'Remove ' + name + ' from ballot'}
                        onClick={() => changeRanking(ranking.filter((entry) => entry !== id))} disabled={busy}>×</button>
                    </div>}
                  </li>
                );
              })}
            </ol>
            {ranking.length === 0 && <p className="empty">{open ? 'Your ballot is empty.' : 'You have no saved rankings.'}</p>}
            {open && <button className="primary full" disabled={!canRank || !ranking.length || (ballot && !draft)}>
              {ballot ? 'Update vote' : 'Save vote'}
            </button>}
          </form>
        </section>
      </div>
      {organizer && (
        <section className="panel organizer-panel">
          <h2>Organizer controls</h2>
          <CopyLink label="Member invite" path={'/trip/' + trip.tripId} />
          <CopyLink label="Private organizer link" path={'/trip/' + trip.tripId + '/organizer#' + token} />
          {open && <button type="button" className="danger" disabled={busy} onClick={closePoll}>Close poll</button>}
        </section>
      )}
    </div>
  );
}
