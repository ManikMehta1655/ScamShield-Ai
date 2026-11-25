# ScamShield AI — Netlify Edition (v4.0)

Full-stack digital fraud detection and threat intelligence. The existing dark React dashboard and login interface are preserved. The backend is now JavaScript on Netlify Functions; the original scikit-learn TF-IDF / Logistic Regression model is exported as weights and evaluated on the server. User accounts, hashed passwords, sessions and scan metadata are stored in Netlify Database (managed PostgreSQL). No external host or AI API is needed.

## Deploy on Netlify — only

1. Extract this ZIP. Upload the **contents** of `ScamShield-Netlify-Full` to the root of your existing GitHub repository, including `netlify.toml`, `package.json`, the `netlify/`, `server/`, `frontend/` and other directories. Remove obsolete v3/v4 Python deployment files from the repository if possible. Don't upload only the frontend or a ZIP.
2. In Netlify, open your project and connect its GitHub repository under project configuration / continuous deployment (or use Add new project > Import a Git repository). A Git-connected build is required; Netlify Drop alone won't build server functions and provision the database.
3. Select the branch containing the new files. Base directory: blank if `package.json` is at repository root. Build command: `npm run build`. Publish directory: `frontend`. Functions directory: `netlify/functions`. These are already configured in `netlify.toml`; no environment variables are required for a new project.
4. Deploy. Netlify installs npm dependencies, bundles the function, provisions its integrated database and applies `netlify/database/migrations/20261125230000_initial.sql` (for a supported credit-based plan). Check the build log and Data & Storage > Database. If provisioning isn't automatic, create the database there and redeploy. Do not paste passwords or database URLs into GitHub.
5. Open your assigned Netlify URL. `/healthz` should return `{"status":"ok"}`. Register an account, scan a message, save history, log out, and sign in again. Test a second user to confirm isolation.

Netlify Database is available on credit-based plans (including Free subject to quotas). Older legacy plans may not support it; inspect your plan before deploying. Do not activate a paid plan if you want zero charges. No Render, Neon, Supabase, or separate service is needed. Netlify free limits can pause the project when credits are exhausted.

## Features

- Individual registration and sign-in, profile editing and account deletion
- Password hashing using Node scrypt (N=32768, r=8, p=3; random salts), SHA-256 session digests, eight-hour secure HttpOnly cookies
- Persistent PostgreSQL records scoped to the authenticated user; database-backed rate limiting and transaction-based write authorization
- Message, email, URL analysis; batch scanning; explainable risk score; opt-in private history; analytics; CSV and JSON exports
- Model metrics and cybersecurity guidance; never visits suspicious links; raw submitted text is not stored

## Repository layout

```
frontend/                      Original React UI and static login page
netlify/functions/api.mjs       Netlify function entry point
netlify/database/migrations/    PostgreSQL schema
server/api.mjs                 Authenticated API and SQL operations
server/model.mjs               Exported trained weights and inference
ml/                            Optional original Python training and exporter
data/demo.tsv                   Original synthetic training dataset
tests/                         Regression suite
netlify.toml                   Netlify build configuration
package.json                   Node dependencies
```

## Run locally (optional)

Requires Node.js 22+. `npm install`, then `npx netlify-cli dev` after linking to a Netlify project. Local secure-cookie behavior may differ if the dev URL is not HTTPS. No local setup is required for Git deployment.

`npm test` runs against an in-memory SQLite adapter by default; it exercises the actual request handlers and SQL except PostgreSQL row locking. A real PostgreSQL regression job is provided under `.github/workflows/regression.yml`; it uses a disposable test database. To run manually set `TEST_DATABASE_URL` to a **disposable** database only (the tests drop the test tables). `npm run build` performs source syntax checks.

## Model provenance

The included model was trained with Python scikit-learn, TF-IDF unigrams/bigrams and Logistic Regression, using 100 synthetic demo samples. Its holdout metrics are demonstration metrics, not real-world fraud detection accuracy. The Netlify function reproduces inference in JavaScript; URL checks are heuristics, and tokenization may vary on unusual Unicode text. Python is not a deployment dependency. Optional retraining: `python -m pip install -r ml/requirements.txt` then `python ml/export_model.py --download`; omit `--download` to use demo data. Do not treat a low score as proof of safety.

## Security / compatibility limitations

This is a college MVP, not an independently audited production security product. The static dashboard shell is public, but API responses and stored user data require authentication. Site/database administrators can access stored data. No email verification, MFA or password recovery. Existing v3/v4 accounts have not been migrated; the new database starts empty and uses scrypt rather than the old Argon2id hashes. Rate-limit records and expired sessions can be periodically cleaned in PostgreSQL for long-term use. Live Netlify deployment and real PostgreSQL tests were not run in the authoring environment; see TEST_REPORT.md.
