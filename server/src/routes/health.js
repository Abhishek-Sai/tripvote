const { Router } = require('express');

function healthRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ status: 'ok', databaseConfigured: Boolean(db) });
  });

  return router;
}

module.exports = { healthRouter };
