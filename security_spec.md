# Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Unauthenticated Family Read, Admin-Only Write**: Public visitors (parents) may only read non-hidden documents in `/movies` and the non-secret `/settings/library` document. They cannot create, update, or delete any document, nor can they read `/admin_secrets` or `/admins`.
2. **Verified Admin Identity**: Write access to `/movies`, `/settings`, and `/admin_secrets` is strictly restricted to authenticated, email-verified admins (`poojith132photography@gmail.com` or UID present in `/admins/{uid}`).
3. **PII & Secret Isolation**: TeraBox `ndusCookie` and share `passcode` live exclusively in `/admin_secrets/{secretId}`, which denies all public reads and all `list` operations.
4. **Strict Payload & Type Validation**: Every document creation and update validates exact allowed keys (`hasAll` + `hasOnly` / `affectedKeys().hasOnly()`), string length bounds, ID format (`^[a-zA-Z0-9_\-]+$`), enum values, and server-enforced timestamps (`request.time`).
5. **Immutability**: `createdAt` and `addedByUid` on `/movies/{movieId}` are immutable once written.

## 2. The "Dirty Dozen" Attack Payloads (All Must Fail with PERMISSION_DENIED)
1. Unauthenticated `create` on `/movies/m1` -> Denied (not signed in / not admin).
2. Signed-in non-admin user `create` on `/movies/m1` -> Denied (`isAdmin()` false).
3. Unverified email spoof (`email == 'poojith132photography@gmail.com'`, `email_verified == false`) -> Denied.
4. Unauthenticated `get` on `/admin_secrets/terabox` -> Denied (secret isolation).
5. Signed-in non-admin `get` on `/admin_secrets/terabox` -> Denied.
6. Admin `create` on `/movies/m1` with shadow ghost field `{ ..., isVerified: true }` -> Denied (`keys().hasOnly(...)`).
7. Admin `create` on `/movies/m1` with spoofed `addedByUid: "someone_else"` -> Denied (`addedByUid == request.auth.uid`).
8. Admin `create` on `/movies/m1` with client-forged `createdAt` != `request.time` -> Denied.
9. Admin `create` on `/movies/invalid$id!` -> Denied (`isValidId` regex guard).
10. Admin `create` on `/movies/m1` with oversized 500-char `title` -> Denied (`title.size() <= 200`).
11. Admin `update` on `/movies/m1` attempting to mutate `createdAt` or `addedByUid` -> Denied (immutability + `affectedKeys().hasOnly()`).
12. Unauthenticated `list` on `/movies` without `hidden == false` constraint -> Denied (`resource.data.hidden == false` query enforcement).
