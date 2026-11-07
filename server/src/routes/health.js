const { Router } = require('express');
const { isSupabaseConfigured } = require('../lib/supabase');

const router = Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', databaseConfigured: isSupabaseConfigured() });
});

module.exports = router;
