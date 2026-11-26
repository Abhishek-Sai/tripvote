const { closeIfDeadlinePassed } = require('../lib/pollResults');

// Runs for every route with a :tripId so a passed deadline closes the poll
// before the request is handled (FR-28).
function deadlineParam(db) {
  return (req, res, next, tripId) => {
    closeIfDeadlinePassed(db, tripId).then(() => next(), next);
  };
}

module.exports = { deadlineParam };
