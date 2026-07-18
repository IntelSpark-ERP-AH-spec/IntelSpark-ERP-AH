# Mise en production

## Capacite cible

- Cent sessions simultanees
- Quatre coeurs processeur recommandes
- Huit gigaoctets memoire recommandes
- Stockage SSD obligatoire
- Instance applicative unique

## Prerequis

- Serveur Linux actualise
- Docker Engine recent
- Domaine dirige vers serveur
- Ports 80 et 443 ouverts
- Caddy comme proxy TLS

## Secrets

Copier `.env.production.example` vers `.env.production`.

Generer deux secrets independants PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

Renseigner `JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `ADMIN_PASSWORD`.

Copier URL `Session pooler` depuis Supabase, menu `Connect`.

Renseigner `DATABASE_URL`. Conserver `sslmode=require`.

Choisir mot passe administrateur unique.

Limiter `ALLOWED_ORIGINS` au domaine public.

## Demarrage

```powershell
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
```

Copier `Caddyfile.example` vers configuration Caddy.

Remplacer `erp.example.com` partout.

Tester readiness:

```powershell
Invoke-RestMethod https://erp.example.com/api/ready
```

## Base Supabase

Projet actif: `IntelSpark-ERP-AH`.

Reference projet: `hozhnlzgbccrkdluqjcg`.

Application utilise PostgreSQL Supabase lorsque `DATABASE_URL` existe.

SQLite local reste disponible sans `DATABASE_URL`.

Ne jamais placer `DATABASE_URL` dans variables Vite ou frontend.

## Sauvegardes

Supabase gere sauvegardes PostgreSQL selon offre active.

Routes sauvegarde SQLite restent désactivées avec Supabase.

Copier quotidiennement ce volume ailleurs.

Chiffrer stockage externe choisi.

Tester restauration chaque trimestre.

Conserver minimum sept sauvegardes.

Activer copie S3 compatible:

```text
S3_BACKUP_BUCKET=intelsheets-production
S3_BACKUP_REGION=eu-west-1
S3_BACKUP_PREFIX=database/
```

Configurer identifiants IAM minimaux.

Activer `external_backup_enabled` depuis Parametres.

Verifier restauration automatisee:

```powershell
npm.cmd run dr:verify
```

Consulter `DISASTER_RECOVERY.md` trimestriellement.

## Rotation secrets

Changer `JWT_SECRET` deconnecte tout utilisateur.

Changer `DATA_ENCRYPTION_KEY` exige migration secrets.

Ne jamais publier `.env.production`.

## Exploitation

- Surveiller `/api/ready` chaque minute.
- Alerter apres trois echecs.
- Examiner journaux applicatifs quotidiennement.
- Installer mises jour mensuellement.
- Executer audits apres changement.
- Executer `npm test` avant publication.
- Confirmer test cent utilisateurs.

## Monitoring

```powershell
docker compose --env-file .env.production --profile monitoring up -d
```

Grafana ecoute localement port 3002.

Prometheus collecte metriques automatiquement.

Alertmanager traite alertes critiques.

## Redis multi-instance

Redis demarre automatiquement.

Evenements WebSocket traversent instances.

Conserver `REDIS_REQUIRED=true` en production.

## Migration PostgreSQL

Migration Supabase terminée.

Quarante-neuf tables sécurisées.

Quarante-et-une relations validées.

Import: 50 927 lignes.

## Pentest automatise

Workflow `security.yml` lance OWASP ZAP.

Consulter artefact `zap-security-report`.

Corriger alertes avant publication.
