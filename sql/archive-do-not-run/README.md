# DO NOT RUN — archived development scratch scripts

The files in this folder are ad-hoc scripts used during early development to
unblock local contract/signature work in May 2026. Several of them create
`USING (true)` / `TO public` policies and `GRANT ALL ... TO anon` on tables
that hold signed contracts, digital signatures, and HR case files, and on
`storage.objects`. That directly undoes the tenant-isolation and storage RLS
hardening applied in `sql/037`, `sql/049`, `sql/052`, and `sql/060`.

They are **not part of the numbered migration sequence** (see
`sql/MIGRATION_MANIFEST.md`), are not referenced by any deploy tooling, and
must never be executed against a Supabase project that has run the numbered
hardening migrations — doing so reopens full anonymous read/write access to
production HR/legal documents and signatures.

They are kept only for historical reference. If you need to fix a real issue
with contract generation or signing, write a new numbered migration instead.
