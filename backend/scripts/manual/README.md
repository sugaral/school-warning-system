Manual diagnostic and test scripts live here.

Notes:
- These files are not part of the runtime app startup path.
- They are not wired into `package.json` scripts.
- Some scripts only read data, while others write test data or cleanup database records.

Recommended usage:
- Run them from the `backend/` directory so relative config and Prisma behavior stay predictable.
- For `.js` files: `node scripts/manual/<file>.js`
- For `.ts` files: `npx ts-node scripts/manual/<file>.ts`

Before running:
- Make sure `backend/.env` is configured.
- Read the script first if it sounds destructive, especially files that mention `test`, `fix`, `clear`, `delete`, or `rescan`.
