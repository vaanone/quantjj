// Admin gate credentials.
//
// Only the PUBLIC salt and the HASH of the password live here — the password
// itself is never stored in the repo. The server (src/app/api/sr/route.ts)
// verifies the salted SHA-256 with node:crypto on every write; the admin page
// verifies it locally with WebCrypto so the form unlocks without a round-trip.

export const ADMIN_SALT = "be37474e3f8c9a6f9c90b32b7cf53961";
export const ADMIN_PW_HASH =
  "4e28e64e6559f2ad4228c09065456313b220dd038b7633169acf1ada3b8421c8";
