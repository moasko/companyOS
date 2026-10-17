// Livraisons.
//
// ─────────────────────────────────────────────────────────────────────────
// TROIS PERSONNES, TROIS ÉCRANS
//
//   Le répartiteur, le matin : « Aujourd'hui ». Les livraisons à planifier
//   à gauche, les tournées du jour à droite ; on glisse une livraison sur
//   une tournée, l'ordre de passage se calcule, on démarre.
//
//   Le livreur, sur la route : « Ma tournée ». Un arrêt à la fois, en
//   grand : appeler, WhatsApp, itinéraire, puis « Livré » (nom, signature,
//   photo, encaissement) ou « Échec » (motif). Rien d'autre à l'écran.
//
//   Le gérant, le soir : les chiffres du jour, les tournées terminées, ce
//   qui a été encaissé et par qui — et la flotte, avec ses échéances.
//
// Les règles (statuts, ordre de passage, frais, messages, pont avec le
// Stock et la Facturation) sont dans packages/shared/src/livraisons.js.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { saveToCloud } from "../../cloud";
import { accesDonnees } from "../../donnees";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { Contenu, useChargement } from "../../chargement";
import { useTelephone } from "../../../utils/telephone";
import * as L from "@companyos/shared/livraisons";
import { Ctx, decalerJour, jourLisible } from "./commun";
import { Dispatch } from "./Dispatch";
import { Liste } from "./Liste";
import { Tournees } from "./Tournees";
import { Flotte } from "./Flotte";
import { MaTournee } from "./MaTournee";
import { Reglages } from "./Reglages";
import { Fiche } from "./Fiche";
import { FormLivraison, FormTournee, FormVehicule, FormPreuve, FormEchec } from "./Formulaires";
import "./livraisons.scss";
import { manifest as descriptif } from "./manifest";

export const manifest = { ...descriptif, Window: LivraisonsApp };

const VUES = [
  { id: "jour", label: "Aujourd'hui", icone: "faTableColumns" },
  { id: "liste", label: "Livraisons", icone: "faBoxesStacked" },
  { id: "tournees", label: "Tournées", icone: "faRoute" },
  { id: "flotte", label: "Flotte et livreurs", icone: "faTruck" },
  { id: "livreur", label: "Ma tournée", icone: "faMotorcycle" },
  { id: "reglages", label: "Réglages", icone: "faGear" },
];

function LivraisonsApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const telephone = useTelephone();
  const donnees = useMemo(() => accesDonnees(manifest), []);
  const admin = ["OWNER", "ADMIN"].includes(session.user?.role);

  const [d, setD] = useState({
    livraisons: [], tournees: [], vehicules: [], reglages: null,
    clients: [], factures: [], reglements: [], articles: [], mouvements: [], salaries: [], entreprise: null,
  });
  const [vue, setVue] = useState("jour");
  const [jour, setJour] = useState(() => L.aujourdhui());
  const [ficheId, setFicheId] = useState(null);
  const [formulaire, setFormulaire] = useState(null); // { type, ...contexte }
  const [navOuverte, setNavOuverte] = useState(false);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    const lire = (m, c) => (m ? donnees.lire(m, c) : donnees.lire(c)).catch(() => []);
    const [livraisons, tournees, vehicules, reglages, clients, factures, reglements, articles, mouvements, salaries, entreprise] = await Promise.all([
      lire(null, "livraisons"), lire(null, "tournees"), lire(null, "vehicules"), lire(null, "reglages"),
      lire("crm", "clients"), lire("facturation", "factures"), lire("facturation", "reglements"),
      lire("stock", "articles"), lire("stock", "mouvements"), lire("rh", "salaries"), lire("entreprise", "profil"),
    ]);
    setD({ livraisons, tournees, vehicules, reglages: reglages[0] || null, clients, factures, reglements, articles, mouvements, salaries, entreprise: entreprise[0]?.data || null });
  }, [donnees]);
  const etat = useChargement(ouvert, charger, { ecoute: ["livraisons/*", "facturation/factures", "stock/mouvements"] });

  // Le livreur connecté (sa fiche RH, reliée par l'adresse) arrive
  // directement sur sa tournée, surtout sur téléphone.
  const moi = useMemo(() => d.salaries.find((s) => (s.data.email || "").toLowerCase() === (session.user?.email || "").toLowerCase()) || null, [d.salaries, session.user?.email]);
  const reglages = useMemo(() => ({ tarifs: L.TARIFS_DEFAUT, depot: { nom: "Dépôt", commune: "Marcory", adresse: "" }, gabarits: {}, ...(d.reglages?.data || {}) }), [d.reglages]);
  const depotPos = L.COMMUNES[reglages.depot?.commune] || L.COMMUNES.Marcory;
  useEffect(() => {
    if (!moi || admin) return;
    if (d.tournees.some((t) => t.data.livreurId === moi.id && t.data.date === L.aujourdhui())) setVue("livreur");
  }, [moi, admin, d.tournees]);

  // Liens entrants : { livraison } ouvre la fiche, { facture } prépare
  // une livraison depuis la facture.
  useEffect(() => {
    const surLien = (e) => {
      const { app, params = {} } = e.detail || {};
      if (app !== manifest.id) return;
      if (params.livraison) setFicheId(params.livraison);
      if (params.facture) setFormulaire({ type: "livraison", factureId: params.facture });
    };
    window.addEventListener("companyos:lien", surLien);
    return () => window.removeEventListener("companyos:lien", surLien);
  }, []);

  // ---------------------------------------------------------------- dérivés
  const livreurs = useMemo(
    () =>
      d.salaries
        .filter((s) => s.data.statut !== "sorti")
        .map((s) => ({ id: s.id, nom: `${s.data.prenom || ""} ${s.data.nom || ""}`.trim(), telephone: s.data.telephone || "", poste: s.data.poste || "", email: s.data.email || "" }))
        .sort((a, b) => Number(/livr|logist|magasin|chauffeur/i.test(b.poste)) - Number(/livr|logist|magasin|chauffeur/i.test(a.poste)) || a.nom.localeCompare(b.nom, "fr")),
    [d.salaries],
  );
  const livreur = useCallback((id) => livreurs.find((x) => x.id === id) || null, [livreurs]);
  const vehicule = useCallback((id) => d.vehicules.find((v) => v.id === id) || null, [d.vehicules]);
  const arretsDe = useCallback((tourneeId) => d.livraisons.filter((l) => l.data.tourneeId === tourneeId && l.data.statut !== "annulee").sort((a, b) => (a.data.ordre || 0) - (b.data.ordre || 0)), [d.livraisons]);
  const nomUtilisateur = session.user?.name || "";

  // ---------------------------------------------------------------- écritures
  const maj = (collection, fiche, data) => donnees.modifier(collection, fiche.id, data);
  const remplacer = (collection, fiche) => setD((x) => ({ ...x, [collection]: x[collection].map((f) => (f.id === fiche.id ? fiche : f)) }));

  const executer = async (fn, titreErreur = "Action impossible") => {
    setOccupe(true);
    try {
      return await fn();
    } catch (e) {
      modal.alert({ title: titreErreur, message: e.message, tone: "error" });
      return null;
    } finally {
      setOccupe(false);
      etat.rafraichir();
    }
  };

  const creerLivraison = (data) =>
    executer(async () => {
      const numero = L.prochainNumero(d.livraisons, "LIV");
      const fiche = await donnees.creer("livraisons", { ...data, numero, historique: [{ statut: data.statut || "a_planifier", le: new Date().toISOString(), par: nomUtilisateur }] });
      setD((x) => ({ ...x, livraisons: [fiche, ...x.livraisons] }));
      notifier({ titre: `Livraison ${numero} créée`, message: data.clientNom || data.contact || "", app: manifest.id, ton: "succes" });
      return fiche;
    }, "Création impossible");

  const modifierLivraison = (l, patch) =>
    executer(async () => {
      const fiche = await maj("livraisons", l, { ...l.data, ...patch });
      remplacer("livraisons", fiche);
      return fiche;
    });

  /// Change le statut d'une livraison, avec ses conséquences : une
  /// livraison remise sort le stock et encaisse la facture.
  const changerStatut = (l, statut, extra = {}) =>
    executer(async () => {
      const data = L.passer(l.data, statut, { par: nomUtilisateur, ...extra });
      const fiche = await maj("livraisons", l, data);
      remplacer("livraisons", fiche);
      if (statut === "livree") {
        const facture = fiche.data.factureId ? d.factures.find((f) => f.id === fiche.data.factureId) : null;
        const sorties = L.sortiesStock(fiche, { facture, mouvements: d.mouvements });
        const reglement = L.reglementDe(fiche);
        const avertissements = [];
        for (const s of sorties) {
          await donnees.creer("stock", "mouvements", s).catch((e) => avertissements.push(`Stock : ${e.message}`));
        }
        if (reglement) await donnees.creer("facturation", "reglements", reglement).catch((e) => avertissements.push(`Facturation : ${e.message}`));
        notifier({
          titre: `${fiche.data.numero} livrée`,
          message: [fiche.data.encaissement?.montant ? `Encaissé ${Math.round(fiche.data.encaissement.montant).toLocaleString("fr-FR")} F` : "", sorties.length ? "stock mis à jour" : ""].filter(Boolean).join(" · "),
          app: manifest.id,
          ton: "succes",
        });
        if (avertissements.length) modal.alert({ title: "Livraison enregistrée, avec une réserve", message: avertissements.join("\n"), tone: "warning" });
      }
      return fiche;
    }, "Changement de statut impossible");

  const supprimerLivraison = async (l) => {
    const ok = await modal.confirm({ title: `Supprimer ${l.data.numero} ?`, message: "La livraison disparaît de la liste et des tournées. Préférez « Annuler » pour en garder la trace.", confirmLabel: "Supprimer", danger: true });
    if (!ok) return;
    await executer(async () => {
      await donnees.supprimer("livraisons", l.id);
      setD((x) => ({ ...x, livraisons: x.livraisons.filter((f) => f.id !== l.id) }));
      setFicheId(null);
    });
  };

  // Tournées
  const creerTournee = (data) =>
    executer(async () => {
      const numero = L.prochainNumero(d.tournees, "TRN");
      const fiche = await donnees.creer("tournees", { statut: "planifiee", ...data, numero });
      setD((x) => ({ ...x, tournees: [fiche, ...x.tournees] }));
      return fiche;
    }, "Création impossible");

  const modifierTournee = (t, patch) =>
    executer(async () => {
      const fiche = await maj("tournees", t, { ...t.data, ...patch });
      remplacer("tournees", fiche);
      return fiche;
    });

  /// Confie des livraisons à une tournée : elles prennent son livreur, sa
  /// date, et s'ajoutent à la fin de l'ordre de passage.
  const affecter = (ids, tournee) =>
    executer(async () => {
      let ordre = Math.max(0, ...arretsDe(tournee.id).map((l) => l.data.ordre || 0));
      const enCours = tournee.data.statut === "en_cours";
      for (const id of ids) {
        const l = d.livraisons.find((x) => x.id === id);
        if (!l || !L.STATUTS[l.data.statut]?.ouvert) continue;
        ordre += 1;
        const cible = enCours ? "en_route" : "planifiee";
        const base = { ...l.data, statut: l.data.statut === "en_route" && !enCours ? "planifiee" : l.data.statut };
        const data = L.passer(base, cible, { par: nomUtilisateur, tourneeId: tournee.id, livreurId: tournee.data.livreurId, date: tournee.data.date, ordre });
        const fiche = await maj("livraisons", l, data);
        remplacer("livraisons", fiche);
      }
    }, "Affectation impossible");

  const retirer = (l) => changerStatut(l, "a_planifier", { note: "Retirée de la tournée" });

  /// Recalcule l'ordre de passage d'une tournée.
  const optimiser = (tournee) =>
    executer(async () => {
      const arrets = arretsDe(tournee.id);
      const faits = arrets.filter((l) => !L.STATUTS[l.data.statut]?.ouvert);
      const restants = L.ordonnerArrets(arrets.filter((l) => L.STATUTS[l.data.statut]?.ouvert), depotPos);
      const ordre = [...faits, ...restants];
      for (const [i, l] of ordre.entries()) {
        if ((l.data.ordre || 0) === i + 1) continue;
        remplacer("livraisons", await maj("livraisons", l, { ...l.data, ordre: i + 1 }));
      }
      notifier({ titre: "Ordre de passage recalculé", message: `${tournee.data.numero} — ${restants.length} arrêt(s) à faire`, app: manifest.id, ton: "succes" });
    }, "Optimisation impossible");

  const deplacer = (tournee, l, sens) =>
    executer(async () => {
      const arrets = arretsDe(tournee.id);
      const i = arrets.findIndex((x) => x.id === l.id);
      const j = i + sens;
      if (i < 0 || j < 0 || j >= arrets.length) return;
      const a = arrets[i];
      const b = arrets[j];
      remplacer("livraisons", await maj("livraisons", a, { ...a.data, ordre: j + 1 }));
      remplacer("livraisons", await maj("livraisons", b, { ...b.data, ordre: i + 1 }));
    });

  const demarrer = (tournee) =>
    executer(async () => {
      remplacer("tournees", await maj("tournees", tournee, { ...tournee.data, statut: "en_cours", demarreeLe: new Date().toISOString() }));
      for (const l of arretsDe(tournee.id)) {
        if (l.data.statut === "planifiee" || l.data.statut === "a_planifier") {
          remplacer("livraisons", await maj("livraisons", l, L.passer(l.data, "en_route", { par: nomUtilisateur })));
        }
      }
      notifier({ titre: `${tournee.data.numero} démarrée`, message: livreur(tournee.data.livreurId)?.nom || "", app: manifest.id, ton: "succes" });
    }, "Démarrage impossible");

  const terminer = async (tournee) => {
    const restants = arretsDe(tournee.id).filter((l) => L.STATUTS[l.data.statut]?.ouvert);
    if (restants.length) {
      const ok = await modal.confirm({
        title: "Clôturer la tournée ?",
        message: `${restants.length} livraison(s) ne sont ni livrées ni en échec. Elles repasseront « à planifier ».`,
        confirmLabel: "Clôturer",
      });
      if (!ok) return;
    }
    await executer(async () => {
      for (const l of restants) remplacer("livraisons", await maj("livraisons", l, L.passer(l.data, "a_planifier", { par: nomUtilisateur, note: `Non livrée — ${tournee.data.numero} clôturée` })));
      remplacer("tournees", await maj("tournees", tournee, { ...tournee.data, statut: "terminee", termineeLe: new Date().toISOString() }));
    });
  };

  const supprimerTournee = async (tournee) => {
    const arrets = arretsDe(tournee.id);
    const ok = await modal.confirm({ title: `Supprimer ${tournee.data.numero} ?`, message: arrets.length ? `Ses ${arrets.length} livraison(s) repasseront « à planifier ».` : "La tournée est vide.", confirmLabel: "Supprimer", danger: true });
    if (!ok) return;
    await executer(async () => {
      for (const l of arrets) if (L.STATUTS[l.data.statut]?.ouvert) remplacer("livraisons", await maj("livraisons", l, L.passer(l.data, "a_planifier", { par: nomUtilisateur })));
      await donnees.supprimer("tournees", tournee.id);
      setD((x) => ({ ...x, tournees: x.tournees.filter((t) => t.id !== tournee.id) }));
    });
  };

  // Véhicules et réglages
  const enregistrerVehicule = (v, data) =>
    executer(async () => {
      const fiche = v ? await maj("vehicules", v, data) : await donnees.creer("vehicules", data);
      setD((x) => ({ ...x, vehicules: v ? x.vehicules.map((f) => (f.id === fiche.id ? fiche : f)) : [fiche, ...x.vehicules] }));
      return fiche;
    }, "Enregistrement impossible");

  const supprimerVehicule = async (v) => {
    const ok = await modal.confirm({ title: `Retirer ${v.data.nom} de la flotte ?`, confirmLabel: "Retirer", danger: true });
    if (!ok) return;
    await executer(async () => {
      await donnees.supprimer("vehicules", v.id);
      setD((x) => ({ ...x, vehicules: x.vehicules.filter((f) => f.id !== v.id) }));
    });
  };

  const enregistrerReglages = (data) =>
    executer(async () => {
      const fiche = d.reglages ? await maj("reglages", d.reglages, data) : await donnees.creer("reglages", data);
      setD((x) => ({ ...x, reglages: fiche }));
      notifier({ titre: "Réglages enregistrés", app: manifest.id, ton: "succes" });
    }, "Enregistrement impossible");

  /// Photo de preuve, rangée dans le Cloud (Livraisons › Preuves).
  const deposerPhoto = async (fichier, numero) => {
    const nom = `preuve-${numero}-${Date.now().toString(36)}.${(fichier.name.split(".").pop() || "jpg").toLowerCase()}`;
    const noeud = await saveToCloud(fichier, nom, { folder: "Livraisons" });
    return { id: noeud.id, name: noeud.name, mimeType: noeud.mimeType || fichier.type };
  };

  const ctx = {
    ...d, jour, setJour, reglages, depotPos, livreurs, livreur, vehicule, arretsDe, moi, admin, telephone, occupe,
    ouvrirFiche: setFicheId, ouvrirFormulaire: setFormulaire, setVue,
    creerLivraison, modifierLivraison, changerStatut, supprimerLivraison, creerTournee, modifierTournee, affecter, retirer,
    optimiser, deplacer, demarrer, terminer, supprimerTournee, enregistrerVehicule, supprimerVehicule, enregistrerReglages, deposerPhoto,
  };

  const fiche = ficheId ? d.livraisons.find((l) => l.id === ficheId) : null;
  const aPlanifier = d.livraisons.filter((l) => l.data.statut === "a_planifier").length;
  const aLivrer = L.facturesALivrer(d.factures, { mouvements: d.mouvements, livraisons: d.livraisons }).length;
  const titreVue = VUES.find((v) => v.id === vue)?.label;

  return (
    <ModuleWindow manifest={manifest} className="lvApp">
      <Ctx.Provider value={ctx}>
        <div className="lvCoquille" data-telephone={telephone || undefined}>
          {telephone && navOuverte ? <div className="lvVoile" onClick={() => setNavOuverte(false)} /> : null}
          <nav className="lvNav" data-ouverte={navOuverte || undefined} aria-label="Sections">
            <button type="button" className="lvNouvelle" onClick={() => (setNavOuverte(false), setFormulaire({ type: "livraison" }))}>
              <Icon fafa="faPlus" width={12} /> Nouvelle livraison
            </button>
            {VUES.filter((v) => v.id !== "livreur" || moi || admin).map((v) => (
              <button key={v.id} type="button" className="lvNavItem" data-actif={vue === v.id || undefined} aria-current={vue === v.id ? "page" : undefined} onClick={() => (setVue(v.id), setNavOuverte(false))}>
                <Icon fafa={v.icone} width={13} />
                <span>{v.label}</span>
                {v.id === "jour" && aPlanifier ? <em className="lvCompte">{aPlanifier}</em> : null}
              </button>
            ))}
            {aLivrer ? (
              <button type="button" className="lvNavEncart" onClick={() => (setNavOuverte(false), setFormulaire({ type: "livraison", depuisFacture: true }))}>
                <Icon fafa="faFileInvoice" width={13} />
                <span>
                  <b>{aLivrer} facture{aLivrer > 1 ? "s" : ""} à livrer</b>
                  <small>Créer les livraisons</small>
                </span>
              </button>
            ) : null}
          </nav>

          <main className="lvMain">
            {telephone ? (
              <div className="lvBarreTel">
                <button type="button" className="lvIconeBtn" aria-label="Sections" onClick={() => setNavOuverte(true)}>
                  <Icon fafa="faBars" width={15} />
                </button>
                <b>{titreVue}</b>
                {vue !== "livreur" && vue !== "reglages" ? (
                  <div className="lvJourTel">
                    <button type="button" className="lvIconeBtn" aria-label="Jour précédent" onClick={() => setJour(decalerJour(jour, -1))}><Icon fafa="faChevronLeft" width={11} /></button>
                    <span>{jourLisible(jour)}</span>
                    <button type="button" className="lvIconeBtn" aria-label="Jour suivant" onClick={() => setJour(decalerJour(jour, 1))}><Icon fafa="faChevronRight" width={11} /></button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <Contenu etat={etat} vide={false} lignes={6}>
              {vue === "jour" ? <Dispatch /> : null}
              {vue === "liste" ? <Liste /> : null}
              {vue === "tournees" ? <Tournees /> : null}
              {vue === "flotte" ? <Flotte /> : null}
              {vue === "livreur" ? <MaTournee /> : null}
              {vue === "reglages" ? <Reglages /> : null}
            </Contenu>
            {telephone && vue !== "livreur" ? (
              <button type="button" className="lvFab" aria-label="Nouvelle livraison" onClick={() => setFormulaire({ type: "livraison" })}>
                <Icon fafa="faPlus" width={18} />
              </button>
            ) : null}
          </main>

          {fiche ? <Fiche livraison={fiche} onFermer={() => setFicheId(null)} /> : null}
          {formulaire?.type === "livraison" ? <FormLivraison contexte={formulaire} onFermer={() => setFormulaire(null)} /> : null}
          {formulaire?.type === "tournee" ? <FormTournee contexte={formulaire} onFermer={() => setFormulaire(null)} /> : null}
          {formulaire?.type === "vehicule" ? <FormVehicule contexte={formulaire} onFermer={() => setFormulaire(null)} /> : null}
          {/* Une remise ou un échec enregistrés ferment aussi la fiche : on revient au tableau. */}
          {formulaire?.type === "preuve" ? <FormPreuve contexte={formulaire} onFermer={(fait) => (setFormulaire(null), fait === true && setFicheId(null))} /> : null}
          {formulaire?.type === "echec" ? <FormEchec contexte={formulaire} onFermer={(fait) => (setFormulaire(null), fait === true && setFicheId(null))} /> : null}
        </div>
      </Ctx.Provider>
    </ModuleWindow>
  );
}
