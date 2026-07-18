# Reprise apres incident

## Objectifs

- RPO maximal: six heures
- RTO cible: soixante minutes
- Conservation locale: cinquante copies
- Conservation externe: stockage S3 chiffre

## Verification hebdomadaire

```powershell
$env:BACKUP_FILE='C:\sauvegardes\intelsheets-backup.db'
npm.cmd run dr:verify
```

Validation obligatoire:

- `quick_check` retourne `ok`
- aucune violation relationnelle
- tables critiques disponibles
- comptages cohérents

## Incident applicatif

1. Bloquer acces public.
2. Capturer journaux disponibles.
3. Arreter conteneur applicatif.
4. Conserver base endommagee.
5. Choisir sauvegarde valide recente.
6. Executer verification automatique.
7. Restaurer depuis interface administrateur.
8. Redemarrer conteneur applicatif.
9. Verifier endpoint readiness.
10. Tester connexion administrateur.
11. Tester document commercial complet.
12. Retablir acces public.

## Perte serveur complete

1. Provisionner nouvelle machine.
2. Installer Docker et Caddy.
3. Restaurer secrets production.
4. Recuperer sauvegarde S3 recente.
5. Executer verification automatique.
6. Demarrer stack Docker.
7. Restaurer base validee.
8. Verifier monitoring complet.
9. Basculer DNS public.

## Controle trimestriel

- chronometrer restauration complete
- verifier RTO soixante minutes
- verifier RPO six heures
- documenter chaque anomalie
- corriger procedure immediatement
