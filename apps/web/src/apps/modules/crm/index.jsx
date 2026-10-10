import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { ouvrirCorbeilleFiches, ouvrirHistorique } from "../../historique";
import { saveAs } from "../../cloud";
import { modal } from "../../modalRequest";
import { envoyerA } from "../../notifications";
import { invaliderReferentiel } from "../../referentiel";
import { Squelette, useChargement } from "../../chargement";
import { composerCourriel } from "../../courrielRequest";
import { ouvrirDansEditeur } from "../../editeurFacturesRequest";
import { ouvrirFenetre } from "../../windows";
import { useTraduction } from "../../../utils/intl";
import { useTelephone } from "../../../utils/telephone";
import { totaux, etatPaiement } from "@companyos/shared/facturation";
import { devinerColonnes, lireCsv } from "@companyos/shared/campagnes";
import { COLONNES_PAR_DEFAUT } from "../projets/board";
import { ETAPES_OUVERTES, aFaire, jourssansContact, nomDe, today } from "./domaine";
import {
  analyserSaisie,
  doublons,
  estLead,
  performance,
  previsions,
  prochaineActivite,
  progressionObjectif,
  santeCompte,
  scoreLead,
  stagnation,
  ventesCompte,
} from "./regles";
import { TEXTES } from "./textes";
import { dateCourte } from "./commun";
import { Journee } from "./vues/Journee";
import { Pipeline } from "./vues/Pipeline";
import { Comptes } from "./vues/Comptes";
import { Fiche } from "./vues/Fiche";
import { Contacts } from "./vues/Contacts";
import { Leads } from "./vues/Leads";
import { Previsions } from "./vues/Previsions";
import {
  FormActivite,
  FormAffaire,
  FormCompte,
  FormCompteRendu,
  FormContact,
  FormEtiquette,
  FormGagnee,
  FormMotifPerte,
  FormRdv,
  FormReporter,
  FormVue,
} from "./vues/Formulaires";
import "./crm.scss";
import { manifest as descriptif } from "./manifest";

// CRM 3 : la relation client, reliée à tout CompanyOS.
//
// Collections du module :
//
//   clients        les comptes (entreprises ou particuliers) — partagés
//                  avec la Facturation, les Projets et les Campagnes
//   contacts       les interlocuteurs d'un compte (décideur, comptable…)
//   opportunites   les affaires, leur étape, leur montant, leur responsable
//   activites      appels, rendez-vous, e-mails, notes et tâches
//   reglages       objectifs, seuils de stagnation, secteurs cibles, vues
//
// Lu ailleurs (jamais recopié) : factures et règlements (Facturation),
// courriels envoyés (Courrier), campagnes (ouvertures, clics), cartes de
// Projets. La fiche d'un compte en fait une seule chronologie.

export const manifest = { ...descriptif, Window: CrmApp };

const NAV = [
  { id: "journee", icone: "faHouse", cle: "navJournee" },
  { id: "pipeline", icone: "faTableColumns", cle: "navPipeline" },
  { id: "comptes", icone: "faBuilding", cle: "navComptes" },
  { id: "contacts", icone: "faAddressBook", cle: "navContacts" },
  { id: "leads", icone: "faBolt", cle: "navLeads" },
  { id: "previsions", icone: "faChartLine", cle: "navPrevisions" },
];

const lire = (m, c) => api.records.list(m, c).catch(() => []);

function CrmApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const t = useTraduction(TEXTES);
  const telephone = useTelephone();
  const moi = session.user?.id;
  const admin = ["OWNER", "ADMIN"].includes(session.user?.role);

  const [d, setD] = useState({
    clients: [], contacts: [], opportunites: [], activites: [], reglagesRec: null,
    documents: [], reglements: [], envois: [], campagnes: [], cartes: [], membres: [],
  });
  const [vue, setVue] = useState("journee");
  const [compteId, setCompteId] = useState(null);
  const [vueComptes, setVueComptes] = useState(null);
  const [notice, setNotice] = useState("");
  const minuteur = useRef(null);
  const zone = useRef(null);

  // Nouvel écran, nouvelle page : on repart du haut (sinon une fiche
  // ouverte depuis le bas d'une longue liste s'affiche déjà défilée).
  useEffect(() => {
    zone.current?.scrollTo?.(0, 0);
  }, [vue, compteId, vueComptes]);

  const flash = useCallback((msg) => {
    setNotice(msg);
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => setNotice(""), 3500);
  }, []);

  const ouvert = wnapp && !wnapp.hide && session.status === "authenticated";

  // ---- Chargement ---------------------------------------------------------

  const charger = async () => {
    const [clients, contacts, opportunites, activites, reglages, documents, reglements, envois, campagnes, cartes, membres] =
      await Promise.all([
        api.records.list(manifest.slug, "clients"),
        lire(manifest.slug, "contacts"),
        api.records.list(manifest.slug, "opportunites"),
        lire(manifest.slug, "activites"),
        lire(manifest.slug, "reglages"),
        // Les autres apps peuvent ne pas être installées, ou fermées à ce
        // membre : le CRM reste utilisable, simplement moins renseigné.
        lire("facturation", "factures"),
        lire("facturation", "reglements"),
        lire("courrier", "envois"),
        lire("campagnes", "campagnes"),
        lire("projets", "cartes"),
        api.members().catch(() => []),
      ]);
    setD({ clients, contacts, opportunites, activites, reglagesRec: reglages[0] || null, documents, reglements, envois, campagnes, cartes, membres });
  };

  // Rechargement en direct quand un collègue modifie ces collections.
  const etat = useChargement(ouvert, charger, { ecoute: ["crm/*", "facturation/factures", "facturation/reglements", "projets/cartes", "campagnes/campagnes"] });

  /// Le fichier client est partagé : prévenir le reste de l'OS après une
  /// écriture, sinon la Facturation ouverte à côté propose une liste périmée.
  const rafraichir = async () => {
    await etat.rafraichir();
    invaliderReferentiel();
  };

  const reglages = useMemo(
    () => ({ objectifs: {}, seuils: {}, secteursCibles: [], vues: [], ...(d.reglagesRec?.data || {}) }),
    [d.reglagesRec],
  );

  // ---- Arrivée depuis une notification, la recherche ou une autre app ----

  const lienEnAttente = useRef(null);
  const appliquerLien = useCallback(() => {
    const p = lienEnAttente.current;
    if (!p) return;
    if (p.client) {
      if (!d.clients.some((c) => c.id === p.client)) return; // pas encore chargé
      setCompteId(p.client);
    } else if (p.affaire) {
      const o = d.opportunites.find((x) => x.id === p.affaire);
      if (!o) return;
      setCompteId(o.data.clientId);
    } else if (p.vue) setVue(p.vue);
    lienEnAttente.current = null;
  }, [d.clients, d.opportunites]);
  // Le lien a pu arriver avant les données (ouverture à la demande).
  useEffect(() => {
    appliquerLien();
  }, [appliquerLien]);

  useEffect(() => {
    const aller = (e) => {
      if (e.detail?.app !== manifest.id) return;
      lienEnAttente.current = e.detail.params || null;
      appliquerLien();
    };
    window.addEventListener("companyos:lien", aller);
    return () => window.removeEventListener("companyos:lien", aller);
  }, [appliquerLien]);
  useEffect(appliquerLien, [appliquerLien]);

  // ---- Dérivés ------------------------------------------------------------

  const maintenant = today();
  const membreDe = useCallback((id) => d.membres.find((m) => m.id === id), [d.membres]);
  const clientDe = useCallback((id) => d.clients.find((c) => c.id === id), [d.clients]);

  const ctx = useMemo(() => {
    const joursSansContact = {};
    const ventes = {};
    const sante = {};
    const ca = {};
    for (const c of d.clients) {
      joursSansContact[c.id] = jourssansContact(c.id, d.activites, maintenant);
      ventes[c.id] = ventesCompte(c.id, d.documents, d.reglements, { totauxDe: totaux, etatPaiement, maintenant });
      ca[c.id] = ventes[c.id].ca12;
    }
    const ouvertesPar = {};
    const perduesPar = {};
    for (const o of d.opportunites) {
      if (ETAPES_OUVERTES.includes(o.data.etape)) ouvertesPar[o.data.clientId] = (ouvertesPar[o.data.clientId] || 0) + 1;
      if (o.data.etape === "perdue" && (o.data.etapeLe || "") >= maintenant.slice(0, 7)) perduesPar[o.data.clientId] = 1;
    }
    for (const c of d.clients) {
      sante[c.id] = santeCompte({
        ventes: ventes[c.id],
        joursSansContact: joursSansContact[c.id],
        affairesOuvertes: ouvertesPar[c.id] || 0,
        perduesRecentes: perduesPar[c.id] || 0,
      });
    }
    const stag = {};
    const prochaine = {};
    for (const o of d.opportunites) {
      stag[o.id] = stagnation(o, d.activites, { seuils: reglages.seuils, maintenant });
      prochaine[o.id] = prochaineActivite(o, d.activites, maintenant);
    }
    const leads = d.clients
      .filter((c) => estLead(c, d.opportunites))
      .map((c) => ({ client: c, ...scoreLead(c, { campagnes: d.campagnes, activites: d.activites, secteursCibles: reglages.secteursCibles, maintenant }) }))
      .sort((a, b) => b.score - a.score);
    return { joursSansContact, ventes, sante, ca, stag, prochaine, leads };
  }, [d, reglages, maintenant]);

  const taches = useMemo(() => aFaire(d.activites, maintenant, 7), [d.activites, maintenant]);
  const objectifCible = reglages.objectifs?.[moi] || reglages.objectifs?.equipe || 0;
  const objectif = useMemo(
    () => progressionObjectif(d.opportunites, objectifCible, {
      maintenant,
      responsableId: reglages.objectifs?.[moi] ? moi : null,
    }),
    [d.opportunites, objectifCible, reglages.objectifs, moi, maintenant],
  );
  const prev = useMemo(() => previsions(d.opportunites, { maintenant, mois: 3 }), [d.opportunites, maintenant]);
  const perf = useMemo(() => performance(d.opportunites, d.clients, { maintenant }), [d.opportunites, d.clients, maintenant]);

  // ---- Écritures ----------------------------------------------------------

  const tache = useCallback(async (f, succes) => {
    try {
      const r = await f();
      if (succes) flash(succes);
      return r;
    } catch (err) {
      flash(err.message);
      return null;
    }
  }, [flash]);

  /// `large` : un vrai formulaire (deux colonnes) — la boîte prend sa
  /// largeur ; sinon, la boîte standard du système (choix rapides).
  const ouvrirModal = (title, render, large = false) =>
    large
      ? modal.open({ title, nu: true, render: (p) => <div className="crmFormLarge">{render(p)}</div> })
      : modal.open({ title, render });

  const prevenir = (responsableId, titre, message, params) => {
    if (!responsableId || responsableId === moi) return;
    envoyerA(responsableId, { source: manifest.slug, titre, message, lien: { app: manifest.id, params } });
  };

  // Comptes
  const editerCompte = async (rec = null, defaut = {}) => {
    const valeurs = await ouvrirModal(rec ? t("modifier") : t("nouveauCompte"), ({ close }) => (
      <FormCompte
        t={t}
        defaut={rec ? { id: rec.id, ...rec.data } : defaut}
        clients={d.clients}
        membres={d.membres}
        onValider={close}
        onOuvrir={(c) => { close(null); setCompteId(c.id); }}
      />
    ), true);
    if (!valeurs) return null;
    return tache(async () => {
      let id = rec?.id;
      if (rec) await api.records.update(manifest.slug, "clients", rec.id, { ...rec.data, ...valeurs });
      else id = (await api.records.create(manifest.slug, "clients", { ...valeurs, responsableId: valeurs.responsableId || moi })).id;
      if (valeurs.responsableId !== (rec?.data.responsableId || "")) {
        prevenir(valeurs.responsableId, t("clientAssigne", { nom: valeurs.entreprise || valeurs.nom }), valeurs.ville || "", { client: id });
      }
      await rafraichir();
      if (!rec) setCompteId(id);
      return id;
    }, t("enregistre"));
  };

  const supprimerCompte = async (rec) => {
    const ok = await modal.confirm({
      title: t("supprimerCompte"),
      message: t("supprimerCompteConfirme", { nom: nomDe(rec) }),
      detail: t("supprimerCompteDetail"),
      confirmLabel: t("supprimer"),
      danger: true,
    });
    if (!ok) return;
    await tache(async () => {
      for (const o of d.opportunites.filter((x) => x.data.clientId === rec.id)) await api.records.remove(manifest.slug, "opportunites", o.id);
      for (const a of d.activites.filter((x) => x.data.clientId === rec.id)) await api.records.remove(manifest.slug, "activites", a.id);
      for (const c of d.contacts.filter((x) => x.data.clientId === rec.id)) await api.records.remove(manifest.slug, "contacts", c.id);
      await api.records.remove(manifest.slug, "clients", rec.id);
      setCompteId(null);
      await rafraichir();
    }, t("supprime"));
  };

  const majCompte = (rec, champs, succes) =>
    tache(async () => {
      await api.records.update(manifest.slug, "clients", rec.id, { ...rec.data, ...champs });
      await rafraichir();
    }, succes);

  // Affaires
  const editerAffaire = async (rec = null, defaut = {}) => {
    const valeurs = await ouvrirModal(rec ? rec.data.libelle : t("nouvelleAffaire"), ({ close }) => (
      <FormAffaire
        t={t}
        defaut={rec ? rec.data : { responsableId: moi, ...defaut }}
        clients={d.clients}
        contacts={d.contacts}
        membres={d.membres}
        onValider={close}
      />
    ), true);
    if (!valeurs) return;
    await tache(async () => {
      const etapeChange = rec && rec.data.etape !== valeurs.etape;
      const donnees = { ...(rec?.data || {}), ...valeurs, etapeLe: !rec || etapeChange ? maintenant : rec.data.etapeLe };
      let id = rec?.id;
      if (rec) await api.records.update(manifest.slug, "opportunites", rec.id, donnees);
      else id = (await api.records.create(manifest.slug, "opportunites", donnees)).id;
      if (valeurs.responsableId && valeurs.responsableId !== (rec?.data.responsableId || "")) {
        prevenir(valeurs.responsableId, t("affaireAssignee", { libelle: valeurs.libelle }), nomDe(clientDe(valeurs.clientId)), { affaire: id });
      }
      await etat.rafraichir();
    }, t("enregistre"));
  };

  const supprimerAffaire = async (rec) => {
    const ok = await modal.confirm({ title: t("supprimer"), message: rec.data.libelle, confirmLabel: t("supprimer"), danger: true });
    if (!ok) return;
    await tache(async () => {
      await api.records.remove(manifest.slug, "opportunites", rec.id);
      await etat.rafraichir();
    }, t("supprime"));
  };

  /// Changer l'étape d'une affaire. Perdue : le motif est demandé. Gagnée :
  /// le compte devient client, et la suite est proposée (facture, projet).
  const changerEtape = async (opp, etape) => {
    if (!opp || opp.data.etape === etape) return;
    let motifPerte = opp.data.motifPerte || "";
    if (etape === "perdue") {
      motifPerte = await ouvrirModal(t("motifPerteTitre"), ({ close }) => <FormMotifPerte t={t} onValider={close} />);
      if (!motifPerte) return;
    }
    const client = clientDe(opp.data.clientId);
    const ok = await tache(async () => {
      await api.records.update(manifest.slug, "opportunites", opp.id, {
        ...opp.data,
        etape,
        etapeLe: maintenant,
        motifPerte: etape === "perdue" ? motifPerte : "",
        ...(etape === "gagnee" || etape === "perdue" ? { dateCloture: maintenant } : {}),
      });
      if (etape === "gagnee" && client && client.data.statut !== "actif") {
        await api.records.update(manifest.slug, "clients", client.id, { ...client.data, statut: "actif", clientDepuis: client.data.clientDepuis || maintenant });
        flash(t("compteDevenuClient", { nom: nomDe(client) }));
      }
      await rafraichir();
      return true;
    });
    if (!ok || etape !== "gagnee") return;
    const suite = await ouvrirModal(t("gagneeTitre"), ({ close }) => <FormGagnee t={t} onValider={close} />);
    if (suite === "facture") creerDocument(client, opp, "facture");
    if (suite === "projet") ouvrirProjet(client, opp);
  };

  // Contacts
  const editerContact = async (rec = null, clientId = null) => {
    const valeurs = await ouvrirModal(rec ? t("modifier") : t("nouveauContact"), ({ close }) => (
      <FormContact t={t} defaut={rec?.data} onValider={close} />
    ), true);
    if (!valeurs) return;
    await tache(async () => {
      if (rec) await api.records.update(manifest.slug, "contacts", rec.id, { ...rec.data, ...valeurs });
      else await api.records.create(manifest.slug, "contacts", { ...valeurs, clientId });
      await etat.rafraichir();
    }, t("enregistre"));
  };

  const supprimerContact = async (rec) => {
    const ok = await modal.confirm({ title: t("supprimer"), message: [rec.data.prenom, rec.data.nom].join(" "), confirmLabel: t("supprimer"), danger: true });
    if (!ok) return;
    await tache(async () => {
      await api.records.remove(manifest.slug, "contacts", rec.id);
      await etat.rafraichir();
    }, t("supprime"));
  };

  // Activités
  const creerActivite = (donnees) =>
    api.records.create(manifest.slug, "activites", {
      date: maintenant,
      fait: false,
      auteurId: moi,
      ...donnees,
      echeance: donnees.type === "tache" ? donnees.echeance || maintenant : "",
    });

  const saisieRapide = async (clientId, texte, opportuniteId = "") => {
    if (!texte.trim()) return false;
    const a = analyserSaisie(texte, maintenant);
    const r = await tache(async () => {
      await creerActivite({ ...a, clientId, opportuniteId });
      await etat.rafraichir();
      return true;
    }, t("saisieComprise", { type: t(`act_${a.type}`), echeance: a.echeance ? t("pour", { date: dateCourte(a.echeance) }) : "" }));
    return Boolean(r);
  };

  const noterActivite = async (clientId, defaut = {}) => {
    const affaires = d.opportunites.filter((o) => o.data.clientId === clientId && ETAPES_OUVERTES.includes(o.data.etape));
    const valeurs = await ouvrirModal(t("nouvelleActivite"), ({ close }) => (
      <FormActivite t={t} affaires={affaires} defaut={defaut} onValider={close} />
    ), true);
    if (!valeurs) return;
    await tache(async () => {
      await creerActivite({ ...valeurs, clientId });
      await etat.rafraichir();
    }, t("enregistre"));
  };

  /// Après un appel : le compte rendu, la prochaine action, et l'étape.
  const compteRendu = async (clientId, contactId = "") => {
    const affaires = d.opportunites.filter((o) => o.data.clientId === clientId && ETAPES_OUVERTES.includes(o.data.etape));
    const v = await ouvrirModal(t("compteRenduTitre"), ({ close }) => (
      <FormCompteRendu t={t} affaires={affaires} onValider={close} />
    ), true);
    if (!v) return;
    await tache(async () => {
      await creerActivite({
        type: "appel",
        clientId,
        contactId,
        opportuniteId: v.opportuniteId,
        resultat: v.resultat,
        resume: v.resume || t(`res_${v.resultat}`),
      });
      if (v.suite) {
        await creerActivite({ type: "tache", clientId, contactId, opportuniteId: v.opportuniteId, resume: v.suite, echeance: v.quand });
      }
      const opp = v.etape ? d.opportunites.find((o) => o.id === v.opportuniteId) : null;
      if (opp && opp.data.etape !== v.etape) {
        await api.records.update(manifest.slug, "opportunites", opp.id, { ...opp.data, etape: v.etape, etapeLe: maintenant });
      }
      await etat.rafraichir();
    }, t("enregistre"));
  };

  const basculerTache = (a) =>
    tache(async () => {
      await api.records.update(manifest.slug, "activites", a.id, { ...a.data, fait: !a.data.fait, faitLe: a.data.fait ? "" : maintenant });
      await etat.rafraichir();
    });

  const reporterTache = async (a) => {
    const date = await ouvrirModal(t("reporterTitre"), ({ close }) => <FormReporter t={t} onValider={close} />);
    if (!date) return;
    await tache(async () => {
      await api.records.update(manifest.slug, "activites", a.id, { ...a.data, echeance: date });
      await etat.rafraichir();
    }, t("enregistre"));
  };

  const supprimerActivite = async (a) => {
    const ok = await modal.confirm({ title: t("supprimer"), message: a.data.resume, confirmLabel: t("supprimer"), danger: true });
    if (!ok) return;
    await tache(async () => {
      await api.records.remove(manifest.slug, "activites", a.id);
      await etat.rafraichir();
    });
  };

  // ---- Liens avec les autres apps -----------------------------------------

  const ecrire = (client, contact = null) => {
    const email = contact?.data.email || client?.data.email || "";
    const prenom = contact?.data.prenom || "";
    composerCourriel({ a: email, sujet: "", texte: prenom ? `Bonjour ${prenom},\n\n` : "Bonjour,\n\n" });
  };

  /// Un devis ou une facture préremplis dans l'Éditeur de factures.
  const creerDocument = (client, opp = null, type = "devis") => {
    if (!client) return;
    ouvrirDansEditeur({
      client,
      type,
      objet: opp?.data.libelle || "",
      montant: opp?.data.montant || 0,
      opportuniteId: opp?.id || "",
    });
  };

  const planifierRdv = async (client) => {
    const v = await ouvrirModal(t("rdvTitre"), ({ close }) => (
      <FormRdv t={t} defaut={{ titre: `${nomDe(client)}`, lieu: [client.data.adresse, client.data.ville].filter(Boolean).join(", ") }} onValider={close} />
    ), true);
    if (!v) return;
    await tache(async () => {
      const ev = await api.records.create("agenda", "evenements", { titre: v.titre, date: v.date, heure: v.heure, fin: "", lieu: v.lieu, clientId: client.id });
      // Une tâche CRM le rappelle dans « Ma journée » ; l'Agenda ne la
      // montre pas une seconde fois (elle porte l'identifiant de l'événement).
      await creerActivite({ type: "tache", clientId: client.id, resume: `RDV — ${v.titre}${v.heure ? ` (${v.heure})` : ""}`, echeance: v.date, evenementId: ev.id });
      await etat.rafraichir();
    }, t("rdvCree"));
  };

  const ouvrirProjet = async (client, opp = null) => {
    if (!client) return;
    const nom = opp?.data.libelle ? `${nomDe(client)} — ${opp.data.libelle}` : nomDe(client);
    await tache(async () => {
      const colonnes = COLONNES_PAR_DEFAUT();
      const tableau = await api.records.create("projets", "tableaux", { nom, couleur: "#1a73e8", colonnes });
      await api.records.create("projets", "cartes", {
        tableauId: tableau.id,
        colonneId: colonnes[0].id,
        ordre: 0,
        titre: `Lancement — ${nom}`,
        description: opp?.data.notes || "",
        etiquettes: [],
        checklist: [],
        commentaires: [],
        pieces: [],
        liens: { clientId: client.id, opportuniteId: opp?.id || "" },
      });
      await etat.rafraichir();
      ouvrirFenetre("projets");
    }, t("projetCree", { nom }));
  };

  const ajouterListe = async (client) => {
    const existantes = [...new Set(d.clients.flatMap((c) => c.data.etiquettes || []))].sort();
    const tag = await ouvrirModal(t("etiquetteTitre"), ({ close }) => <FormEtiquette t={t} existantes={existantes} onValider={close} />);
    if (!tag) return;
    await majCompte(client, { etiquettes: [...new Set([...(client.data.etiquettes || []), tag])] }, t("etiquetteAjoutee", { tag }));
  };

  // ---- Leads --------------------------------------------------------------

  const convertirLead = async (client, { besoin, montant, responsableId }) =>
    tache(async () => {
      await api.records.update(manifest.slug, "clients", client.id, {
        ...client.data,
        qualifie: true,
        qualifieLe: maintenant,
        besoin: besoin || client.data.besoin || "",
        montantEstime: Number(montant) || client.data.montantEstime || 0,
        responsableId: responsableId || client.data.responsableId || moi,
      });
      const cree = await api.records.create(manifest.slug, "opportunites", {
        clientId: client.id,
        libelle: besoin || client.data.besoin || nomDe(client),
        montant: Number(montant) || Number(client.data.montantEstime) || 0,
        etape: "qualifie",
        etapeLe: maintenant,
        probabilite: "",
        dateCloture: "",
        responsableId: responsableId || client.data.responsableId || moi,
        notes: "",
      });
      prevenir(responsableId, t("affaireAssignee", { libelle: besoin || nomDe(client) }), nomDe(client), { affaire: cree.id });
      await rafraichir();
    }, t("leadConverti"));

  const ecarterLead = (client) => majCompte(client, { ecarte: true, ecarteLe: maintenant }, t("leadEcarte"));

  const attribuer = (client, responsableId) =>
    tache(async () => {
      await api.records.update(manifest.slug, "clients", client.id, { ...client.data, responsableId });
      prevenir(responsableId, t("clientAssigne", { nom: nomDe(client) }), client.data.ville || "", { client: client.id });
      await rafraichir();
    }, t("enregistre"));

  // ---- Réglages et vues ---------------------------------------------------

  const enregistrerReglages = (valeurs) =>
    tache(async () => {
      const donnees = { ...reglages, ...valeurs };
      if (d.reglagesRec) await api.records.update(manifest.slug, "reglages", d.reglagesRec.id, donnees);
      else await api.records.create(manifest.slug, "reglages", donnees);
      await etat.rafraichir();
    }, t("reglagesEnregistres"));

  const enregistrerVue = async () => {
    const v = await ouvrirModal(t("nouvelleVue").replace("+ ", ""), ({ close }) => <FormVue t={t} membres={d.membres} onValider={close} />, true);
    if (!v) return;
    const id = `v${Date.now().toString(36)}`;
    await enregistrerReglages({ vues: [...(reglages.vues || []), { id, ...v }] });
    setVueComptes(id);
    setVue("comptes");
    setCompteId(null);
  };

  const supprimerVue = (id) => {
    if (vueComptes === id) setVueComptes(null);
    return enregistrerReglages({ vues: (reglages.vues || []).filter((v) => v.id !== id) });
  };

  // ---- Import / export ----------------------------------------------------

  const exporterComptes = async (liste) => {
    const lignes = [
      [t("entreprise"), t("contactPrincipal"), t("ville"), t("telephone"), t("email"), t("statut"), t("responsable"), t("colCA"), t("colSante"), t("colDernier")],
      ...liste.map((c) => [
        c.data.entreprise, c.data.nom, c.data.ville, c.data.telephone, c.data.email,
        t(`statut_${c.data.statut}`), membreDe(c.data.responsableId)?.name || "",
        Math.round(ctx.ca[c.id] || 0), ctx.sante[c.id]?.score ?? "",
        ctx.joursSansContact[c.id] === null ? t("jamaisContacte") : t("ilYa", { n: ctx.joursSansContact[c.id] }),
      ]),
    ];
    // BOM UTF-8 et point-virgule : sans les deux, Excel en configuration
    // française ouvre le fichier en une seule colonne, accents cassés.
    const csv = "﻿" + lignes.map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const node = await saveAs(new Blob([csv], { type: "text/csv;charset=utf-8" }), "comptes-crm.csv", { folder: "CRM" });
    if (node) flash(`« ${node.name} »`);
  };

  const importerComptes = async (fichier) => {
    if (!fichier) return;
    const texte = await fichier.text();
    const [entetes = [], ...lignes] = lireCsv(texte);
    const colonnes = devinerColonnes(entetes);
    const existants = [...d.clients];
    let crees = 0;
    let ignores = 0;
    await tache(async () => {
      for (const ligne of lignes) {
        const v = {};
        colonnes.forEach((champ, i) => {
          const x = String(ligne[i] ?? "").trim();
          if (!champ || champ === "ignorer" || !x) return;
          v[champ] = champ === "etiquettes" ? x.split(/[,;|]/).map((e) => e.trim()).filter(Boolean) : x;
        });
        if (!v.entreprise && !v.nom) continue;
        if (doublons({ data: v }, existants).length) { ignores += 1; continue; }
        const cree = await api.records.create(manifest.slug, "clients", { statut: "prospect", source: "import", responsableId: moi, ...v });
        existants.push(cree);
        crees += 1;
      }
      await rafraichir();
    });
    flash(t("importResume", { crees, doublons: ignores }));
  };

  // ---- Rendu --------------------------------------------------------------

  const actions = {
    ouvrirCompte: (id) => setCompteId(id),
    fermerCompte: () => setCompteId(null),
    editerCompte, supprimerCompte, majCompte,
    editerAffaire, supprimerAffaire, changerEtape,
    editerContact, supprimerContact,
    saisieRapide, noterActivite, compteRendu, basculerTache, reporterTache, supprimerActivite,
    ecrire, creerDocument, planifierRdv, ouvrirProjet, ajouterListe,
    convertirLead, ecarterLead, attribuer,
    enregistrerReglages, enregistrerVue, supprimerVue,
    exporterComptes, importerComptes,
    allerA: (v) => { setCompteId(null); setVue(v); },
    // Historique et corbeille (communs à l'OS — voir src/apps/historique.jsx).
    historiqueCompte: (c) =>
      ouvrirHistorique({ module: manifest.slug, collection: "clients", id: c.id, titre: nomDe(c), actuel: c.data, onRestaure: rafraichir }),
    comptesSupprimes: () => ouvrirCorbeilleFiches({ module: manifest.slug, collection: "clients", titre: t("navComptes"), onRestaure: rafraichir }),
    ouvrirApp: (id) => ouvrirFenetre(id),
  };

  const commun = { t, d, ctx, actions, membreDe, clientDe, moi, admin, telephone, reglages, maintenant };
  const compte = compteId ? clientDe(compteId) : null;
  const enRetard = taches.filter((x) => x.enRetard).length;

  const contenu = compte ? (
    <Fiche {...commun} client={compte} />
  ) : vue === "journee" ? (
    <Journee {...commun} taches={taches} objectif={objectif} perf={perf} />
  ) : vue === "pipeline" ? (
    <Pipeline {...commun} objectif={objectif} prev={prev} />
  ) : vue === "comptes" ? (
    <Comptes {...commun} vueId={vueComptes} setVueId={setVueComptes} />
  ) : vue === "contacts" ? (
    <Contacts {...commun} />
  ) : vue === "leads" ? (
    <Leads {...commun} />
  ) : (
    <Previsions {...commun} prev={prev} perf={perf} objectif={objectif} />
  );

  const pastille = { journee: enRetard, leads: ctx.leads.length };

  return (
    <ModuleWindow manifest={manifest} className="crmApp">
      {session.status !== "authenticated" ? (
        <div className="crmLocked">
          <Icon fafa="faLock" width={22} />
          <span>{t("verrou")}</span>
        </div>
      ) : (
        <div className="crmShell" data-telephone={telephone ? "1" : undefined}>
          {!telephone ? (
            <nav className="crmNav" aria-label={t("appNom")}>
              <div className="crmMarque">
                <span className="crmMarqueLogo" aria-hidden="true">C</span>
                <span>{t("appNom")}</span>
              </div>
              {NAV.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="crmNavItem"
                  data-on={!compte && vue === n.id ? "1" : undefined}
                  aria-current={!compte && vue === n.id ? "page" : undefined}
                  onClick={() => actions.allerA(n.id)}
                >
                  <Icon fafa={n.icone} width={14} />
                  <span>{t(n.cle)}</span>
                  {pastille[n.id] ? <span className="crmNavPastille" data-ton={n.id === "journee" ? "bad" : "info"}>{pastille[n.id]}</span> : null}
                </button>
              ))}
              <button type="button" className="crmNavItem" onClick={() => ouvrirFenetre("agenda")}>
                <Icon fafa="faCalendar" width={14} />
                <span>{t("navAgenda")}</span>
                <Icon fafa="faArrowUpRightFromSquare" width={10} />
              </button>
              <div className="crmNavGroupe">{t("vuesEnregistrees")}</div>
              {(reglages.vues || []).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="crmNavItem crmNavVue"
                  data-on={!compte && vue === "comptes" && vueComptes === v.id ? "1" : undefined}
                  onClick={() => { setVueComptes(v.id); actions.allerA("comptes"); }}
                >
                  <Icon fafa="faFilter" width={11} />
                  <span>{v.nom}</span>
                </button>
              ))}
              <button type="button" className="crmNavItem crmNavAjout" onClick={enregistrerVue}>
                <span>{t("nouvelleVue")}</span>
              </button>
            </nav>
          ) : null}

          <main className="crmMain cosScroll" ref={zone}>
            {etat.initial ? (
              <div className="crmPage"><Squelette lignes={9} /></div>
            ) : etat.erreur && !d.clients.length ? (
              <div className="crmVide">
                <span>{t("erreurChargement")}</span>
                <button type="button" className="crmBtn" onClick={() => etat.recharger()}>{t("reessayer")}</button>
              </div>
            ) : (
              contenu
            )}
          </main>

          {telephone ? (
            <>
              {!compte ? (
                <button type="button" className="crmFab" aria-label={t("nouveauCompte")} onClick={() => editerCompte()}>
                  <Icon fafa="faPlus" width={18} />
                </button>
              ) : null}
              <nav className="crmTabs" aria-label={t("appNom")}>
                {NAV.filter((n) => ["journee", "pipeline", "comptes", "leads", "previsions"].includes(n.id)).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    data-on={!compte && vue === n.id ? "1" : undefined}
                    aria-current={!compte && vue === n.id ? "page" : undefined}
                    onClick={() => actions.allerA(n.id)}
                  >
                    <Icon fafa={n.icone} width={17} />
                    <span>{t(n.cle)}</span>
                    {pastille[n.id] ? <i className="crmTabPastille">{pastille[n.id]}</i> : null}
                  </button>
                ))}
              </nav>
            </>
          ) : null}

          {notice ? <div className="crmNotice" role="status">{notice}</div> : null}
        </div>
      )}
    </ModuleWindow>
  );
}

