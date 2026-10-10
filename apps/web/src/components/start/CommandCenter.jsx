import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { ouvrirDossier } from "../../apps/explorerRequest";
import { ouvrirFichier } from "../../apps/openRequest";
import { etatFenetre, ouvrirFenetre } from "../../apps/windows";
import { Icon } from "../../utils/general";
import { classerResultats } from "./recherche";
import { referentiel } from "../../apps/referentiel";
import { suivreLien } from "../../apps/notifications";

const COMMANDES = [
  {
    id: "nouvelle-presentation",
    titre: "Créer une présentation",
    aide: "CompanyOS Slides",
    mots: "nouveau powerpoint pitch rapport diaporama",
    icone: "presentation",
    executer: () => ouvrirFenetre("presentation"),
  },
  {
    id: "nouvelle-app",
    titre: "Créer une application",
    aide: "Ouvrir le Studio",
    mots: "nouveau nocode données métier studio",
    icone: "studio",
    // Un raccourci de création ne doit jamais sembler cassé : si le Studio
    // n'est pas encore installé dans cet espace, on conduit l'utilisateur
    // vers la Boutique où il peut l'ajouter.
    executer: () => ouvrirFenetre(etatFenetre("studio") ? "studio" : "store"),
  },
  {
    id: "nouveau-document",
    titre: "Créer un document",
    aide: "Ouvrir Documents",
    mots: "nouveau word texte lettre",
    icone: "winWord",
    executer: () => ouvrirFenetre("word"),
  },
  {
    id: "cloud",
    titre: "Parcourir le cloud",
    aide: "Ouvrir l’Explorateur",
    mots: "fichiers documents dossiers stockage",
    icone: "explorer",
    executer: () => ouvrirDossier(null),
  },
  {
    id: "reglages",
    titre: "Ouvrir les paramètres",
    aide: "Personnaliser CompanyOS",
    mots: "réglages apparence compte espace",
    icone: "settings",
    executer: () => ouvrirFenetre("settings"),
  },
];

const typeFichier = (node) => {
  if (node.type === "FOLDER") return "Dossier cloud";
  const extension = node.name.split(".").pop();
  return extension && extension !== node.name
    ? `Document ${extension.toUpperCase()}`
    : "Document cloud";
};

export const CommandCenter = ({ apps, nomApp, fermer }) => {
  const [requete, setRequete] = useState("");
  const [noeuds, setNoeuds] = useState([]);
  const [clients, setClients] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [selection, setSelection] = useState(0);
  const champ = useRef(null);

  useEffect(() => {
    let actif = true;
    api
      .arborescence()
      .then((arbre) => actif && setNoeuds(arbre.noeuds || []))
      .catch(() => actif && setNoeuds([]))
      .finally(() => actif && setChargement(false));
    // Les comptes du CRM : taper « Kouadio » ou « Ivoire Bâtiment » ouvre
    // directement la fiche, sans passer par l'application.
    if (apps.some((a) => a.id === "crm")) {
      referentiel
        .clients()
        .then((liste) => actif && setClients(liste || []))
        .catch(() => {});
    }
    return () => {
      actif = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const elements = useMemo(() => {
    const commandes = COMMANDES.map((commande) => ({
      ...commande,
      genre: "Action rapide",
    }));
    const applications = apps.map((app) => ({
      id: `app-${app.id || app.icon}`,
      titre: nomApp(app),
      aide: app.description || "Application CompanyOS",
      mots: `${app.name || ""} ${app.category || ""}`,
      genre: "Application",
      icone: app.icon,
      executer: () => ouvrirFenetre(app.id || app.icon),
    }));
    const fichiers = noeuds.map((node) => ({
      id: `node-${node.id}`,
      titre: node.name,
      aide: typeFichier(node),
      mots: `${node.mimeType || ""} ${node.type}`,
      genre: node.type === "FOLDER" ? "Dossier" : "Fichier",
      icone: node.type === "FOLDER" ? "win/folder" : "win/docs",
      executer: () =>
        node.type === "FOLDER" ? ouvrirDossier(node.id) : ouvrirFichier(node, noeuds),
    }));
    const comptes = clients.map((c) => ({
      id: `crm-${c.id}`,
      titre: c.data?.entreprise || c.data?.nom || "",
      aide: ["Compte CRM", c.data?.entreprise ? c.data?.nom : "", c.data?.ville].filter(Boolean).join(" · "),
      mots: `${c.data?.nom || ""} ${c.data?.email || ""} ${c.data?.telephone || ""} ${c.data?.ville || ""}`,
      genre: "Compte",
      icone: "people",
      executer: () => suivreLien({ lien: { app: "crm", params: { client: c.id } } }),
    }));
    return [...commandes, ...applications, ...comptes, ...fichiers];
  }, [apps, noeuds, nomApp, clients]);

  const resultats = useMemo(
    () => classerResultats(elements, requete, requete ? 14 : 8),
    [elements, requete],
  );

  useEffect(() => setSelection(0), [requete]);
  useEffect(() => champ.current?.focus(), []);

  const lancer = (resultat) => {
    if (!resultat) return;
    resultat.executer();
    fermer();
  };

  const clavier = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelection((index) => Math.min(index + 1, resultats.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelection((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      lancer(resultats[selection]);
    } else if (event.key === "Escape") {
      fermer();
    }
  };

  return (
    <div className="cmdCentre" role="dialog" aria-label="Centre de commande">
      <div className="cmdRecherche">
        <Icon src="search" width={18} />
        <input
          ref={champ}
          value={requete}
          onChange={(event) => setRequete(event.target.value)}
          onKeyDown={clavier}
          placeholder="Rechercher une app, un fichier ou une action…"
          aria-label="Rechercher dans CompanyOS"
          aria-controls="cmd-resultats"
          aria-activedescendant={resultats[selection]?.id}
        />
        <kbd>ESC</kbd>
      </div>

      <div className="cmdContexte">
        <span>{requete ? `${resultats.length} résultats` : "Accès rapide"}</span>
        <span className="cmdPortee">Applications · Cloud · Actions</span>
      </div>

      <div className="cmdResultats cosScroll" id="cmd-resultats" role="listbox">
        {resultats.map((resultat, index) => (
          <button
            type="button"
            id={resultat.id}
            key={resultat.id}
            className="cmdResultat"
            data-selectionne={index === selection}
            role="option"
            aria-selected={index === selection}
            onMouseEnter={() => setSelection(index)}
            onClick={() => lancer(resultat)}
          >
            <span className="cmdResultatIcone">
              <Icon src={resultat.icone} width={23} />
            </span>
            <span className="cmdResultatTexte">
              <b>{resultat.titre}</b>
              <small>{resultat.aide}</small>
            </span>
            <span className="cmdResultatGenre">{resultat.genre}</span>
            {index === selection ? <kbd>↵</kbd> : null}
          </button>
        ))}

        {!resultats.length && !chargement ? (
          <div className="cmdVide">
            <Icon src="search" width={25} />
            <b>Aucun résultat</b>
            <span>Essayez un nom d’application, de document ou une action.</span>
          </div>
        ) : null}
      </div>

      <div className="cmdPied">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> naviguer
        </span>
        <span>
          <kbd>↵</kbd> ouvrir
        </span>
        <b>COMPANYOS COMMAND</b>
      </div>
    </div>
  );
};
