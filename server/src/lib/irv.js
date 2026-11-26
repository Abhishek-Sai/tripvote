// Instant-runoff counting (FR-13, FR-14, FR-29). Pure function: no database.
//
// options: [{ id, createdAt }]  every destination in the trip
// ballots: [[id, id, ...]]      each ballot's ranking, most preferred first
//
// Returns { outcome, winnerId, finalists, rounds } where outcome is
// 'winner', 'tie' (final two tied, organizer decides) or 'no_winner'.
// Each round is { counts: { id: votes }, exhausted, activeBallots, eliminatedId }.
function countInstantRunoff(options, ballots) {
  if (ballots.length === 0 || options.length < 2) {
    return { outcome: 'no_winner', winnerId: null, finalists: [], rounds: [] };
  }

  const addedAt = new Map(options.map((o) => [o.id, new Date(o.createdAt).getTime()]));
  const remaining = new Set(options.map((o) => o.id));
  const firstChoices = tally(ballots, remaining).counts; // for the FR-14 tie-break
  const rounds = [];

  for (;;) {
    const { counts, exhausted } = tally(ballots, remaining);
    const activeBallots = ballots.length - exhausted; // exhausted ballots leave the denominator
    const round = { counts: Object.fromEntries(counts), exhausted, activeBallots, eliminatedId: null };
    rounds.push(round);

    if (activeBallots === 0) {
      return { outcome: 'no_winner', winnerId: null, finalists: [], rounds };
    }
    for (const [id, votes] of counts) {
      if (votes * 2 > activeBallots) {
        return { outcome: 'winner', winnerId: id, finalists: [], rounds };
      }
    }
    // Two left and neither has a majority, so they are tied.
    if (remaining.size === 2) {
      return { outcome: 'tie', winnerId: null, finalists: [...remaining], rounds };
    }

    round.eliminatedId = pickElimination(counts, firstChoices, addedAt);
    remaining.delete(round.eliminatedId);
  }
}

// Each ballot counts for its highest-ranked option that is still in the race.
function tally(ballots, remaining) {
  const counts = new Map([...remaining].map((id) => [id, 0]));
  let exhausted = 0;
  for (const ranking of ballots) {
    const choice = ranking.find((id) => remaining.has(id));
    if (choice === undefined) exhausted += 1;
    else counts.set(choice, counts.get(choice) + 1);
  }
  return { counts, exhausted };
}

// FR-14: the lowest count goes. Among tied options, the one with the fewest
// original first-choice votes goes; if still tied, the most recently added goes.
function pickElimination(counts, firstChoices, addedAt) {
  const ids = [...counts.keys()];
  ids.sort((a, b) =>
    counts.get(a) - counts.get(b)
    || firstChoices.get(a) - firstChoices.get(b)
    || addedAt.get(b) - addedAt.get(a)
    || (a < b ? 1 : -1), // same timestamp: fixed order so counting is repeatable
  );
  return ids[0];
}

module.exports = { countInstantRunoff };
