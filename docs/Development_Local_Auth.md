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

Known development users and Devices are seeded only when the database has no durable Edge binding,
or that binding is the explicit development Tenant/Location. A database provisioned to another
Tenant/Location does not receive those known identities and follows the real first-Device bootstrap.

The development fixtures also have explicit test credentials (`COMANVIEW_DEV_POS_DEVICE_CREDENTIAL`,
`COMANVIEW_DEV_WAITER_DEVICE_CREDENTIAL`, `COMANVIEW_DEV_KDS_DEVICE_CREDENTIAL`). They exist for
automated development fixtures only; browser applications no longer select fixed Device IDs or use
them as a fallback. POS, Waiter and KDS persist their real paired identity in IndexedDB.

Login now requires Device proof plus PIN. Session tokens are returned once to the client, while
SQLite stores only their SHA-256 digest. See `Development_Device_Pairing.md` for installation and
pairing details.
