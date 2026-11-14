const fs = require('fs');
const path = require('path');

// Supabase's root CA certificate (public, safe to commit). Download it from
// Supabase dashboard > Project Settings > Database > SSL Configuration.
const DEFAULT_CA_PATH = path.join(__dirname, '../../certs/supabase-ca.crt');

// Decides how the API verifies the database's TLS certificate (SEC-06).
// - A CA certificate is found: full verification (certificate and hostname).
// - No certificate in production: refuse to start.
// - No certificate in development: encrypted but unverified, with a warning.
function buildSslConfig({
  env = process.env,
  exists = fs.existsSync,
  readFile = (file) => fs.readFileSync(file, 'utf8'),
} = {}) {
  const customPath = env.DATABASE_CA_CERT_PATH;
  const caPath = customPath || DEFAULT_CA_PATH;

  if (exists(caPath)) {
    return { ssl: { ca: readFile(caPath), rejectUnauthorized: true }, verified: true };
  }
  if (customPath) {
    throw new Error(`DATABASE_CA_CERT_PATH points to a file that does not exist: ${customPath}`);
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      `No database CA certificate at ${caPath}. Production requires TLS certificate verification.`,
    );
  }
  return {
    ssl: { rejectUnauthorized: false },
    verified: false,
    warning:
      'Database TLS certificate is NOT verified (no CA certificate found). ' +
      'Add server/certs/supabase-ca.crt to enable verification.',
  };
}

module.exports = { buildSslConfig, DEFAULT_CA_PATH };
