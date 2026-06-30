# Assignation des bureaux — GMF-U Saint-Jean-sur-Richelieu

Application web (React + Vite) pour consulter et **modifier** l'assignation des
locaux par jour, semaine et mois, gérer le personnel, et **enregistrer le tout
dans une base de données** partagée.

## Vues
- **Jour** — grille locaux × plages (AM / PM / Soir) avec taux d'occupation.
- **Semaine** — grille locaux × 7 jours pour une plage choisie ; surlignage d'une personne.
- **Mois** — calendrier avec occupation quotidienne, ou les jours d'une personne.
- **Personne / Local** — horaire à venir d'une personne ou d'un local.
- **Statistiques** — taux d'occupation global, par plage, par jour de la semaine,
  par trimestre et par titre d'emploi ; filtrable par trimestre ; export CSV.
- **Personnel** — ajouter, renommer (mise à jour de tout l'horaire), définir le
  titre d'emploi, ou retirer une personne.

## Exports
- **CSV** des statistiques (onglet Statistiques → « Exporter en CSV »), avec BOM
  pour un affichage correct des accents dans Excel.
- **Calendrier .ics** par personne (onglet Personne → « Ajouter au calendrier »).
  Le fichier s'importe dans Outlook, Google Agenda ou Apple Calendrier. Pour un
  envoi automatique dans le Outlook de chaque personne, une intégration Microsoft
  365 (Graph API) serait nécessaire — c'est un ajout possible plus tard.

L'édition s'active avec le bouton **« Modifier l'horaire »**. Les changements
sont enregistrés automatiquement (indicateur en haut à droite).

## Démarrage local
```bash
npm install
npm run dev
```
Sans base de données configurée, l'app enregistre dans le navigateur (localStorage).

## Base de données (Supabase — gratuit)

1. Crée un compte sur https://supabase.com et un nouveau projet.
2. Dans le projet : **SQL Editor → New query**, colle et exécute :

```sql
create table if not exists schedule (
  id text primary key,
  doc jsonb not null,
  updated_at timestamptz default now()
);
alter table schedule enable row level security;

-- Accès lecture/écriture via la clé anonyme.
-- ⚠️ Voir la note de sécurité plus bas avant de mettre en ligne publiquement.
create policy "anon read"  on schedule for select using (true);
create policy "anon write" on schedule for insert with check (true);
create policy "anon update" on schedule for update using (true) with check (true);
```

3. **Project Settings → API** : copie *Project URL* et la clé *anon public*.
4. Dans Vercel : **Project → Settings → Environment Variables**, ajoute
   `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`, puis redéploie.

Au premier chargement, l'horaire actuel est automatiquement copié dans la base.
Ensuite, toute modification est synchronisée et visible par tous.

## ⚠️ Sécurité — données internes

Avec les règles ci-dessus, **toute personne connaissant l'adresse du site peut
lire et modifier** l'horaire (la clé « anon » est publique dans le code). Pour
des données de clinique, choisis au moins une protection :

- **Protection par mot de passe Vercel** (Settings → Deployment Protection), ou
- **Authentification Supabase** (connexion par courriel) avec des règles RLS
  restreintes aux comptes autorisés.

Je peux ajouter l'une ou l'autre sur demande.

## Déploiement
Pousser sur GitHub puis importer le dépôt dans Vercel (framework détecté : Vite).
Aucune configuration de build nécessaire.
