# Audit du stockage navigateur

## Source principale Supabase

- Catalogue, stock, produits et mouvements.
- Paramètres et coordonnées entreprise.
- Logo entreprise via Storage.
- Logos de marques et mentions légales.
- Clients, articles, historiques et documents métier.
- Réglages fiscaux et comptables organisationnels.
- Brouillons logistiques d'importation.

## Stockage local autorisé

- `is_theme`, `is_lang`, `is_currency`.
- `is_font_size`, `is_font_family`, `is_font_color`.
- `hz_settings_visual`, `is_active_page`.
- État visuel du menu.
- Identifiants de notifications déjà affichées.

## Session locale autorisée

- `auth_token`, limité à l'onglet actif.

## Migration automatique

Au premier chargement administrateur, anciennes données professionnelles utiles sont importées vers Supabase. Anciennes copies locales sont ensuite supprimées. Aucune utilisation IndexedDB détectée.
