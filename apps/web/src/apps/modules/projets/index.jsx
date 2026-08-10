import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { saveAs, saveToCloud } from "../../cloud";
import { modal } from "../../modalRequest";
import { ouvrirFichier } from "../../openRequest";
import { accesDonnees } from "../../donnees";
import { envoyerA } from "../../notifications";
import {
  COLONNES_PAR_DEFAUT,
  ETIQUETTES,
  FILTRE_VIDE,
  avancementChecklist,
  besoinDeRenumeroter,
  cartesDe,
  deplacerDansListe,
  etiquetteDe,
  filtrer,
  filtreActif,
  formatEcheance,
  idCourt,
  rangPour,
  renumeroter,
  statistiques,
  statutEcheance,
  versCsv,
} from "./board";
import "./projets.scss";

// Gestion de projet de CompanyOS — tableaux kanban.
//
// Ce qui distingue ce module d'un Trello : il vit dans l'OS et parle aux
// autres apps. Une carte se rattache à un client du CRM, à une facture, à
// un fichier du cloud ; ses pièces jointes s'ouvrent dans les visionneuses
// système ; l'export atterrit dans l'Explorateur. Les personnes à qui on
// assigne une tâche sont les vrais membres de l'espace de travail, pas du
// texte libre.
//
// Données : deux collections dans `api.records`.
//   tableaux — { nom, couleur, colonnes: [{id, titre}] }
//   cartes   — { tableauId, colonneId, ordre, titre, description, echeance,
//                assigneId, etiquettes[], checklist[], commentaires[],
//                liens: { clientId, factureId }, pieces[] }

export const manifest = {
  id: "projets",
  slug: "projets",
  version: "1.1.0",
  /// Annoncé dans la Boutique quand une mise à jour est disponible.
  /// Seules les entrées postérieures à la version installée sont montrées.
  nouveautes: [
    { version: "1.1.0", texte: "Notification à l'attribution d'une tâche." },
  ],
  name: "Projets",
  icon: "todo",
  action: "PROJETSAPP",
  // Ce que l'application va chercher hors de chez elle. Déclaré ici, montré
  // à l'utilisateur avant l'installation, et vérifié en développement par
  // `accesDonnees`. Voir src/apps/donnees.js pour ce que cela garantit —
  // et surtout pour ce que cela ne garantit pas.
  capacites: {
    lit: ["crm:clients", "facturation:factures"],
    ecrit: ["facturation:factures"],
  },
  Window: ProjetsApp,
};

/// Accès aux données de l'application, borné par les capacités ci-dessus.
const donnees = accesDonnees(manifest);

const COULEURS_TABLEAU = [
  "#0079bf",
  "#519839",
  "#b04632",
  "#89609e",
  "#cd5a91",
  "#4bbf6b",
];

const VUES = [
  { id: "tableau", label: "Tableau", icone: "faTableColumns" },
  { id: "liste", label: "Liste", icone: "faListUl" },
  { id: "echeances", label: "Échéances", icone: "faCalendarDay" },
];

// ---- Rendu d'une carte --------------------------------------------------

/// Initiales d'un nom, pour les pastilles d'avatar. Au niveau module :
/// passée en prop à des cartes mémorisées, une fonction recréée à chaque
/// rendu annulerait la mémorisation.
const initiales = (nom = "") =>
  nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0].toUpperCase())
    .join("");

/// Carte du tableau.
///
/// Défini au niveau du module, et surtout PAS à l'intérieur de
/// `ProjetsApp` : un composant déclaré dans le corps d'un autre est vu
/// comme un type neuf à chaque rendu, donc React démonte et remonte
/// toutes les cartes. Pendant un glisser — où l'état change à chaque
/// mouvement — le nœud tiré était détruit aussitôt et le navigateur
/// annulait le déplacement.
const Carte = React.memo(function Carte({
  carte,
  index,
  colonneId,
  terminee,
  membre,
  client,
  glissee,
  initiales,
  onGlisserDebut,
  onGlisserFin,
  onSurvol,
  onDepot,
  onOuvrir,
}) {
  const d = carte.data;
  const av = avancementChecklist(d.checklist);
  const ech = statutEcheance(d.echeance, terminee);

  return (
    <div
      className="pjCarte"
      draggable
      data-glissee={glissee ? "true" : "false"}
      onDragStart={(e) => {
        // Sans `setData`, le navigateur n'initie tout simplement pas le
        // glisser : c'est ce qui donne l'impression que les cartes sont
        // collées. Le contenu importe peu, sa présence est obligatoire.
        e.dataTransfer.setData("text/plain", carte.id);
        e.dataTransfer.effectAllowed = "move";
        onGlisserDebut(carte, colonneId);
      }}
      onDragEnd={onGlisserFin}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = e.currentTarget.getBoundingClientRect();
        const apres = e.clientY > r.top + r.height / 2;
        onSurvol(colonneId, index + (apres ? 1 : 0));
      }}
      onDrop={(e) => {
        // La carte est elle-même une cible : déposer sur une carte doit
        // insérer à côté d'elle, pas retomber sur la colonne entière.
        e.preventDefault();
        e.stopPropagation();
        onDepot(colonneId, index);
      }}
      onClick={() => onOuvrir(carte)}
    >
      {(d.etiquettes || []).length ? (
        <div className="pjEtiquettes">
          {d.etiquettes.map((id) => {
            const e = etiquetteDe(id);
            return e ? (
              <span
                key={id}
                className="pjEtiquette"
                style={{ background: e.couleur }}
                title={e.nom}
              />
            ) : null;
          })}
        </div>
      ) : null}

      <div className="pjCarteTitre">{d.titre}</div>

      {client ? (
        <div className="pjCarteClient">
          <Icon fafa="faBuilding" width={9} />
          {client.data.entreprise || client.data.nom}
        </div>
      ) : null}

      <div className="pjCartePied">
        {d.echeance ? (
          <span className="pjEcheance" data-etat={ech}>
            <Icon fafa="faClock" width={9} />
            {formatEcheance(d.echeance)}
          </span>
        ) : null}
        {d.description ? (
          <span className="pjIndice" title="Cette carte a une description">
            <Icon fafa="faAlignLeft" width={9} />
          </span>
        ) : null}
        {av ? (
          <span
            className="pjIndice"
            data-complet={av.complet ? "true" : "false"}
          >
            <Icon fafa="faSquareCheck" width={9} />
            {av.faits}/{av.total}
          </span>
        ) : null}
        {(d.commentaires || []).length ? (
          <span className="pjIndice">
            <Icon fafa="faComment" width={9} />
            {d.commentaires.length}
          </span>
        ) : null}
        {(d.pieces || []).length ? (
          <span className="pjIndice">
            <Icon fafa="faPaperclip" width={9} />
            {d.pieces.length}
          </span>
        ) : null}
        {membre ? (
          <span className="pjAvatar" title={membre.name}>
            {initiales(membre.name)}
          </span>
        ) : null}
      </div>
    </div>
  );
});

function ProjetsApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id || manifest.icon]);
  const session = useSelector((state) => state.session);

  const [tableaux, setTableaux] = useState([]);
  const [tableauId, setTableauId] = useState(null);
  const [cartes, setCartes] = useState([]);
  const [membres, setMembres] = useState([]);
  const [clients, setClients] = useState([]);
  const [factures, setFactures] = useState([]);

  const [vue, setVue] = useState("tableau");
  const [filtre, setFiltre] = useState(FILTRE_VIDE);
  const [carteOuverte, setCarteOuverte] = useState(null);
  const [composeur, setComposeur] = useState(null); // id de colonne
  const [saisie, setSaisie] = useState("");
  const [glisse, setGlisse] = useState(null); // { carteId, colonneId }
  // Réordonnancement des tâches d'une check-list.
  const [glisseTache, setGlisseTache] = useState(null);
  const [cibleTache, setCibleTache] = useState(null);
  const [cible, setCible] = useState(null); // { colonneId, position }
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pieceInput = useRef(null);

  const ouvert = wnapp && !wnapp.hide && session.status === "authenticated";

  const flash = (m) => {
    setNotice(m);
    setTimeout(() => setNotice(""), 2800);
  };

  // ---- Chargement ---------------------------------------------------------

  const charger = async () => {
    try {
      // Les données des autres modules sont lues, jamais dupliquées : le
      // CRM reste la source de vérité pour ses clients.
      const [tbx, crt, mbr, cli, fct] = await Promise.all([
        api.records.list(manifest.slug, "tableaux"),
        api.records.list(manifest.slug, "cartes"),
        api.members().catch(() => []),
        donnees.lire("crm", "clients").catch(() => []),
        donnees.lire("facturation", "factures").catch(() => []),
      ]);
      setTableaux(tbx);
      setCartes(crt);
      setMembres(mbr);
      setClients(cli);
      setFactures(fct);
      setTableauId((id) => id || tbx[0]?.id || null);
    } catch (err) {
      flash(err.message);
    }
  };

  useEffect(() => {
    if (ouvert) charger();
  }, [ouvert]);

  // Arrivée depuis une notification : « Awa vous a attribué une tâche »
  // doit ouvrir *cette* carte, pas la fenêtre au hasard où on l'avait
  // laissée. Le shell ouvre la fenêtre puis émet `companyos:lien` ; c'est
  // à l'application de savoir quoi en faire.
  //
  // La demande est conservée le temps que les cartes arrivent : au premier
  // lancement, le clic précède le chargement.
  const lienEnAttente = useRef(null);

  useEffect(() => {
    const aller = (e) => {
      if (e.detail?.app !== (manifest.id || manifest.slug)) return;
      lienEnAttente.current = e.detail.params?.carte || null;
      appliquerLien();
    };
    window.addEventListener("companyos:lien", aller);
    return () => window.removeEventListener("companyos:lien", aller);
  }, [cartes]);

  const appliquerLien = () => {
    const vise = lienEnAttente.current;
    if (!vise) return;
    const carte = cartes.find((c) => c.id === vise);
    if (!carte) return; // pas encore chargées : on retentera après `charger()`
    lienEnAttente.current = null;
    setTableauId(carte.data.tableauId);
    setCarteOuverte(carte);
  };

  useEffect(appliquerLien, [cartes]);

  const tableau = tableaux.find((t) => t.id === tableauId) || null;
  const colonnes = tableau?.data.colonnes || [];

  const cartesTableau = useMemo(
    () => cartes.filter((c) => c.data.tableauId === tableauId),
    [cartes, tableauId]
  );

  const stats = useMemo(
    () => statistiques(tableau, cartesTableau),
    [tableau, cartesTableau]
  );

  const cartesVisibles = useMemo(
    () => filtrer(cartesTableau, filtre, stats.colonneTerminee),
    [cartesTableau, filtre, stats.colonneTerminee]
  );

  const membreDe = (id) => membres.find((m) => m.id === id);
  const clientDe = (id) => clients.find((c) => c.id === id);
  const factureDe = (id) => factures.find((f) => f.id === id);

  // ---- Tableaux -----------------------------------------------------------

  const creerTableau = async () => {
    const nom = await modal.prompt({
      title: "Nouveau tableau",
      label: "Nom du tableau",
      placeholder: "Refonte du site",
      confirmLabel: "Créer",
    });
    if (!nom) return;
    try {
      const cree = await api.records.create(manifest.slug, "tableaux", {
        nom,
        couleur: COULEURS_TABLEAU[tableaux.length % COULEURS_TABLEAU.length],
        colonnes: COLONNES_PAR_DEFAUT(),
      });
      setTableauId(cree.id);
      await charger();
    } catch (err) {
      flash(err.message);
    }
  };

  const renommerTableau = async () => {
    const nom = await modal.prompt({
      title: "Renommer le tableau",
      label: "Nom",
      value: tableau.data.nom,
      confirmLabel: "Renommer",
    });
    if (!nom) return;
    await majTableau({ nom });
  };

  const supprimerTableau = async () => {
    const ok = await modal.confirm({
      title: "Supprimer le tableau",
      message: `Supprimer « ${tableau.data.nom} » ?`,
      detail: `${cartesTableau.length} carte(s) seront supprimées avec lui. Cette action est irréversible.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      for (const c of cartesTableau) {
        await api.records.remove(manifest.slug, "cartes", c.id);
      }
      await api.records.remove(manifest.slug, "tableaux", tableau.id);
      setTableauId(null);
      await charger();
    } catch (err) {
      flash(err.message);
    }
  };

  const majTableau = async (patch) => {
    const data = { ...tableau.data, ...patch };
    setTableaux((t) =>
      t.map((x) => (x.id === tableau.id ? { ...x, data } : x))
    );
    try {
      await api.records.update(manifest.slug, "tableaux", tableau.id, data);
    } catch (err) {
      flash(err.message);
      await charger();
    }
  };

  // ---- Colonnes -----------------------------------------------------------

  const ajouterColonne = async () => {
    const titre = await modal.prompt({
      title: "Nouvelle colonne",
      label: "Titre",
      placeholder: "En relecture",
      confirmLabel: "Ajouter",
    });
    if (!titre) return;
    await majTableau({ colonnes: [...colonnes, { id: idCourt(), titre }] });
  };

  const renommerColonne = async (col) => {
    const titre = await modal.prompt({
      title: "Renommer la colonne",
      label: "Titre",
      value: col.titre,
      confirmLabel: "Renommer",
    });
    if (!titre) return;
    await majTableau({
      colonnes: colonnes.map((c) => (c.id === col.id ? { ...c, titre } : c)),
    });
  };

  const supprimerColonne = async (col) => {
    const dedans = cartesDe(cartesTableau, col.id);
    const ok = await modal.confirm({
      title: "Supprimer la colonne",
      message: `Supprimer « ${col.titre} » ?`,
      detail: dedans.length
        ? `Ses ${dedans.length} carte(s) seront supprimées.`
        : "Cette colonne est vide.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      for (const c of dedans) {
        await api.records.remove(manifest.slug, "cartes", c.id);
      }
      await majTableau({ colonnes: colonnes.filter((c) => c.id !== col.id) });
      await charger();
    } catch (err) {
      flash(err.message);
    }
  };

  // ---- Cartes -------------------------------------------------------------

  const ajouterCarte = async (colonneId) => {
    const titre = saisie.trim();
    if (!titre) return;
    setSaisie("");
    try {
      await api.records.create(manifest.slug, "cartes", {
        tableauId,
        colonneId,
        ordre: rangPour(
          cartesTableau,
          colonneId,
          cartesDe(cartesTableau, colonneId).length
        ),
        titre,
        description: "",
        etiquettes: [],
        checklist: [],
        commentaires: [],
        pieces: [],
        liens: {},
      });
      await charger();
    } catch (err) {
      flash(err.message);
    }
  };

  /// Écrit une carte, en mettant l'écran à jour tout de suite : un kanban
  /// où la carte n'arrive qu'après l'aller-retour serveur donne
  /// l'impression de coller.
  const majCarte = async (carte, patch) => {
    const data = { ...carte.data, ...patch };
    setCartes((cs) => cs.map((c) => (c.id === carte.id ? { ...c, data } : c)));
    setCarteOuverte((c) => (c && c.id === carte.id ? { ...c, data } : c));
    try {
      await api.records.update(manifest.slug, "cartes", carte.id, data);
      prevenirAssigne(carte, patch);
    } catch (err) {
      flash(err.message);
      await charger();
    }
  };

  /// Attribuer une tâche à quelqu'un sans le lui dire ne sert à rien : le
  /// changement d'assigné part au centre de notifications, qui la portera
  /// jusqu'à la personne où qu'elle se connecte. Le clic sur la
  /// notification rouvre cette carte — voir l'écoute de `companyos:lien`.
  const prevenirAssigne = (carte, patch) => {
    const nouveau = patch.assigneId;
    if (!nouveau || nouveau === carte.data.assigneId) return;
    if (nouveau === session.user?.id) return; // se notifier soi-même n'apprend rien

    envoyerA(nouveau, {
      source: manifest.slug,
      titre: `Tâche attribuée : ${carte.data.titre}`,
      message: [
        tableau?.data?.nom,
        carte.data.echeance
          ? `échéance ${new Date(carte.data.echeance).toLocaleDateString("fr-FR")}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      lien: { app: manifest.id || manifest.slug, params: { carte: carte.id } },
    });
  };

  const supprimerCarte = async (carte) => {
    const ok = await modal.confirm({
      title: "Supprimer la carte",
      message: `Supprimer « ${carte.data.titre} » ?`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.records.remove(manifest.slug, "cartes", carte.id);
      setCarteOuverte(null);
      await charger();
    } catch (err) {
      flash(err.message);
    }
  };

  /// La molette verticale fait défiler la planche horizontalement — c'est
  /// le geste naturel sur un kanban, où il n'y a rien à faire défiler
  /// verticalement au niveau de la planche. On laisse la main à une colonne
  /// qui a encore de quoi défiler chez elle.
  const molettePlanche = (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

    const pile = e.target.closest?.(".pjCartes");
    if (pile) {
      const versLeBas = e.deltaY > 0;
      const peutEncore = versLeBas
        ? pile.scrollTop + pile.clientHeight < pile.scrollHeight - 1
        : pile.scrollTop > 0;
      if (peutEncore) return;
    }

    e.currentTarget.scrollLeft += e.deltaY;
  };

  /// Pendant un glisser, s'approcher d'un bord fait défiler la planche :
  /// sans cela, déposer une carte dans une colonne hors écran demanderait
  /// de relâcher, faire défiler, reprendre.
  const bordPendantGlisser = (e) => {
    if (!glisse) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const marge = 90;

    if (e.clientX - r.left < marge) el.scrollLeft -= 18;
    else if (r.right - e.clientX < marge) el.scrollLeft += 18;
  };

  // ---- Glisser-déposer ----------------------------------------------------
  //
  // Ces trois rappels sont mémorisés : passés à des cartes sous `React.memo`,
  // une nouvelle fonction à chaque rendu annulerait la mémorisation et on
  // retomberait sur des cartes remontées en plein glisser.

  const debutGlisser = React.useCallback(
    (carte, colonneId) => setGlisse({ carteId: carte.id, colonneId }),
    []
  );

  const finGlisser = React.useCallback(() => {
    setGlisse(null);
    setCible(null);
  }, []);

  /// Ne réécrit l'état que si la cible a réellement changé : `dragover` se
  /// déclenche à chaque pixel parcouru, et un rendu par pixel suffirait à
  /// hacher le déplacement.
  const survolCible = React.useCallback((colonneId, position) => {
    setCible((c) =>
      c && c.colonneId === colonneId && c.position === position
        ? c
        : { colonneId, position }
    );
  }, []);

  const deposer = async (colonneId, position) => {
    setCible(null);
    const carte = cartes.find((c) => c.id === glisse?.carteId);
    setGlisse(null);
    if (!carte) return;

    const ordre = rangPour(cartesTableau, colonneId, position, carte);
    await majCarte(carte, { colonneId, ordre });

    // Les rangs finissent par se tasser à force d'intercalations : on remet
    // la colonne à plat quand ils deviennent trop serrés.
    if (besoinDeRenumeroter([...cartesTableau], colonneId)) {
      for (const { carte: c, ordre: o } of renumeroter(
        cartesTableau,
        colonneId
      )) {
        await api.records.update(manifest.slug, "cartes", c.id, {
          ...c.data,
          ordre: o,
        });
      }
      await charger();
    }
  };

  // ---- Intégrations -------------------------------------------------------

  const joindreFichier = async (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = "";
    if (!fichier || !carteOuverte) return;
    setBusy(true);
    try {
      // Toute pièce jointe passe par le cloud de l'espace de travail : elle
      // est donc visible dans l'Explorateur et décomptée du quota, comme
      // n'importe quel fichier. Voir src/apps/README.md.
      const node = await saveToCloud(fichier, fichier.name, {
        folder: "Projets",
      });
      await majCarte(carteOuverte, {
        pieces: [
          ...(carteOuverte.data.pieces || []),
          {
            id: node.id,
            name: node.name,
            type: "FILE",
            mimeType: node.mimeType,
            size: node.size,
          },
        ],
      });
      flash(`« ${node.name} » joint et enregistré dans le cloud`);
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  /// Crée une facture au brouillon pour le client de la carte, dans le
  /// module Facturation. La carte garde le lien : les deux apps parlent du
  /// même document.
  const creerFacture = async () => {
    const clientId = carteOuverte?.data.liens?.clientId;
    if (!clientId) return flash("Rattachez d'abord un client à cette carte.");

    const numeros = factures
      .map((f) => f.data.numero)
      .filter((n) => /^\d{4}-\d+$/.test(n || ""));
    const annee = new Date().getFullYear();
    const suivant = numeros.length
      ? Math.max(...numeros.map((n) => Number(n.split("-")[1]))) + 1
      : 1;
    const numero = `${annee}-${String(suivant).padStart(3, "0")}`;

    const ok = await modal.confirm({
      title: "Créer la facture",
      message: `Créer la facture ${numero} pour « ${
        clientDe(clientId)?.data.entreprise || clientDe(clientId)?.data.nom
      } » ?`,
      detail: `Elle sera créée au brouillon dans le module Facturation, avec « ${carteOuverte.data.titre} » en ligne unique.`,
      confirmLabel: "Créer",
    });
    if (!ok) return;

    try {
      const facture = await donnees.creer("facturation", "factures", {
        numero,
        clientId,
        statut: "brouillon",
        date: new Date().toISOString().slice(0, 10),
        lignes: [
          { designation: carteOuverte.data.titre, quantite: 1, prix: 0 },
        ],
      });
      await majCarte(carteOuverte, {
        liens: { ...carteOuverte.data.liens, factureId: facture.id },
      });
      setFactures((f) => [...f, facture]);
      flash(`Facture ${numero} créée dans Facturation`);
    } catch (err) {
      flash(err.message);
    }
  };

  const exporter = async () => {
    if (!tableau || busy) return;
    setBusy(true);
    try {
      const csv = versCsv(tableau, cartesTableau, membres, clients);
      const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
      const node = await saveAs(blob, `${tableau.data.nom}.csv`, {
        folder: "Projets",
      });
      if (node) flash(`« ${node.name} » enregistré dans le cloud`);
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const vueTableau = (
    <div
      className="pjPlanche cosScroll"
      onWheel={molettePlanche}
      onDragOver={bordPendantGlisser}
    >
      {colonnes.map((col) => {
        const dedans = cartesDe(cartesVisibles, col.id);
        return (
          <div
            className="pjColonne"
            key={col.id}
            data-cible={cible?.colonneId === col.id ? "true" : "false"}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              // Survol du vide d'une colonne : la carte ira à la fin.
              if (!e.target.closest(".pjCarte")) {
                setCible({ colonneId: col.id, position: dedans.length });
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              deposer(
                col.id,
                cible?.colonneId === col.id ? cible.position : dedans.length
              );
            }}
          >
            <div className="pjColonneTete">
              <span
                className="pjColonneTitre"
                onClick={() => renommerColonne(col)}
              >
                {col.titre}
              </span>
              <span className="pjCompte">{dedans.length}</span>
              <Icon
                className="pjColonneSuppr"
                fafa="faXmark"
                width={10}
                onClick={() => supprimerColonne(col)}
              />
            </div>

            <div className="pjCartes cosScroll">
              {dedans.map((carte, i) => (
                <React.Fragment key={carte.id}>
                  {cible?.colonneId === col.id && cible.position === i ? (
                    <div className="pjFente" />
                  ) : null}
                  <Carte
                    carte={carte}
                    index={i}
                    colonneId={col.id}
                    terminee={col.id === stats.colonneTerminee}
                    membre={membreDe(carte.data.assigneId)}
                    client={clientDe(carte.data.liens?.clientId)}
                    glissee={glisse?.carteId === carte.id}
                    initiales={initiales}
                    onGlisserDebut={debutGlisser}
                    onGlisserFin={finGlisser}
                    onSurvol={survolCible}
                    onDepot={deposer}
                    onOuvrir={setCarteOuverte}
                  />
                </React.Fragment>
              ))}
              {cible?.colonneId === col.id &&
              cible.position >= dedans.length ? (
                <div className="pjFente" />
              ) : null}
              {!dedans.length && cible?.colonneId !== col.id ? (
                <div className="pjColonneVide">
                  {filtreActif(filtre)
                    ? "Aucune carte ne correspond"
                    : "Rien ici"}
                </div>
              ) : null}
            </div>

            {composeur === col.id ? (
              <div className="pjComposeur">
                <textarea
                  autoFocus
                  rows={2}
                  value={saisie}
                  placeholder="Titre de la carte…"
                  onChange={(e) => setSaisie(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      ajouterCarte(col.id);
                    }
                    if (e.key === "Escape") setComposeur(null);
                  }}
                />
                <div className="pjComposeurActions">
                  <button
                    className="pjPrimaire"
                    onClick={() => ajouterCarte(col.id)}
                  >
                    Ajouter
                  </button>
                  <Icon
                    fafa="faXmark"
                    width={12}
                    onClick={() => setComposeur(null)}
                  />
                </div>
              </div>
            ) : (
              <div
                className="pjAjout"
                onClick={() => {
                  setComposeur(col.id);
                  setSaisie("");
                }}
              >
                <Icon fafa="faPlus" width={10} /> Ajouter une carte
              </div>
            )}
          </div>
        );
      })}

      <div className="pjColonneNeuve" onClick={ajouterColonne}>
        <Icon fafa="faPlus" width={11} /> Ajouter une colonne
      </div>
    </div>
  );

  const vueListe = (
    <div className="pjListe cosScroll">
      <table>
        <thead>
          <tr>
            <th>Carte</th>
            <th>Colonne</th>
            <th>Échéance</th>
            <th>Assigné</th>
            <th>Client</th>
            <th>Check-list</th>
          </tr>
        </thead>
        <tbody>
          {cartesVisibles.map((c) => {
            const av = avancementChecklist(c.data.checklist);
            const terminee = c.data.colonneId === stats.colonneTerminee;
            return (
              <tr key={c.id} onClick={() => setCarteOuverte(c)}>
                <td className="pjListeTitre">{c.data.titre}</td>
                <td>
                  {colonnes.find((x) => x.id === c.data.colonneId)?.titre}
                </td>
                <td>
                  {c.data.echeance ? (
                    <span
                      className="pjEcheance"
                      data-etat={statutEcheance(c.data.echeance, terminee)}
                    >
                      {formatEcheance(c.data.echeance)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{membreDe(c.data.assigneId)?.name || "—"}</td>
                <td>
                  {clientDe(c.data.liens?.clientId)?.data.entreprise ||
                    clientDe(c.data.liens?.clientId)?.data.nom ||
                    "—"}
                </td>
                <td>{av ? `${av.faits}/${av.total}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!cartesVisibles.length ? (
        <div className="pjVide">Aucune carte à afficher.</div>
      ) : null}
    </div>
  );

  const vueEcheances = (
    <div className="pjEcheancier cosScroll">
      {["retard", "aujourdhui", "bientot", "lointain", null].map((etat) => {
        const groupe = cartesVisibles.filter((c) => {
          const terminee = c.data.colonneId === stats.colonneTerminee;
          const s = statutEcheance(c.data.echeance, terminee);
          return etat === null ? !c.data.echeance : s === etat;
        });
        if (!groupe.length) return null;
        const titres = {
          retard: "En retard",
          aujourdhui: "Aujourd'hui",
          bientot: "Dans les 3 jours",
          lointain: "Plus tard",
          null: "Sans échéance",
        };
        return (
          <div className="pjGroupe" key={etat || "sans"}>
            <div className="pjGroupeTitre" data-etat={etat}>
              {titres[etat === null ? "null" : etat]}
              <span className="pjCompte">{groupe.length}</span>
            </div>
            {groupe.map((c) => (
              <div
                className="pjLigne"
                key={c.id}
                onClick={() => setCarteOuverte(c)}
              >
                <span className="pjLigneTitre">{c.data.titre}</span>
                <span className="pjLigneCol">
                  {colonnes.find((x) => x.id === c.data.colonneId)?.titre}
                </span>
                {c.data.echeance ? (
                  <span className="pjLigneDate">
                    {formatEcheance(c.data.echeance)}
                  </span>
                ) : null}
                {membreDe(c.data.assigneId) ? (
                  <span className="pjAvatar">
                    {initiales(membreDe(c.data.assigneId).name)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        );
      })}
      {!cartesVisibles.length ? (
        <div className="pjVide">Aucune carte à afficher.</div>
      ) : null}
    </div>
  );

  // ---- Panneau de carte ---------------------------------------------------

  const panneau = carteOuverte ? (
    <div className="pjPanneauFond" onClick={() => setCarteOuverte(null)}>
      <div className="pjPanneau" onClick={(e) => e.stopPropagation()}>
        <div className="pjPanneauTete">
          <input
            className="pjPanneauTitre"
            value={carteOuverte.data.titre}
            onChange={(e) => majCarte(carteOuverte, { titre: e.target.value })}
          />
          <Icon
            fafa="faXmark"
            width={13}
            onClick={() => setCarteOuverte(null)}
          />
        </div>

        <div className="pjPanneauCorps cosScroll">
          <div className="pjChamp">
            <label>Étiquettes</label>
            <div className="pjChoixEtiquettes">
              {ETIQUETTES.map((e) => {
                const actif = (carteOuverte.data.etiquettes || []).includes(
                  e.id
                );
                return (
                  <span
                    key={e.id}
                    className="pjPastille"
                    data-actif={actif ? "true" : "false"}
                    style={{ background: e.couleur }}
                    onClick={() => {
                      const liste = carteOuverte.data.etiquettes || [];
                      majCarte(carteOuverte, {
                        etiquettes: actif
                          ? liste.filter((x) => x !== e.id)
                          : [...liste, e.id],
                      });
                    }}
                  >
                    {e.nom}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="pjDeuxColonnes">
            <div className="pjChamp">
              <label>Échéance</label>
              <input
                type="date"
                value={carteOuverte.data.echeance?.slice(0, 10) || ""}
                onChange={(e) =>
                  majCarte(carteOuverte, { echeance: e.target.value || null })
                }
              />
            </div>
            <div className="pjChamp">
              <label>Assigné à</label>
              <select
                value={carteOuverte.data.assigneId || ""}
                onChange={(e) =>
                  majCarte(carteOuverte, { assigneId: e.target.value || null })
                }
              >
                <option value="">Personne</option>
                {membres.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pjChamp">
            <label>Description</label>
            <textarea
              rows={4}
              value={carteOuverte.data.description || ""}
              placeholder="Ce qu'il y a à faire, le contexte, les décisions…"
              onChange={(e) =>
                majCarte(carteOuverte, { description: e.target.value })
              }
            />
          </div>

          {/* Liens vers les autres modules — le cœur de l'intégration. */}
          <div className="pjSection">
            <div className="pjSectionTitre">
              <Icon fafa="faLink" width={11} /> Rattachements
            </div>
            <div className="pjDeuxColonnes">
              <div className="pjChamp">
                <label>Client (CRM)</label>
                <select
                  value={carteOuverte.data.liens?.clientId || ""}
                  onChange={(e) =>
                    majCarte(carteOuverte, {
                      liens: {
                        ...carteOuverte.data.liens,
                        clientId: e.target.value || null,
                      },
                    })
                  }
                >
                  <option value="">Aucun</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.data.entreprise || c.data.nom}
                    </option>
                  ))}
                </select>
                {!clients.length ? (
                  <span className="pjAide">
                    Installez le CRM pour rattacher un client.
                  </span>
                ) : null}
              </div>

              <div className="pjChamp">
                <label>Facture</label>
                <select
                  value={carteOuverte.data.liens?.factureId || ""}
                  onChange={(e) =>
                    majCarte(carteOuverte, {
                      liens: {
                        ...carteOuverte.data.liens,
                        factureId: e.target.value || null,
                      },
                    })
                  }
                >
                  <option value="">Aucune</option>
                  {factures.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.data.numero}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {carteOuverte.data.liens?.clientId &&
            !carteOuverte.data.liens?.factureId ? (
              <button className="pjSecondaire" onClick={creerFacture}>
                <Icon fafa="faFileInvoice" width={11} /> Créer une facture pour
                ce client
              </button>
            ) : null}
            {carteOuverte.data.liens?.factureId ? (
              <div className="pjRattache">
                <Icon fafa="faFileInvoice" width={11} />
                Facture{" "}
                {factureDe(carteOuverte.data.liens.factureId)?.data.numero} —
                gérée dans le module Facturation
              </div>
            ) : null}
          </div>

          {/* Pièces jointes : elles vivent dans le cloud, pas dans la carte. */}
          <div className="pjSection">
            <div className="pjSectionTitre">
              <Icon fafa="faPaperclip" width={11} /> Pièces jointes
            </div>
            {(carteOuverte.data.pieces || []).map((p) => (
              <div className="pjPiece" key={p.id}>
                <Icon fafa="faFile" width={11} />
                <span
                  className="pjPieceNom"
                  onClick={() => ouvrirFichier(p, carteOuverte.data.pieces)}
                >
                  {p.name}
                </span>
                <Icon
                  fafa="faXmark"
                  width={10}
                  onClick={() =>
                    majCarte(carteOuverte, {
                      pieces: carteOuverte.data.pieces.filter(
                        (x) => x.id !== p.id
                      ),
                    })
                  }
                />
              </div>
            ))}
            <button
              className="pjSecondaire"
              data-off={busy}
              onClick={() => pieceInput.current?.click()}
            >
              <Icon fafa="faPlus" width={10} />{" "}
              {busy ? "Envoi…" : "Joindre un fichier"}
            </button>
            <input
              ref={pieceInput}
              type="file"
              className="pjCache"
              onChange={joindreFichier}
            />
            <span className="pjAide">
              Les pièces jointes sont enregistrées dans le dossier « Projets »
              du cloud et s'ouvrent dans les visionneuses de l'OS.
            </span>
          </div>

          {/* Check-list */}
          <div className="pjSection">
            <div className="pjSectionTitre">
              <Icon fafa="faSquareCheck" width={11} /> Check-list
              {avancementChecklist(carteOuverte.data.checklist) ? (
                <span className="pjCompte">
                  {avancementChecklist(carteOuverte.data.checklist).faits}/
                  {avancementChecklist(carteOuverte.data.checklist).total}
                </span>
              ) : null}
            </div>
            {/* Les tâches se réordonnent au glisser-déposer : l'ordre d'une
                check-list porte du sens, c'est souvent la marche à suivre. */}
            {(carteOuverte.data.checklist || []).map((item, i) => (
              <React.Fragment key={item.id}>
                {cibleTache === i ? <div className="pjFenteTache" /> : null}
                <div
                  className="pjTache"
                  draggable
                  data-glissee={glisseTache === item.id ? "true" : "false"}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", item.id);
                    e.dataTransfer.effectAllowed = "move";
                    setGlisseTache(item.id);
                  }}
                  onDragEnd={() => {
                    setGlisseTache(null);
                    setCibleTache(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const r = e.currentTarget.getBoundingClientRect();
                    setCibleTache(
                      i + (e.clientY > r.top + r.height / 2 ? 1 : 0)
                    );
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (glisseTache != null && cibleTache != null) {
                      majCarte(carteOuverte, {
                        checklist: deplacerDansListe(
                          carteOuverte.data.checklist,
                          glisseTache,
                          cibleTache
                        ),
                      });
                    }
                    setGlisseTache(null);
                    setCibleTache(null);
                  }}
                >
                  <Icon className="pjPoignee" fafa="faGripVertical" width={9} />
                  <input
                    type="checkbox"
                    checked={item.fait}
                    onChange={() =>
                      majCarte(carteOuverte, {
                        checklist: carteOuverte.data.checklist.map((x) =>
                          x.id === item.id ? { ...x, fait: !x.fait } : x
                        ),
                      })
                    }
                  />
                  <span data-fait={item.fait ? "true" : "false"}>
                    {item.texte}
                  </span>
                  <Icon
                    fafa="faXmark"
                    width={9}
                    onClick={() =>
                      majCarte(carteOuverte, {
                        checklist: carteOuverte.data.checklist.filter(
                          (x) => x.id !== item.id
                        ),
                      })
                    }
                  />
                </div>
              </React.Fragment>
            ))}
            {cibleTache === (carteOuverte.data.checklist || []).length ? (
              <div className="pjFenteTache" />
            ) : null}
            <input
              className="pjAjoutLigne"
              placeholder="Ajouter une tâche puis Entrée…"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !e.target.value.trim()) return;
                majCarte(carteOuverte, {
                  checklist: [
                    ...(carteOuverte.data.checklist || []),
                    {
                      id: idCourt(),
                      texte: e.target.value.trim(),
                      fait: false,
                    },
                  ],
                });
                e.target.value = "";
              }}
            />
          </div>

          {/* Commentaires */}
          <div className="pjSection">
            <div className="pjSectionTitre">
              <Icon fafa="faComment" width={11} /> Commentaires
            </div>
            {(carteOuverte.data.commentaires || []).map((c) => (
              <div className="pjCommentaire" key={c.id}>
                <span className="pjAvatar">{initiales(c.auteur)}</span>
                <div>
                  <div className="pjCommentaireTete">
                    <b>{c.auteur}</b>
                    <em>{new Date(c.date).toLocaleString("fr-FR")}</em>
                  </div>
                  <div className="pjCommentaireTexte">{c.texte}</div>
                </div>
              </div>
            ))}
            <input
              className="pjAjoutLigne"
              placeholder="Écrire un commentaire puis Entrée…"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !e.target.value.trim()) return;
                majCarte(carteOuverte, {
                  commentaires: [
                    ...(carteOuverte.data.commentaires || []),
                    {
                      id: idCourt(),
                      auteur: session.user?.name || "Moi",
                      texte: e.target.value.trim(),
                      date: new Date().toISOString(),
                    },
                  ],
                });
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="pjPanneauPied">
          <button
            className="pjDanger"
            onClick={() => supprimerCarte(carteOuverte)}
          >
            <Icon fafa="faTrashCan" width={11} /> Supprimer la carte
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // ---- Rendu --------------------------------------------------------------

  return (
    <ModuleWindow manifest={manifest} className="projetsApp">
      {session.status !== "authenticated" ? (
        <div className="pjVide">Connectez-vous pour accéder à vos projets.</div>
      ) : (
        <div className="pjShell">
          <div className="pjRail cosScroll">
            <div className="pjRailTitre">Tableaux</div>
            {tableaux.map((t) => (
              <div
                key={t.id}
                className="pjRailItem"
                data-actif={t.id === tableauId ? "true" : "false"}
                onClick={() => {
                  setTableauId(t.id);
                  setFiltre(FILTRE_VIDE);
                }}
              >
                <span
                  className="pjPuce"
                  style={{ background: t.data.couleur }}
                />
                <span className="pjRailNom">{t.data.nom}</span>
                <span className="pjCompte">
                  {cartes.filter((c) => c.data.tableauId === t.id).length}
                </span>
              </div>
            ))}
            <div className="pjRailAjout" onClick={creerTableau}>
              <Icon fafa="faPlus" width={10} /> Nouveau tableau
            </div>
          </div>

          <div className="pjMain">
            {!tableau ? (
              <div className="pjVide">
                Aucun tableau. Créez-en un pour organiser vos projets.
              </div>
            ) : (
              <>
                <div className="pjTete">
                  <span
                    className="pjPuce"
                    style={{ background: tableau.data.couleur }}
                  />
                  <span
                    className="pjNom"
                    onClick={renommerTableau}
                    title="Renommer"
                  >
                    {tableau.data.nom}
                  </span>

                  <div className="pjVues">
                    {VUES.map((v) => (
                      <span
                        key={v.id}
                        className="pjVue"
                        data-actif={vue === v.id ? "true" : "false"}
                        onClick={() => setVue(v.id)}
                      >
                        <Icon fafa={v.icone} width={11} />
                        {v.label}
                      </span>
                    ))}
                  </div>

                  <div className="pjSpacer" />

                  <input
                    className="pjRecherche"
                    placeholder="Rechercher…"
                    value={filtre.texte}
                    onChange={(e) =>
                      setFiltre((f) => ({ ...f, texte: e.target.value }))
                    }
                  />
                  <select
                    className="pjFiltre"
                    value={filtre.etiquette || ""}
                    onChange={(e) =>
                      setFiltre((f) => ({
                        ...f,
                        etiquette: e.target.value || null,
                      }))
                    }
                  >
                    <option value="">Étiquette</option>
                    {ETIQUETTES.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nom}
                      </option>
                    ))}
                  </select>
                  <select
                    className="pjFiltre"
                    value={filtre.membre || ""}
                    onChange={(e) =>
                      setFiltre((f) => ({
                        ...f,
                        membre: e.target.value || null,
                      }))
                    }
                  >
                    <option value="">Membre</option>
                    {membres.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <span
                    className="pjBascule"
                    data-actif={filtre.retardSeulement ? "true" : "false"}
                    onClick={() =>
                      setFiltre((f) => ({
                        ...f,
                        retardSeulement: !f.retardSeulement,
                      }))
                    }
                  >
                    En retard
                  </span>
                  {filtreActif(filtre) ? (
                    <span
                      className="pjBascule"
                      onClick={() => setFiltre(FILTRE_VIDE)}
                    >
                      Effacer
                    </span>
                  ) : null}

                  {/* `Icon` ne transmet pas l'attribut `title` : l'infobulle
                      est portée par l'enveloppe. */}
                  <span title="Exporter en CSV vers le cloud">
                    <Icon
                      className="pjAction"
                      fafa="faFileCsv"
                      width={13}
                      onClick={exporter}
                    />
                  </span>
                  <span title="Supprimer le tableau">
                    <Icon
                      className="pjAction"
                      fafa="faTrashCan"
                      width={13}
                      onClick={supprimerTableau}
                    />
                  </span>
                </div>

                <div className="pjStats">
                  <span>
                    <b>{stats.total}</b> carte{stats.total > 1 ? "s" : ""}
                  </span>
                  <span>
                    <b>{stats.terminees}</b> terminée
                    {stats.terminees > 1 ? "s" : ""}
                  </span>
                  <span data-alerte={stats.enRetard ? "true" : "false"}>
                    <b>{stats.enRetard}</b> en retard
                  </span>
                  <span>
                    <b>{stats.sansAssigne}</b> non assignée
                    {stats.sansAssigne > 1 ? "s" : ""}
                  </span>
                  <div
                    className="pjJauge"
                    title={`${stats.avancement} % terminé`}
                  >
                    <div style={{ width: `${stats.avancement}%` }} />
                  </div>
                  <span className="pjPourcent">{stats.avancement} %</span>
                </div>

                {notice ? <div className="pjNotice">{notice}</div> : null}

                {vue === "tableau" ? vueTableau : null}
                {vue === "liste" ? vueListe : null}
                {vue === "echeances" ? vueEcheances : null}
              </>
            )}
          </div>

          {panneau}
        </div>
      )}
    </ModuleWindow>
  );
}
