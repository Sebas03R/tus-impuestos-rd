# Copias de seguridad y recuperación

## Automáticas

- `.github/workflows/backup.yml` corre a diario (08:00 UTC): `pg_dump` (formato custom, esquema
  `public`) cifrado con [age](https://age-encryption.org) y guardado como artefacto por 30 días.
- Supabase (plan gratuito) no ofrece restauración puntual; este volcado es la copia de referencia.
- Los snapshots crudos de cada sincronización quedan en Supabase Storage (bucket privado `raw-snapshots`).

## Configuración inicial

```bash
age-keygen -o tirds-backup.key        # guarde este archivo FUERA del repositorio (gestor de contraseñas)
grep public tirds-backup.key          # copie la clave pública "age1..."
gh secret set BACKUP_AGE_PUBKEY --body "age1..."
gh secret set DATABASE_URL_DIRECT --body "postgresql://postgres:<clave>@db.<ref>.supabase.co:5432/postgres"
```

## Restaurar

```bash
gh run download <run-id> -n tirds-backup
age -d -i tirds-backup.key -o dump.pgc tirds-AAAAMMDDTHHMMZ.pgc.age
pg_restore --no-owner --clean --if-exists -d "$DATABASE_URL_DESTINO" dump.pgc
cd services/pipeline && DATABASE_URL=... uv run tirds db upgrade   # asegura migraciones al día
```

Probar una restauración en una base local al menos una vez al mes:
`docker compose up -d db` y restaurar en una base nueva.
