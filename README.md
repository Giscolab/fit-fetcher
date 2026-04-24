# Fit Fetcher

Scraper de guides de tailles pour enrichir le logiciel principal en mode
cohabitation. Le pipeline récupère les pages réelles, isole les tableaux
exploitables, valide les dimensions et exporte un JSON compatible avec l'import
`{ brand, guide }` du logiciel principal.

## Fonctionnement

- Récupération HTTP statique en premier pour les pages officielles simples.
- Fallback Firecrawl pour les pages JavaScript ou les modales de guide de tailles.
- Découverte contrôlée des liens internes et fallbacks officiels connus
  Nike/adidas/PUMA quand la page fournie ne contient pas directement le tableau.
- Export ZIP avec:
  - `logiciel-principal/`: JSON compatible cohabitation.
  - `export-strict-historique/`: ancien JSON strict `tshirts/INT`.
- Interface, journaux et actions utilisateur en français.

## Environnement

Le scraper peut fonctionner sans clé Firecrawl sur les pages HTML statiques. Pour
les pages JavaScript, les modales ou les contenus non rendus dans le HTML initial,
il utilise Firecrawl depuis une fonction serveur et nécessite `FIRECRAWL_API_KEY`.

Pour le développement local Vite/TanStack, copier `.env.example` vers `.env.local`
et remplacer la valeur d'exemple:

```sh
FIRECRAWL_API_KEY=fc-YOUR_FIRECRAWL_API_KEY
```

Pour un déploiement Cloudflare, créer un secret Worker:

```sh
npx wrangler secret put FIRECRAWL_API_KEY
```

## Validation

```sh
npm run test:ingestion
npm run lint
npm run build
```

La checklist détaillée est disponible dans `docs/validation-checklist.md`.
