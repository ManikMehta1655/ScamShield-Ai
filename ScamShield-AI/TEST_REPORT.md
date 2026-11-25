# Local regression report

Node 22.16.0: 6/6 test groups passed, 0 failures.

1. Health endpoint, validation, unauthenticated requests and cross-origin rejection.
2. Registration, duplicate username, password hash, login, logout and expiry.
3. Two-user profile/history/analytics/export isolation, cross-user delete rejection, batch and single scans, opt-in history.
4. Password rotation, session revocation, account deletion with foreign-key cascade.
5. Database-backed rate limiting.
6. ML inference, URL rules, response schema and synthetic model labeling.

The request handlers and SQL ran against Node's in-memory SQLite adapter, which translates PostgreSQL positional parameters and omits `FOR UPDATE`. PostgreSQL-specific transaction behavior, Netlify's function runtime, native database provisioning, package installation and browser HTTPS were not tested. npm registry DNS was unavailable in this environment; no lockfile could be generated. Netlify installs dependencies on Git deploy. A PostgreSQL 16 GitHub Actions job is included but not run here. No claim of live deployment or production security audit.
