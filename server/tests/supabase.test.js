const { getSupabase, isSupabaseConfigured } = require('../src/lib/supabase');

const VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const saved = {};

beforeEach(() => {
  for (const name of VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe('isSupabaseConfigured', () => {
  it('is true when both the URL and the key are set', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    expect(isSupabaseConfigured()).toBe(true);
  });

  it('is false when neither is set', () => {
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('is false when only the URL is set', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';

    expect(isSupabaseConfigured()).toBe(false);
  });

  it('is false when only the key is set', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    expect(isSupabaseConfigured()).toBe(false);
  });

  it('is false when a value is an empty string', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';

    expect(isSupabaseConfigured()).toBe(false);
  });
});

describe('getSupabase', () => {
  it('throws a clear error when the key is missing', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';

    expect(() => getSupabase()).toThrow(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set',
    );
  });
});
