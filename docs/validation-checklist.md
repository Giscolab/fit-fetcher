# Checklist de validation du pipeline Fit Fetcher

## Entrées

- Le fichier source contient `brand` et `size_guide_url` ou `entry_url`.
- L'audience cible (`audience`, ex. `men`) est explicite quand une marque expose des guides homme/femme sur le même hub.
- La catégorie demandée est explicite quand la page contient plusieurs familles de produits.
- Le système de taille demandé est explicite quand les tailles numériques peuvent être ambiguës.

## Accès aux sources réelles

- La récupération HTTP statique est essayée en premier.
- Firecrawl est utilisé uniquement comme fallback pour pages JavaScript, modales ou contenu non présent dans le HTML.
- L'URL finale résolue, l'URL demandée et la chaîne de liens suivis sont conservées dans le rapport.
- Les fallbacks officiels connus ne sont utilisés que si les liens découverts sur la page ne suffisent pas.

## Extraction

- Les tableaux HTML, grilles ARIA, tableaux Markdown et grilles Markdown sont détectés séparément.
- L'orientation `size-rows`, `size-columns` ou `conversion-grid` est déterminée avant extraction.
- Les unités `cm` sont préférées; les pouces sont convertis en centimètres avec arrondi à 0,1 cm.
- Les fractions officielles comme `32 1/2–34"` doivent conserver les bornes basse et haute.
- Les grilles de conversion seules ne doivent pas générer de mesures corporelles inventées.

## Validation métier

- Une page multi-guide ne doit pas fusionner hauts, bas et chaussures.
- Un guide haut ne doit pas contenir d'entrejambe.
- Un guide bas ne doit pas contenir de poitrine.
- Une page chaussures ne doit pas devenir un guide textile.
- Les tailles visibles dans la source ne doivent pas être inventées, supprimées ou renommées sans avertissement.

## Cohabitation logiciel principal

- Chaque guide accepté exporte un JSON `{ brand, guide }` compatible avec l'import JSON du logiciel principal.
- Les catégories scraper sont mappées vers les catégories du logiciel principal (`tshirts -> tshirt`, `shirts -> chemise`, `pants -> pantalon`, etc.).
- Les dimensions non prises en charge par le schéma courant du logiciel principal sont signalées en avertissement.
- Le ZIP contient les exports compatibles dans `logiciel-principal/` et l'ancien export strict dans `export-strict-historique/`.

## Validation technique

- Exécuter `npm run test:ingestion`.
- Exécuter `npm run lint`.
- Exécuter `npm run build`.
- Tester au moins un guide officiel Nike, adidas et PUMA avec une URL réelle avant livraison.
