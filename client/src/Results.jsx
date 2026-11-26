// Results of a closed poll (FR-13 to FR-15, FR-29, FR-30). Shows the winner
// and each destination's votes in every round: totals only, never ballots.
export default function Results({ results, organizer, busy, onResolveTie }) {
  if (!results) return <section className="panel results"><p role="status">Loading results…</p></section>;

  const { outcome, winnerId, rounds, finalists, chosenByOrganizer } = results;
  const lastRound = rounds[rounds.length - 1];
  const winnerName = winnerId
    && (lastRound?.counts.find((c) => c.destinationId === winnerId)?.name
      ?? finalists.find((f) => f.destinationId === winnerId)?.name);
  const tieOpen = results.status === 'tie';

  return (
    <section className="panel results" aria-labelledby="results-heading">
      <h2 id="results-heading">Results</h2>

      {winnerName && (
        <div className="winner">
          <span className="eyebrow">{chosenByOrganizer ? 'Chosen by the organizer after a tie' : 'Winning destination'}</span>
          <strong>{winnerName}</strong>
        </div>
      )}

      {outcome === 'no_winner' && (
        <p className="notice">No winner—insufficient votes or options</p>
      )}

      {tieOpen && (
        <div className="notice tie">
          <p><strong>Tie—organizer decision required</strong></p>
          <p>{finalists.map((f) => f.name).join(' and ')} finished level in the final round.</p>
          {organizer && (
            <div className="tie-actions">
              {finalists.map((f) => (
                <button key={f.destinationId} type="button" className="primary" disabled={busy}
                  onClick={() => onResolveTie(f)}>Choose {f.name}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {rounds.length > 0 && (
        <>
          <p>Counted from {results.ballotCount} {results.ballotCount === 1 ? 'ballot' : 'ballots'} by instant runoff.
            Each round, the destination with the fewest votes is removed and its votes move to each ballot’s next choice.</p>
          <div className="table-scroll">
            <table className="rounds">
              <caption className="visually-hidden">Votes for each destination in each round</caption>
              <thead>
                <tr>
                  <th scope="col">Destination</th>
                  {rounds.map((r) => <th scope="col" key={r.round}>Round {r.round}</th>)}
                </tr>
              </thead>
              <tbody>
                {rounds[0].counts.map(({ destinationId, name }) => (
                  <tr key={destinationId} className={destinationId === winnerId ? 'is-winner' : ''}>
                    <th scope="row">{name}</th>
                    {rounds.map((r) => {
                      const entry = r.counts.find((c) => c.destinationId === destinationId);
                      const out = r.eliminatedId === destinationId;
                      return (
                        <td key={r.round} className={out ? 'eliminated' : ''}>
                          {entry ? entry.votes : '—'}
                          {out && <span className="visually-hidden"> (removed)</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Ballots with no choices left</th>
                  {rounds.map((r) => <td key={r.round}>{r.exhausted}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="hint">Struck-through counts were removed after that round.</p>
        </>
      )}
    </section>
  );
}
