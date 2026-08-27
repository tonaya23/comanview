# Local Auth development access

`pnpm dev:pos`, `pnpm dev:kds` and `pnpm dev:local` prepare development-only users and devices in
the local SQLite database. These credentials are created only by
`prepareDevelopmentDatabase.ts`; Edge runtime does not contain a production fallback credential.
The preparation command also refuses to run when `NODE_ENV=production`.

| Profile           | Role    | Default development PIN |
| ----------------- | ------- | ----------------------- |
| Dueño desarrollo  | OWNER   | `1111`                  |
| Cajero desarrollo | CASHIER | `2222`                  |
| Gerente desarrollo | MANAGER | `5555`                 |
| Mesero desarrollo | WAITER  | `3333`                  |
| Cocina desarrollo | KITCHEN | `4444`                  |

`9999` belongs to a deliberately `DISABLED` fixture used by security tests and cannot log in.

The defaults can be replaced before preparing the development database with:

- `COMANVIEW_DEV_OWNER_PIN`
- `COMANVIEW_DEV_CASHIER_PIN`
- `COMANVIEW_DEV_MANAGER_PIN`
- `COMANVIEW_DEV_WAITER_PIN`
- `COMANVIEW_DEV_KITCHEN_PIN`
- `COMANVIEW_DEV_DISABLED_PIN`

The seed hashes every PIN with a random salt before persistence. To apply changed environment PINs
to an already seeded development database, use the existing safe development reset workflow and
prepare it again; the idempotent seed intentionally does not overwrite existing credentials.

Development POS and KDS devices are pre-registered with 12-hour and 24-hour sliding local session
timeouts respectively. Production builds require `VITE_COMANVIEW_DEVICE_ID`; the fixed development
device IDs are only selected by Vite in development mode. Session tokens are returned once to the
client, while SQLite stores only their SHA-256 digest.
