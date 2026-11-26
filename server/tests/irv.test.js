const { countInstantRunoff } = require('../src/lib/irv');

// Options A, B, C, D added one minute apart, so D is the most recent.
const options = (...ids) =>
  ids.map((id, i) => ({ id, createdAt: new Date(Date.UTC(2026, 10, 1, 12, i)).toISOString() }));

// ballots('ABC', 'BA') -> [['A','B','C'], ['B','A']]
const ballots = (...rankings) => rankings.map((r) => r.split(''));

describe('countInstantRunoff (FR-13)', () => {
  it('declares a first-round majority winner', () => {
    const result = countInstantRunoff(options('A', 'B', 'C'), ballots('AB', 'AC', 'B'));

    expect(result.outcome).toBe('winner');
    expect(result.winnerId).toBe('A');
    expect(result.rounds).toEqual([
      { counts: { A: 2, B: 1, C: 0 }, exhausted: 0, activeBallots: 3, eliminatedId: null },
    ]);
  });

  it('eliminates the lowest option and moves its votes to the next choice', () => {
    // Round 1: A 2, B 2, C 1. C goes and its ballot moves to B.
    const result = countInstantRunoff(options('A', 'B', 'C'), ballots('A', 'A', 'B', 'B', 'CB'));

    expect(result.outcome).toBe('winner');
    expect(result.winnerId).toBe('B');
    expect(result.rounds.map((r) => r.counts)).toEqual([
      { A: 2, B: 2, C: 1 },
      { A: 2, B: 3 },
    ]);
    expect(result.rounds[0].eliminatedId).toBe('C');
  });

  it('needs more than half, not half', () => {
    const result = countInstantRunoff(options('A', 'B', 'C'), ballots('A', 'A', 'B', 'C'));

    expect(result.rounds[0].counts).toEqual({ A: 2, B: 1, C: 1 });
    expect(result.rounds).toHaveLength(2);
  });

  it('drops exhausted ballots from the round denominator', () => {
    // Round 1: A 2, B 2, C 1 (C's ballot ranks nothing else). C goes.
    // Round 2: A 2, B 2 with 1 exhausted ballot: 4 active, final-two tie.
    // With a ballot that does continue, B wins on 3 of 5 active.
    const tie = countInstantRunoff(options('A', 'B', 'C'), ballots('A', 'A', 'B', 'B', 'C'));
    expect(tie.rounds[1]).toEqual({ counts: { A: 2, B: 2 }, exhausted: 1, activeBallots: 4, eliminatedId: null });
    expect(tie.outcome).toBe('tie');

    // A 3, B 2, C 1, D 1. D goes (most recent of C/D): its ballot is exhausted.
    // Round 2: A 3, B 2, C 1 with 6 active: 3 is not a majority. C goes.
    // Round 3: A 3, B 3 with 6 active: final-two tie.
    const result = countInstantRunoff(
      options('A', 'B', 'C', 'D'),
      ballots('A', 'A', 'A', 'B', 'B', 'CB', 'D'),
    );
    expect(result.rounds.map((r) => [r.activeBallots, r.exhausted])).toEqual([[7, 0], [6, 1], [6, 1]]);
    expect(result.outcome).toBe('tie');
  });

  it('counts options nobody ranked as zero', () => {
    const result = countInstantRunoff(options('A', 'B'), ballots('A'));

    expect(result.rounds[0].counts).toEqual({ A: 1, B: 0 });
    expect(result.winnerId).toBe('A');
  });
});

describe('tie-breaking (FR-14)', () => {
  it('eliminates the tied option with the fewest original first choices', () => {
    const result = countInstantRunoff(
      options('A', 'B', 'C', 'D'),
      ballots('A', 'A', 'A', 'B', 'B', 'C', 'DC'),
    );
    // Round 1: A 3, B 2, C 1, D 1. C and D tie on 1, and both had 1 first choice,
    // so the most recently added (D) goes. D's ballot moves to C.
    // Round 2: A 3, B 2, C 2. B and C tie on 2; B had 2 first choices and C had 1,
    // so C goes.
    expect(result.rounds.map((r) => r.eliminatedId)).toEqual(['D', 'C', null]);
    expect(result.rounds[1].counts).toEqual({ A: 3, B: 2, C: 2 });
    expect(result.rounds[2].counts).toEqual({ A: 3, B: 2 });
    expect(result.winnerId).toBe('A');
  });

  it('eliminates the most recently added option when first choices also tie', () => {
    const result = countInstantRunoff(options('A', 'B', 'C'), ballots('A', 'A', 'B', 'C'));

    // B and C tie on 1 vote and 1 first choice. C was added last.
    expect(result.rounds[0].eliminatedId).toBe('C');
  });

  it('does not depend on the order options are listed in', () => {
    const list = options('A', 'B', 'C');
    const result = countInstantRunoff([list[2], list[0], list[1]], ballots('A', 'A', 'B', 'C'));

    expect(result.rounds[0].eliminatedId).toBe('C');
  });

  it('reports a final-two tie for the organizer to decide', () => {
    const result = countInstantRunoff(options('A', 'B', 'C'), ballots('AC', 'B'));

    expect(result.outcome).toBe('tie');
    expect(result.winnerId).toBeNull();
    expect(result.finalists.sort()).toEqual(['A', 'B']);
  });

  it('breaks an all-way tie by elimination order until two remain', () => {
    const result = countInstantRunoff(options('A', 'B', 'C'), ballots('A', 'B', 'C'));

    expect(result.rounds.map((r) => r.eliminatedId)).toEqual(['C', null]);
    expect(result.outcome).toBe('tie');
    expect(result.finalists.sort()).toEqual(['A', 'B']);
  });
});

describe('no winner (FR-29)', () => {
  it('has no winner without ballots', () => {
    expect(countInstantRunoff(options('A', 'B'), [])).toEqual({
      outcome: 'no_winner', winnerId: null, finalists: [], rounds: [],
    });
  });

  it('has no winner with fewer than two options', () => {
    expect(countInstantRunoff(options('A'), ballots('A')).outcome).toBe('no_winner');
  });
});

describe('performance (PR-05)', () => {
  it('counts 20 ballots over 20 options well within 3 seconds', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `opt${i}`);
    const opts = ids.map((id, i) => ({ id, createdAt: new Date(i * 1000).toISOString() }));
    // Ballot n ranks every option, starting from a different one.
    const all = Array.from({ length: 20 }, (_, n) => [...ids.slice(n), ...ids.slice(0, n)]);

    const started = performance.now();
    const result = countInstantRunoff(opts, all);
    const elapsed = performance.now() - started;

    expect(['winner', 'tie']).toContain(result.outcome);
    expect(elapsed).toBeLessThan(3000);
  });
});
