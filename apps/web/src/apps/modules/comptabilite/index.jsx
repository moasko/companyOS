// Comptabilité.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI DISTINGUE CETTE APPLICATION
//
// Les logiciels les plus répandus — Sage et Ciel en Afrique francophone,
// QuickBooks, Xero et Pennylane ailleurs — partagent une même discipline :
// des journaux, des pièces numérotées sans trou, un justificatif derrière
// chaque pièce, une banque rapprochée, des comptes de tiers lettrés, et une
// clôture qui verrouille le passé. Cette application la reprend en entier,
// avec trois choix propres à une PME ivoirienne :
//
//   1. **Les écritures viennent des autres applications.** Factures et
//      règlements (Facturation), tickets (Caisse), factures fournisseur et
//      paiements (Achats), bulletins (Paie), notes de frais : tout arrive
//      dans « À traiter », prêt à valider, marqué de son origine pour ne
//      jamais être compté deux fois. Un logiciel externe ne peut pas faire
//      cela : il faudrait d'abord lui ressaisir les pièces.
//
//   2. **Deux façons de saisir.** Au compte, par pièce et au clavier, pour
//      le comptable ; par phrase — « J'ai payé le loyer » — pour celui qui
//      ne connaît pas son plan. Les deux produisent la même écriture.
//
//   3. **Le mobile money est un compte de trésorerie de plein droit**
//      (531), rapproché comme une banque.
//
// CE QUI EST REPRIS DE SAP S/4HANA FINANCE
//
//   - **le journal unique** : une seule collection d'écritures, dont
//     balance, états, TVA et analytique ne sont que des agrégations ;
//   - **les postes ouverts** et le lettrage : « qui doit quoi, depuis
//     quand, sur quelle facture » ;
//   - **la dimension analytique** portée par l'écriture ;
//   - **la clôture de période**, précédée de contrôles qui disent ce qui
//     empêche de verrouiller.
//
// Le référentiel est le SYSCOHADA révisé (AUDCIF). Les règles vivent dans
// domaine.js, journaux.js, banque.js, lettrage.js, etats.js et cloture.js —
// toutes testées sans navigateur.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { Contenu, useChargement } from "../../chargement";
import { useEntreprise } from "../../entreprise";
import { totaux } from "@companyos/shared/facturation";
import { ecritureDuTicket } from "../caisse/domaine";
import {
  ecritureDeFacture as ecritureAchat,
  ecriturePaiement as ecriturePaiementAchat,
} from "../achats/domaine";
import { ecritureDeBulletin } from "../paie/domaine";
import { ecritureInventaire } from "../stock/regles";
import { ecritureDeNote } from "../frais/domaine";
import * as D from "./domaine";
import { journalDe, prochainNumero } from "./journaux";
import { indexLettres } from "./lettrage";
import { aTraiter as listeATraiter, nomMois } from "./cloture";
import { Cpt, aujourdhui } from "./commun";
import { Pilotage, ATraiter } from "./Pilotage";
import { Saisie } from "./Saisie";
import { Banque } from "./Banque";
import { Tiers } from "./Tiers";
import { Journaux, GrandLivre, Balance, Plan } from "./Registres";
import { Etats, Tva } from "./Etats";
import { Cloture } from "./Cloture";
import "./comptabilite.scss";
import { manifest as descriptif } from "./manifest";

export const manifest = { ...descriptif, Window: ComptabiliteApp };

const NAV = [
  { groupe: "Suivre" },
  { id: "pilotage", label: "Pilotage", icone: "faChartPie" },
  { id: "atraiter", label: "À traiter", icone: "faInbox", badge: "reprises" },
  { groupe: "Tenir" },
  { id: "saisie", label: "Saisie par pièce", icone: "faPenToSquare" },
  { id: "banque", label: "Banque et rapprochement", icone: "faBuildingColumns", badge: "banque" },
  { id: "tiers", label: "Tiers et lettrage", icone: "faHandHoldingDollar" },
  { id: "journal", label: "Journaux", icone: "faBook" },
  { groupe: "Analyser" },
  { id: "grandlivre", label: "Grand livre", icone: "faListUl" },
  { id: "balance", label: "Balance", icone: "faScaleBalanced" },
  { id: "etats", label: "États financiers", icone: "faFileInvoiceDollar" },
  { id: "tva", label: "TVA", icone: "faReceipt" },
  { groupe: "Fin de période" },
  { id: "cloture", label: "Clôture", icone: "faLock" },
  { id: "plan", label: "Plan comptable", icone: "faSitemap" },
];

const VUES = {
  pilotage: Pilotage,
  atraiter: ATraiter,
  saisie: Saisie,
  banque: Banque,
  tiers: Tiers,
  journal: Journaux,
  grandlivre: GrandLivre,
  balance: Balance,
  etats: Etats,
  tva: Tva,
  cloture: Cloture,
  plan: Plan,
};

function ComptabiliteApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const { entreprise } = useEntreprise(ouvert);

  const [section, setSection] = useState("pilotage");
  const [intention, setIntention] = useState(null);
  const [donnees, setDonnees] = useState({
    ecritures: [],
    documents: [],
    reglements: [],
    tickets: [],
    achats: { factures: [], paiements: [], fournisseurs: [] },
    paie: { bulletins: [], salaries: [] },
    notesFrais: [],
    releves: [],
    lettrages: [],
    clientsCrm: [],
    inventaires: [],
    reglages: null,
  });
  const [periode, setPeriode] = useState(() => D.exercice(new Date().getFullYear()));
  const [axe, setAxe] = useState("");
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    const liste = (m, c) => api.records.list(m, c).catch(() => []);
    const [e, f, r, g, tk, af, ap, four, bul, sal, ndf, rel, let_, crm, inv] = await Promise.all([
      api.records.list(manifest.slug, "ecritures"),
      // Chaque application peut ne pas être installée : la comptabilité
      // reste utilisable, simplement sans la reprise correspondante.
      liste("facturation", "factures"),
      liste("facturation", "reglements"),
      liste(manifest.slug, "reglages"),
      liste("caisse", "tickets"),
      liste("achats", "factures"),
      liste("achats", "paiements"),
      liste("stock", "fournisseurs"),
      liste("paie", "bulletins"),
      liste("rh", "salaries"),
      liste("frais", "notes"),
      liste(manifest.slug, "releves"),
      liste(manifest.slug, "lettrages"),
      liste("crm", "clients"),
      liste("stock", "inventaires"),
    ]);
    setDonnees({
      ecritures: e,
      documents: f,
      reglements: r,
      reglages: g[0] || null,
      tickets: tk,
      achats: { factures: af, paiements: ap, fournisseurs: four },
      paie: { bulletins: bul, salaries: sal },
      notesFrais: ndf,
      releves: rel,
      lettrages: let_,
      clientsCrm: crm,
      inventaires: inv,
    });
  }, []);
  // Rechargement en direct quand un collègue modifie ces collections.
  const etat = useChargement(ouvert, charger, { ecoute: ["comptabilite/*", "facturation/*", "achats/*", "paie/*", "frais/notes", "caisse/*"] });

  // Une autre application peut ouvrir la Comptabilité sur un écran précis
  // (« voir l'écriture de cette facture »).
  useEffect(() => {
    const aller = (ev) => {
      if (ev.detail.app !== manifest.id) return;
      const { section: s, ...reste } = ev.detail.params || {};
      if (s && VUES[s]) {
        setSection(s);
        setIntention(Object.keys(reste).length ? reste : null);
      }
    };
    window.addEventListener("companyos:lien", aller);
    return () => window.removeEventListener("companyos:lien", aller);
  }, []);

  const { ecritures, documents, reglements, tickets, achats, paie, notesFrais, reglages, releves, lettrages, inventaires } = donnees;

  // ---- Dérivations --------------------------------------------------------

  const suggerees = useMemo(() => {
    const nomF = (id) => achats.fournisseurs.find((f) => f.id === id)?.data?.nom || "";
    const propositions = [
      ...achats.factures.map((f) => ({
        journal: "ACH",
        source: "Achats",
        ...ecritureAchat({ id: f.id, ...f.data }, nomF(f.data.fournisseurId)),
      })),
      ...achats.paiements.map((p) => {
        const fac = achats.factures.find((f) => f.id === p.data.factureId);
        return {
          source: "Achats",
          ...ecriturePaiementAchat({ id: p.id, ...p.data }, fac, nomF(fac?.data?.fournisseurId)),
        };
      }),
      // Une note de frais compte dès qu'elle est approuvée — la charge est
      // née, même si le remboursement attend.
      ...notesFrais
        .filter((n) => ["approuvee", "remboursee"].includes(n.data.etat))
        .map((n) => {
          const sal = paie.salaries.find((x) => x.id === n.data.salarieId);
          const nom = sal ? `${sal.data.prenom || ""} ${sal.data.nom || ""}`.trim() : "salarié";
          return { journal: "OD", source: "Notes de frais", ...ecritureDeNote(n.data, n.id, nom) };
        }),
      ...paie.bulletins
        .filter((bul) => bul.data?.calcul)
        .map((bul) => {
          const sal = paie.salaries.find((x) => x.data.matricule === bul.data.matricule);
          return { journal: "OD", source: "Paie", ...ecritureDeBulletin(bul.data.calcul, sal?.data || {}, bul.data.mois) };
        }),
      // Les écarts d'un inventaire validé du Stock : perte ou excédent,
      // valorisé au prix moyen pondéré (6031 / 311).
      ...inventaires
        .filter((i) => i.data.statut === "valide" && i.data.valeurEcart)
        .map((i) => ecritureInventaire(i.data, i.id, i.data.valeurEcart)),
    ].filter(Boolean);
    return D.ecrituresSuggerees({
      documents,
      reglements,
      tickets,
      ecritureTicket: ecritureDuTicket,
      propositions,
      ecritures,
      totauxDe: totaux,
    });
  }, [documents, reglements, tickets, achats, paie, notesFrais, ecritures, inventaires]);

  // Période et axe voyagent ensemble : c'est le contexte d'observation, et
  // toutes les restitutions le respectent sans le savoir (voir lignesDe).
  const contexte = useMemo(() => ({ ...periode, axe: axe || undefined }), [periode, axe]);
  const r = reglages?.data || {};
  const clotureAu = r.clotureAu || "";

  // Les relevés importés, regroupés par compte de trésorerie.
  const relevesParCompte = useMemo(() => {
    const m = {};
    for (const rec of releves) {
      const c = rec.data.compte;
      if (!m[c]) m[c] = { lignes: [], records: [], solde: null, soldeAu: "" };
      m[c].records.push(rec);
      for (const l of rec.data.lignes || []) m[c].lignes.push({ ...l, recordId: rec.id });
      if (rec.data.solde != null && String(rec.data.au) >= String(m[c].soldeAu)) {
        m[c].solde = rec.data.solde;
        m[c].soldeAu = rec.data.au;
      }
    }
    for (const c of Object.keys(m)) m[c].lignes.sort((a, b) => a.date.localeCompare(b.date));
    return m;
  }, [releves]);

  const lettres = useMemo(
    () => ({ 411: indexLettres(lettrages, "411"), 401: indexLettres(lettrages, "401") }),
    [lettrages],
  );

  // Les échéances des factures, pour compter l'ancienneté d'une créance
  // depuis la date où elle est due, et non depuis son émission.
  const echeances = useMemo(
    () => new Map(documents.filter((d) => d.data?.numero && d.data?.echeance).map((d) => [d.data.numero, d.data.echeance])),
    [documents],
  );

  const clientsAges = useMemo(
    () => D.balanceAgee(ecritures, "411", { axe: axe || undefined }, aujourdhui(), lettres["411"], echeances),
    [ecritures, axe, lettres, echeances],
  );

  const taches = useMemo(
    () =>
      listeATraiter({
        suggerees,
        releves: relevesParCompte,
        ecritures,
        lettres,
        tvaDeclarees: r.tvaDeclarees || {},
        aujourdhui: aujourdhui(),
        clientsEnRetard: clientsAges
          .filter((c) => c.j60 + c.j90 + c.plus > 0)
          .map((c) => ({ tiers: c.tiers, montant: c.j60 + c.j90 + c.plus })),
      }),
    [suggerees, relevesParCompte, ecritures, lettres, r.tvaDeclarees, clientsAges],
  );

  const controle = useMemo(() => D.controle(ecritures), [ecritures]);
  const lesAxes = useMemo(() => D.axes(ecritures), [ecritures]);

  const badges = {
    reprises: suggerees.length,
    banque: Object.values(relevesParCompte).reduce((s, x) => s + x.lignes.filter((l) => !l.ecriture).length, 0),
  };

  // ---- Actions ------------------------------------------------------------

  const auteur = session.user?.name || session.user?.email || "";

  const tache = async (fn, titreErreur = "Enregistrement impossible") => {
    setOccupe(true);
    try {
      return await fn();
    } catch (e) {
      modal.alert({ title: titreErreur, message: e.message, tone: "error" });
      return null;
    } finally {
      setOccupe(false);
    }
  };

  /// Numérote une écriture dans son journal. `deja` : les écritures créées
  /// dans la même série, pas encore rechargées — sans elles, deux pièces
  /// validées d'un coup prendraient le même numéro.
  const numeroter = (e, deja = []) => {
    if (e.numero) return e;
    const journal = e.journal || journalDe(e);
    return { ...e, journal, numero: prochainNumero([...ecritures, ...deja], journal, e.date) };
  };

  const creer = async (ecriture, { recharger = true } = {}) => {
    const soucis = D.problemes(ecriture, { clotureAu });
    if (soucis.length) {
      await modal.alert({ title: "Cette écriture ne peut pas être enregistrée", message: soucis.join("\n"), tone: "error" });
      return null;
    }
    return tache(async () => {
      const rec = await api.records.create(manifest.slug, "ecritures", numeroter(ecriture));
      if (recharger) await etat.rafraichir();
      return rec;
    });
  };

  const accepterListe = async (liste, { confirmer = true } = {}) => {
    if (!liste.length) return;
    const fermees = liste.filter((p) => D.estClos(p.date, clotureAu));
    const ok = !confirmer || (await modal.confirm({
      title: `Comptabiliser ${liste.length} opération(s) ?`,
      message: "Chaque pièce produira son écriture, numérotée dans son journal.",
      detail: fermees.length
        ? `${fermees.length} pièce(s) tombent dans une période verrouillée : elles resteront en attente.`
        : "Aucune pièce ne sera comptabilisée deux fois : chacune garde la trace de son origine.",
      confirmLabel: "Comptabiliser",
    }));
    if (!ok) return;
    await tache(async () => {
      const faites = [];
      for (const p of liste) {
        if (D.estClos(p.date, clotureAu) || D.problemes(p).length) continue;
        const e = numeroter(p, faites);
        await api.records.create(manifest.slug, "ecritures", e);
        faites.push(e);
      }
      await etat.rafraichir();
      if (faites.length < liste.length) {
        modal.alert({
          title: `${faites.length} sur ${liste.length} comptabilisée(s)`,
          message: "Les autres sont dans une période verrouillée ou incomplètes : elles restent dans « À traiter ».",
          tone: "warning",
        });
      }
    }, "Enregistrement interrompu");
  };

  /// Une écriture enregistrée ne se modifie pas : elle se contre-passe.
  /// C'est la règle comptable, et ce qui rend le journal opposable.
  const contrepasser = async (ecriture) => {
    const ok = await modal.confirm({
      title: "Contre-passer cette écriture ?",
      message: `« ${ecriture.data.libelle} »`,
      detail:
        "Une écriture inverse sera ajoutée à la date du jour, dans le même journal. L'originale reste : c'est ce qui rend la comptabilité vérifiable.",
      confirmLabel: "Contre-passer",
      danger: true,
    });
    if (!ok) return;
    await creer({
      journal: journalDe(ecriture),
      date: aujourdhui(),
      libelle: `Extourne — ${ecriture.data.libelle}`,
      piece: ecriture.data.numero || ecriture.data.piece || "",
      tiers: ecriture.data.tiers || "",
      contrepasse: ecriture.id,
      lignes: ecriture.data.lignes.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
    });
  };

  /// Le justificatif est une métadonnée de la pièce : l'ajouter ne touche
  /// à aucun montant, il n'y a donc pas lieu de contre-passer.
  const joindre = (ecriture, node) =>
    tache(async () => {
      await api.records.update(manifest.slug, "ecritures", ecriture.id, {
        ...ecriture.data,
        justificatif: { id: node.id, name: node.name, mimeType: node.mimeType || "" },
      });
      await etat.rafraichir();
    });

  const majReglages = (patch) =>
    tache(async () => {
      const data = { ...(reglages?.data || {}), ...patch };
      if (reglages) await api.records.update(manifest.slug, "reglages", reglages.id, data);
      else await api.records.create(manifest.slug, "reglages", data);
      await etat.rafraichir();
      return true;
    });

  const verrouiller = async (au) => {
    const fait = await majReglages({
      clotureAu: au,
      historique: [...(r.historique || []), { au, le: aujourdhui(), par: auteur }],
    });
    if (fait) {
      notifier({
        titre: `${nomMois(au.slice(0, 7))} verrouillé`,
        message: "Toute correction passera désormais par une écriture d'extourne.",
        app: manifest.name,
        ton: "success",
      });
    }
  };

  const rouvrir = async (au) => {
    const ok = await modal.confirm({
      title: au ? `Rouvrir jusqu'au ${au} ?` : "Rouvrir toutes les périodes ?",
      message: "Les écritures pourront de nouveau être datées dans ces mois.",
      detail: "À réserver à la correction d'une clôture posée trop tôt : une déclaration déjà déposée ne correspondrait plus aux livres.",
      confirmLabel: "Rouvrir",
      danger: true,
    });
    if (!ok) return;
    await majReglages({
      clotureAu: au,
      historique: [...(r.historique || []), { au, le: aujourdhui(), par: auteur, reouverture: true }],
    });
  };

  const aller = (s, opts = null) => {
    setSection(s);
    setIntention(opts);
  };

  const valeur = {
    // Données
    ecritures,
    documents,
    suggerees,
    releves,
    relevesParCompte,
    lettrages,
    lettres,
    clientsCrm: donnees.clientsCrm,
    fournisseurs: achats.fournisseurs,
    reglages: r,
    clotureAu,
    entreprise: entreprise || {},
    taches,
    clientsAges,
    echeances,
    controle,
    // Contexte
    periode,
    setPeriode,
    contexte,
    axe,
    occupe,
    intention,
    session,
    auteur,
    peutAdministrer: ["OWNER", "ADMIN"].includes(session.user?.role),
    // Actions
    aller,
    rafraichir: etat.rafraichir,
    tache,
    creer,
    accepterListe,
    contrepasser,
    joindre,
    majReglages,
    verrouiller,
    rouvrir,
    numeroter,
  };

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="cptApp">
        <div className="cptVerrou">Connectez-vous pour tenir votre comptabilité.</div>
      </ModuleWindow>
    );
  }

  const Vue = VUES[section] || Pilotage;

  return (
    <ModuleWindow manifest={manifest} className="cptApp">
      <Cpt.Provider value={valeur}>
        <div className="cptShell">
          <aside className="cptNav cosScroll" aria-label="Sections de la comptabilité">
            <div className="cptMarque">
              <b>Comptabilité</b>
              <span>{entreprise?.nom ? `${entreprise.nom} · ` : ""}SYSCOHADA</span>
            </div>
            <nav>
              {NAV.map((n) =>
                n.groupe ? (
                  <div key={n.groupe} className="cptNavGroupe">{n.groupe}</div>
                ) : (
                  <button
                    key={n.id}
                    type="button"
                    className="cptNavItem"
                    aria-current={section === n.id ? "page" : undefined}
                    onClick={() => aller(n.id)}
                  >
                    <Icon fafa={n.icone} width={13} />
                    <span>{n.label}</span>
                    {n.badge && badges[n.badge] ? <em className="cptPastille">{badges[n.badge]}</em> : null}
                  </button>
                ),
              )}
            </nav>
            <div className="cptObservation">
              <label>
                <span>Période observée</span>
                <ChoixPeriode valeur={periode} onChanger={setPeriode} />
              </label>
              {lesAxes.length ? (
                <label>
                  <span>Axe analytique</span>
                  <select value={axe} onChange={(e) => setAxe(e.target.value)}>
                    <option value="">Toute l'entreprise</option>
                    {lesAxes.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {!controle.equilibre ? (
                <span className="cptAlerte" title="Le total des débits doit égaler celui des crédits">
                  <Icon fafa="faTriangleExclamation" width={12} />
                  Journal déséquilibré de {D.fcfa(Math.abs(controle.ecart))}
                </span>
              ) : null}
              <button type="button" className="cptLienDiscret" disabled={occupe} onClick={() => etat.rafraichir()}>
                <Icon fafa="faArrowsRotate" width={11} />
                Actualiser les pièces des autres apps
              </button>
            </div>
          </aside>

          <main className="cptPage cosScroll">
            <Contenu etat={etat} vide={false} lignes={8}>
              <Vue key={section} />
            </Contenu>
          </main>
        </div>
      </Cpt.Provider>
    </ModuleWindow>
  );
}

const ChoixPeriode = ({ valeur, onChanger }) => {
  const annee = new Date().getFullYear();
  const options = [
    { ...D.exercice(annee), label: `Exercice ${annee}` },
    { ...D.exercice(annee - 1), label: `Exercice ${annee - 1}` },
    ...Array.from({ length: 12 }, (_, i) => {
      const m = `${annee}-${String(i + 1).padStart(2, "0")}`;
      return { ...D.mois(m), label: nomMois(m) };
    }),
  ];
  const cle = `${valeur.du}|${valeur.au}`;
  return (
    <select
      value={cle}
      onChange={(e) => {
        const [du, au] = e.target.value.split("|");
        onChanger({ du, au });
      }}
    >
      {options.some((o) => `${o.du}|${o.au}` === cle) ? null : <option value={cle}>{`${valeur.du} → ${valeur.au}`}</option>}
      {options.map((o) => (
        <option key={`${o.du}|${o.au}`} value={`${o.du}|${o.au}`}>{o.label}</option>
      ))}
    </select>
  );
};
