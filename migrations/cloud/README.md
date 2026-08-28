# Cloud Migrations

Formal PostgreSQL migrations for the Cloud runtime. Run them explicitly with
`pnpm cloud:migrate`; Cloud API startup never creates or mutates schema.

PostgreSQL migrations for the ComanView Cloud (API + Worker).

Managed by Drizzle. Do NOT edit these files manually after applying them.
New migrations are generated with `drizzle-kit generate` from `packages/database`.
