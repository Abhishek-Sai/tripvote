// Shared setup for the poll and results API tests. api() returns a supertest agent.
function pollHelpers(api) {
  // A trip with an organizer and two members. Each person has a helper that sends
  // their token: as.organizer.get(path), as.alex.post(path).send(body), ...
  async function setUpTrip() {
    const created = await api()
      .post('/api/trips')
      .send({ name: 'Euro trip', organizerName: 'Organizer' });
    const tripId = created.body.trip.tripId;
    const tokens = { organizer: created.body.memberToken };
    for (const name of ['Alex', 'Blake']) {
      const joined = await api().post(`/api/trips/${tripId}/members`).send({ displayName: name });
      tokens[name.toLowerCase()] = joined.body.memberToken;
    }

    const as = {};
    for (const [who, token] of Object.entries(tokens)) {
      const withToken = (req) => {
        req.set('X-Member-Token', token);
        if (who === 'organizer') req.set('X-Organizer-Token', token);
        return req;
      };
      const path = (p) => `/api/trips/${tripId}${p}`;
      as[who] = {
        get: (p) => withToken(api().get(path(p))),
        post: (p) => withToken(api().post(path(p))),
        put: (p) => withToken(api().put(path(p))),
        delete: (p) => withToken(api().delete(path(p))),
      };
    }
    return { tripId, as };
  }

  async function addDestination(person, name, note) {
    const res = await person.post('/destinations').send({ name, note });
    return res.body.destination.destinationId;
  }

  // A trip with three destinations already added.
  async function setUpPoll() {
    const trip = await setUpTrip();
    const rome = await addDestination(trip.as.alex, 'Rome');
    const paris = await addDestination(trip.as.blake, 'Paris');
    const oslo = await addDestination(trip.as.organizer, 'Oslo');
    return { ...trip, rome, paris, oslo };
  }

  const vote = (person, rankedDestinationIds) => person.put('/ballot').send({ rankedDestinationIds });

  return { setUpTrip, setUpPoll, addDestination, vote };
}

module.exports = { pollHelpers };
