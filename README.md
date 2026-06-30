# Assignation de bureaux — GMF-U Saint-Jean-sur-Richelieu

Application web pour consulter l’assignation des locaux : **par jour**, **par personne** et **par local**.
Données : 36 locaux × 3 plages horaires (AM / PM / Soir), du 29 décembre 2025 au 12 octobre 2026.

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir l’adresse affichée (par défaut http://localhost:5173).

## Déployer sur Vercel via GitHub

1. Créer un dépôt GitHub et y pousser ce dossier :
   ```bash
   git init
   git add .
   git commit -m "Assignation de bureaux"
   git branch -M main
   git remote add origin https://github.com/VOTRE-COMPTE/gmfu-bureaux.git
   git push -u origin main
   ```
2. Sur https://vercel.com → **Add New… → Project** → importer le dépôt.
3. Vercel détecte Vite automatiquement (build `vite build`, sortie `dist`). Cliquer **Deploy**.

## Mettre à jour les données

Les données sont dans `src/data.json` (généré à partir du CSV original).
Pour régénérer après une nouvelle version du CSV, adaptez le script de conversion puis remplacez `src/data.json`.

## Structure

- `src/App.jsx` — interface et logique (vues Jour / Personne / Local)
- `src/styles.css` — styles
- `src/data.json` — horaire complet
