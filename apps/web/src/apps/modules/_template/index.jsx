import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { api } from "../../../api/client";
import { useTraduction, useDevise } from "../../../utils/intl";

// ---------------------------------------------------------------------------
// MODÈLE DE MODULE COMPANYOS
//
// Pour créer une app métier :
//   1. Copier ce dossier vers src/apps/modules/<slug>/
//   2. Adapter le `manifest` ci-dessous
//   3. Ajouter l'app au catalogue dans server/prisma/seed.js avec le MÊME slug,
//      puis relancer  node prisma/seed.js
//   4. Écrire le contenu de la fenêtre
//
// Pour une app **système** (visionneuse, utilitaire du socle) : mettre
// `systeme: true` et supprimer `slug`. Les étapes 3 disparaît — elle est
// montée d'office, sans installation.
//
// Le dossier _template est ignoré par le registre : il ne s'affiche jamais.
// Les dossiers préfixés par _ le sont tous, ce qui permet d'y ranger du
// code partagé entre plusieurs apps (voir _visionneuse).
//
// Règles à respecter :
//   - `id` doit être UNIQUE dans tout l'OS : c'est l'identité de la fenêtre
//   - `icon` doit être un PNG existant dans public/img/icon/, mais il peut
//     être partagé avec une autre application
//   - `slug` doit correspondre au slug du catalogue côté serveur
//
// Persistance : pas de migration à écrire. Rangez vos données via
// api.records dans (module, collection) — les deux sont libres :
//
//   await api.records.create("<slug>", "clients", { nom: "Awa", ville: "Abidjan" })
//   const clients = await api.records.list("<slug>", "clients")
//   await api.records.update("<slug>", "clients", id, { ...donnees })
//   await api.records.remove("<slug>", "clients", id)
//
// Les données sont automatiquement cloisonnées par espace de travail.
//
// Travailler à plusieurs. Un espace contient des collègues, pas un seul
// utilisateur — écrivez pour cette réalité dès le premier écran :
//
//   - chaque fiche revient du serveur avec `auteur` et `modifiePar` :
//     posez <Auteur record={fiche} /> en bas du formulaire de détail ;
//   - pour montrer quelqu'un, <Avatar user={membre} taille={24} />, jamais
//     une <img> à la main : la photo est facultative ;
//   - la liste des collègues vient de `api.members()`, ouverte à tous ;
//   - pour prévenir quelqu'un, `envoyerA(id, { source, titre, lien })` —
//     jamais pour du bruit, seulement ce qu'on attend de lui.
//
// Voir la partie 7 de docs/CREER-UNE-APP.md.
//
// Langue et devise. L'OS s'affiche en français ou en anglais et convertit
// les montants (FCFA/€/$) selon le réglage « Langue et région ». Une app
// suit ce réglage en déclarant ses textes par langue (TEXTES ci-dessous,
// `useTraduction`) et en formatant tout montant via `useDevise().montant`
// — jamais de « ... F » écrit à la main. Voir la partie 8 du guide.
// ---------------------------------------------------------------------------

/// Les textes de l'app, par langue. Le repli est par clé : une entrée
/// absente en anglais garde sa version française plutôt que de disparaître.
const TEXTES = {
  fr: {
    compteur: "Contenu du module. {n} enregistrement(s).",
    exemple: "Un montant se formate ainsi : {m}.",
  },
  en: {
    compteur: "Module content. {n} record(s).",
    exemple: "An amount is formatted like this: {m}.",
  },
};

export const manifest = {
  // Identité de la fenêtre — le seul champ qui doit être unique dans l'OS.
  id: "template",
  // Slug du catalogue serveur : c'est lui qui décide de l'installation.
  // À retirer, avec `systeme: true` à la place, pour une app du socle.
  slug: "template",
  name: "Mon module",
  // Un PNG de public/img/icon. Plusieurs applications peuvent partager la
  // même image : ce n'est pas une clé.
  icon: "notes",
  Window: TemplateApp,
};

function TemplateApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id || manifest.icon]);
  const session = useSelector((state) => state.session);
  const [items, setItems] = useState([]);
  // `t` et `montant` suivent le réglage « Langue et région » : la fenêtre
  // se re-rend toute seule quand l'utilisateur en change.
  const t = useTraduction(TEXTES);
  const { montant } = useDevise();

  // Charge les données à l'ouverture de la fenêtre.
  useEffect(() => {
    if (!wnapp || wnapp.hide || session.status !== "authenticated") return;
    api.records
      .list(manifest.slug, "items")
      .then(setItems)
      .catch(() => setItems([]));
  }, [wnapp?.hide, session.status]);

  return (
    <ModuleWindow manifest={manifest} className="templateApp">
      <div style={{ padding: 20 }}>
        <p>{t("compteur", { n: items.length })}</p>
        <p>{t("exemple", { m: montant(15000) })}</p>
      </div>
    </ModuleWindow>
  );
}
