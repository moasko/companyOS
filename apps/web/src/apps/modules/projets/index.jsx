import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { api } from "../../../api/client";
import { saveAs, saveToCloud } from "../../cloud";
import { modal } from "../../modalRequest";
import { accesDonnees } from "../../donnees";
import { envoyerA } from "../../notifications";
import {
  COLONNES_PAR_DEFAUT,
  FILTRE_VIDE,
  besoinDeRenumeroter,
  cartesDe,
  filtrer,
  idCourt,
  initiales,
  rangPour,
  renumeroter,
  statistiques,
  versCsv,
} from "./board";
import { BarreLaterale } from "./vues/BarreLaterale";
import { Echeancier } from "./vues/Echeancier";
import { EnTete } from "./vues/EnTete";
import { Liste } from "./vues/Liste";
import { PanneauCarte } from "./vues/PanneauCarte";
import { Planche } from "./vues/Planche";
import "./projets.scss";
import { manifest as descriptif } from "./manifest";

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
//
// Ce fichier tient l'état, les écritures et l'assemblage ; chaque écran est
// dans `vues/`, et les règles de calcul dans `board.js`.

export const manifest = { ...descriptif, Window: ProjetsApp };

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
  // Le lien a pu arriver avant les données (ouverture à la demande).
  useEffect(() => {
    appliquerLien();
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

  // ---- Rendu --------------------------------------------------------------

  return (
    <ModuleWindow manifest={manifest} className="projetsApp">
      {session.status !== "authenticated" ? (
        <div className="pjVide">Connectez-vous pour accéder à vos projets.</div>
      ) : (
        <div className="pjShell">
          <BarreLaterale
            tableaux={tableaux}
            tableauId={tableauId}
            setTableauId={setTableauId}
            setFiltre={setFiltre}
            cartes={cartes}
            creerTableau={creerTableau}
          />

          <div className="pjMain">
            {!tableau ? (
              <div className="pjVide">
                Aucun tableau. Créez-en un pour organiser vos projets.
              </div>
            ) : (
              <>
                <EnTete
                  tableau={tableau}
                  renommerTableau={renommerTableau}
                  vue={vue}
                  setVue={setVue}
                  filtre={filtre}
                  setFiltre={setFiltre}
                  membres={membres}
                  exporter={exporter}
                  supprimerTableau={supprimerTableau}
                  stats={stats}
                />

                {notice ? <div className="pjNotice">{notice}</div> : null}

                {vue === "tableau" ? (
                  <Planche
                    molettePlanche={molettePlanche}
                    bordPendantGlisser={bordPendantGlisser}
                    colonnes={colonnes}
                    cartesVisibles={cartesVisibles}
                    cible={cible}
                    setCible={setCible}
                    deposer={deposer}
                    renommerColonne={renommerColonne}
                    supprimerColonne={supprimerColonne}
                    stats={stats}
                    membreDe={membreDe}
                    clientDe={clientDe}
                    glisse={glisse}
                    initiales={initiales}
                    debutGlisser={debutGlisser}
                    finGlisser={finGlisser}
                    survolCible={survolCible}
                    setCarteOuverte={setCarteOuverte}
                    filtre={filtre}
                    composeur={composeur}
                    setComposeur={setComposeur}
                    saisie={saisie}
                    setSaisie={setSaisie}
                    ajouterCarte={ajouterCarte}
                    ajouterColonne={ajouterColonne}
                  />
                ) : null}
                {vue === "liste" ? (
                  <Liste
                    cartesVisibles={cartesVisibles}
                    colonnes={colonnes}
                    stats={stats}
                    membreDe={membreDe}
                    clientDe={clientDe}
                    setCarteOuverte={setCarteOuverte}
                  />
                ) : null}
                {vue === "echeances" ? (
                  <Echeancier
                    cartesVisibles={cartesVisibles}
                    colonnes={colonnes}
                    stats={stats}
                    membreDe={membreDe}
                    initiales={initiales}
                    setCarteOuverte={setCarteOuverte}
                  />
                ) : null}
              </>
            )}
          </div>

          {carteOuverte ? (
            <PanneauCarte
              carteOuverte={carteOuverte}
              setCarteOuverte={setCarteOuverte}
              majCarte={majCarte}
              supprimerCarte={supprimerCarte}
              membres={membres}
              clients={clients}
              factures={factures}
              factureDe={factureDe}
              creerFacture={creerFacture}
              busy={busy}
              pieceInput={pieceInput}
              joindreFichier={joindreFichier}
              glisseTache={glisseTache}
              setGlisseTache={setGlisseTache}
              cibleTache={cibleTache}
              setCibleTache={setCibleTache}
              initiales={initiales}
              session={session}
            />
          ) : null}
        </div>
      )}
    </ModuleWindow>
  );
}
