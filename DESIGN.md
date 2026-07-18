# Design System: IntelSpark ERP-AH — Stitch Workspace

## 1. Visual Theme & Atmosphere

Interface de gestion calme, clinique et chaleureuse. Densité quotidienne équilibrée (5/10), variation maîtrisée (4/10), mouvement fluide et discret (4/10). Les données restent prioritaires. Chaque écran suit un rythme vertical identique : saisie, indicateurs, résultats.

## 2. Color Palette & Roles

- **Canvas Mist** (`#F5F7FA`) — fond unique de toutes les sessions.
- **Pure Surface** (`#FFFFFF`) — formulaires, tableaux et tiroirs.
- **Charcoal Ink** (`#172033`) — texte principal, jamais noir pur.
- **Slate Copy** (`#667085`) — descriptions et métadonnées.
- **Whisper Line** (`#E6EAF0`) — bordures structurelles de 1 px.
- **Cobalt Stitch** (`#3F63D8`) — accent unique : action principale, sélection, focus.
- **Cobalt Wash** (`#EEF2FF`) — fond des éléments sélectionnés.
- **Mint Wash** (`#EAF7F0`) — statut validé.
- **Amber Wash** (`#FFF5DF`) — statut en attente.
- **Rose Wash** (`#FDEEEF`) — erreur ou annulation.

## 3. Typography Rules

- **Interface et titres :** Geist, graisse 500 ou 600, suivi légèrement serré.
- **Corps :** Geist, graisse 400, interligne 1.55, largeur recommandée 65 caractères.
- **Données :** Geist Mono ou chiffres tabulaires, graisse 400.
- Titres de page : `clamp(1.55rem, 2vw, 2rem)`.
- Libellés : 0.78–0.86 rem, anthracite lisible.
- Les réglages utilisateur de taille et couleur continuent à s’appliquer globalement.

## 4. Component Stylings

- **Grands conteneurs :** rayon 12 px, surface blanche, bordure 1 px, ombre froide très diffuse.
- **Boutons et champs :** rayon 8 px, hauteur minimale 42 px, retour pressé `translateY(1px)`.
- **Champs :** label au-dessus, focus cobalt doux, aucune ombre noire.
- **Indicateurs :** chiffres larges et légers, libellé discret dessous, chiffres tabulaires.
- **Tableaux :** en-tête gris très pâle, filets fins, survol bleu brumeux, statuts pastel arrondis.
- **États vides :** composition textuelle calme avec action pertinente, jamais une zone vide.
- **Chargement :** skeletons dimensionnés, aucun spinner agressif.

## 5. Layout Principles

- Contenu limité à 1480 px et centré.
- Espacement de page : 24–32 px sur bureau, 16 px sur mobile.
- Canevas vertical : bloc de saisie, bloc d’indicateurs, bloc tableau/résultats.
- Grille CSS responsive ; passage en colonne unique sous 768 px.
- Aucun débordement horizontal global. Les tableaux seuls peuvent défiler dans leur conteneur.
- Menu latéral masqué par défaut et ouvert par commande utilisateur, sans modifier ce comportement.

## 6. Motion & Interaction

- Transitions 180–240 ms avec courbe `cubic-bezier(.2,.8,.2,1)`.
- Animations uniquement par transform et opacité.
- Hover : déplacement maximum de 1 px ; active : pression de 1 px.
- Focus clavier toujours visible avec anneau cobalt de 3 px.
- Tiroir communication : glissement fluide depuis la droite.

## 7. Communication Drawer

- Surface blanche, largeur maximale 720 px, ombre froide diffuse.
- Onglets fins et soulignement cobalt.
- Reçu : gauche, bulle gris brume `#F1F3F6`.
- Envoyé : droite, bulle cobalt `#3F63D8`, texte blanc.
- Emails : navigation type boîte de réception, lignes compactes et lisibles.

## 8. Anti-Patterns (Banned)

- Aucun thème noir, beige ou or dans l’application.
- Aucun fond saturé, contour épais, ombre noire, halo néon ou gradient violet.
- Aucun noir pur `#000000`.
- Aucun arrondi géant sur les conteneurs métier.
- Aucun emoji utilisé comme fondement de l’iconographie de navigation.
- Aucun contenu qui se chevauche.
- Aucun changement des workflows, permissions, données ou fonctionnalités métier pour servir le design.
