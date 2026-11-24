# Backups

The backup job (`jobs/backup.ts`) runs daily and writes two files to `BACKUP_DIR`:

- `backup-<date>.sql.gz`: a `pg_dump` of the database.
- `storage-<date>.tar.gz`: the whole `STORAGE_DIR` folder (contract PDFs, invoice XML, attachments). These files are not in the dump, so a restore needs both: without the archive the database points at documents that are gone.

Files older than `BACKUP_RETENTION_DAYS` are deleted. When `BACKUP_AGE_RECIPIENT` and the backup bucket are set (see `.env.example`), each file is also encrypted with `age` and uploaded as `<name>.age`.

## Restore

1. Download the two `.age` objects from the bucket and decrypt them with the private key kept off the server:

   ```sh
   age --decrypt --identity key.txt --output backup.sql.gz backup-<date>_<stamp>.sql.gz.age
   age --decrypt --identity key.txt --output storage.tar.gz storage-<date>_<stamp>.tar.gz.age
   ```

2. Load the dump into an empty database:

   ```sh
   gunzip -c backup.sql.gz | psql "$DATABASE_URL"
   ```

3. Unpack the archive into the storage folder:

   ```sh
   mkdir -p "$STORAGE_DIR"
   tar -xzf storage.tar.gz -C "$STORAGE_DIR"
   ```

Copies that stayed in `BACKUP_DIR` are not encrypted; skip step 1 for them.
