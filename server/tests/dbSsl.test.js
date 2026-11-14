const { buildSslConfig, DEFAULT_CA_PATH } = require('../src/lib/dbSsl');

const PEM = '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n';

// Pretends only the given files exist.
const withFiles = (files) => ({
  exists: (file) => file in files,
  readFile: (file) => files[file],
});

describe('buildSslConfig (SEC-06)', () => {
  it('verifies the certificate when the committed CA file is present', () => {
    const result = buildSslConfig({ env: {}, ...withFiles({ [DEFAULT_CA_PATH]: PEM }) });

    expect(result.verified).toBe(true);
    expect(result.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it('uses DATABASE_CA_CERT_PATH when it is set', () => {
    const result = buildSslConfig({
      env: { DATABASE_CA_CERT_PATH: '/custom/ca.crt' },
      ...withFiles({ '/custom/ca.crt': PEM }),
    });

    expect(result.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it('refuses to start when DATABASE_CA_CERT_PATH points to a missing file', () => {
    expect(() =>
      buildSslConfig({ env: { DATABASE_CA_CERT_PATH: '/missing.crt' }, ...withFiles({}) }),
    ).toThrow(/does not exist/);
  });

  it('refuses to start in production without a CA certificate', () => {
    expect(() => buildSslConfig({ env: { NODE_ENV: 'production' }, ...withFiles({}) })).toThrow(
      /Production requires TLS certificate verification/,
    );
  });

  it('verifies in production when the CA certificate is present', () => {
    const result = buildSslConfig({
      env: { NODE_ENV: 'production' },
      ...withFiles({ [DEFAULT_CA_PATH]: PEM }),
    });

    expect(result.verified).toBe(true);
  });

  it('allows an unverified connection only in development, with a warning', () => {
    const result = buildSslConfig({ env: { NODE_ENV: 'development' }, ...withFiles({}) });

    expect(result.verified).toBe(false);
    expect(result.ssl).toEqual({ rejectUnauthorized: false });
    expect(result.warning).toMatch(/NOT verified/);
  });
});
