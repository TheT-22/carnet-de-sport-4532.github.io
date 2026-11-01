# Carnet de musculation

Application web de suivi d'entraînement : séance du jour, check-in de forme, saisie des séries, charges conseillées, remplacements d'exercice, bilans et courbes de progression. Elle fonctionne hors ligne une fois ouverte.

## Données personnelles

- **Aucune donnée d'utilisateur n'est stockée dans ce dépôt ni envoyée sur Internet.** Séances, pesées, douleurs et bilans restent dans le stockage local du téléphone (`localStorage`).
- L'application ne fait aucune requête vers un autre site : la règle `Content-Security-Policy` de `index.html` l'interdit au navigateur (pas de statistiques, pas de publicité, police hébergée localement).
- Le programme de chaque athlète n'est pas dans ce dépôt. Il est contenu dans son lien personnel, après `#p=`. Cette partie du lien n'est jamais transmise au serveur.
- Les seules sorties de données se font à l'initiative de l'utilisateur : « Exporter mes données » (fichier de sauvegarde) et « Demander à Claude » (texte copié que l'utilisateur colle lui-même).

## Fichiers

- `index.html`, `styles.css`, `app.js` : l'application.
- `sw.js`, `manifest.webmanifest`, `icons/` : installation sur l'écran d'accueil et mode hors ligne.
- `fonts/` : police Archivo (licence SIL Open Font License, voir `fonts/OFL-Archivo.txt`).

À chaque nouvelle version, augmenter `CACHE` dans `sw.js` et `APP_VERSION` dans `app.js`.
