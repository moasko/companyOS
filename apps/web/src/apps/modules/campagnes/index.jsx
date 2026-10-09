// Campagnes.
//
// ─────────────────────────────────────────────────────────────────────────
// L'EMAIL MARKETING DE L'ENTREPRISE, BRANCHÉ SUR TOUT COMPANYOS
//
// La puissance des grands outils d'emailing, ramenée à ce qu'une PME en
// fait vraiment :
//
//   • des **campagnes** écrites par blocs (titre, texte, image du Cloud,
//     bouton, produits du Stock, colonnes, code promo, réseaux…), avec un
//     test A/B de l'objet, chaque lien suivi, un rapport qui dit ce qui a
//     été vendu ;
//   • des **automatisations** qui écoutent les autres apps : bienvenue au
//     nouveau contact du CRM, relance du devis non signé, merci après
//     achat, avis après livraison, client endormi, anniversaire ;
//   • des **contacts** qui restent ceux du CRM : import CSV, étiquettes,
//     consentement daté, engagement, formulaire d'inscription public
//     (double opt-in), rebonds suspendus.
//
// Le serveur (apps/api/src/campagnes.js) envoie par petits lots, tranche
// les tests A/B, fait tourner les automatisations et revalide chaque
// destinataire contre le CRM. Les règles vivent dans
// @companyos/shared/campagnes, partagées avec lui.
//
// La langue de l'écran suit celle du système (français ou anglais).
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
import { useLangue, useTraduction } from "../../../utils/intl";
import { LANGUES } from "../../../utils/langue";
import * as D from "@companyos/shared/campagnes";
import { TEXTES } from "./textes";
import { Ctx } from "./commun";
import { Accueil } from "./vues/Accueil";
import { Campagnes } from "./vues/Campagnes";
import { Editeur } from "./vues/Editeur";
import { Rapport } from "./vues/Rapport";
import { Automatisations, Automatisation } from "./vues/Automatisations";
import { Modeles } from "./vues/Modeles";
import { Contacts } from "./vues/Contacts";
import { Formulaire } from "./vues/Formulaire";
import "./campagnes.scss";

export const manifest = {
  id: "campagnes",
  slug: "campagnes",
  name: "Campagnes",
  icon: "campagnes",
  action: "CAMPAGNESAPP",
  version: "2.0.0",
  nouveautes: [
    { version: "2.0.0", texte: "Éditeur par blocs, test A/B de l'objet, suivi de chaque lien, ventes attribuées, automatisations (bienvenue, devis non signé, après achat, livraison, client endormi, anniversaire), import CSV vers le CRM, formulaire d'inscription avec double opt-in, rebonds, français et anglais." },
  ],
  Window: CampagnesApp,
};

const NAV = [
  { id: "accueil", label: "navAccueil", icone: "faHouse" },
  { groupe: "grpEnvoyer" },
  { id: "campagnes", label: "navCampagnes", icone: "faPaperPlane", badge: "campagnes" },
  { id: "automatisations", label: "navAutomatisations", icone: "faBolt" },
  { id: "modeles", label: "navModeles", icone: "faTableCellsLarge" },
  { groupe: "grpAudience" },
  { id: "contacts", label: "navContacts", icone: "faAddressBook", badge: "contacts" },
  { id: "formulaire", label: "navFormulaire", icone: "faFileSignature" },
];

const VUES = {
  accueil: Accueil,
  campagnes: Campagnes,
  editeur: Editeur,
  rapport: Rapport,
  automatisations: Automatisations,
  automatisation: Automatisation,
  modeles: Modeles,
  contacts: Contacts,
  formulaire: Formulaire,
};

const VIDE = { campagnes: [], automatisations: [], modeles: [], anciensModeles: [], clients: [], factures: [], articles: [], membres: [] };

function CampagnesApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  // Les campagnes partent au nom de l'entreprise : le serveur réserve
  // leur écriture aux administrateurs.
  const peutEcrire = ["OWNER", "ADMIN"].includes(session.user?.role);
  const t = useTraduction(TEXTES);
  const langue = useLangue();
  const loc = langue === "en" ? "en-US" : "fr-FR";

  const [section, setSection] = useState("accueil");
  const [intention, setIntention] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [d, setD] = useState(VIDE);
  const { entreprise } = useEntreprise(ouvert);

  const charger = useCallback(async () => {
    const liste = (m, c) => api.records.list(m, c).catch(() => []);
    const [campagnes, automatisations, modeles, anciensModeles, clients, factures, articles, membres] = await Promise.all([
      api.records.list(manifest.slug, "campagnes"),
      liste(manifest.slug, "automatisations"),
      liste(manifest.slug, "modeles"),
      // Les modèles de l'app Courrier (objet + texte) restent proposés.
      liste("courrier", "modeles"),
      liste("crm", "clients"),
      liste("facturation", "factures"),
      liste("stock", "articles"),
      api.members().catch(() => []),
    ]);
    campagnes.sort((a, b) => (b.data.creeLe || "").localeCompare(a.data.creeLe || ""));
    setD({ campagnes, automatisations, modeles, anciensModeles, clients, factures, articles, membres });
  }, []);
  const etat = useChargement(ouvert, charger);

  // Un envoi en cours : la page se rafraîchit toute seule.
  useEffect(() => {
    if (!ouvert) return undefined;
    if (!d.campagnes.some((c) => ["envoi", "programmee"].includes(c.data.statut))) return undefined;
    const minuteur = setInterval(() => etat.rafraichir(), 8000);
    return () => clearInterval(minuteur);
  }, [ouvert, d.campagnes]); // eslint-disable-line react-hooks/exhaustive-deps

  const contexte = useMemo(() => D.contexteAudience({ factures: d.factures, campagnes: d.campagnes }), [d.factures, d.campagnes]);
  const engagement = useMemo(() => D.engagementDe(d.campagnes), [d.campagnes]);
  const sante = useMemo(() => D.santeDe(d.clients), [d.clients]);
  const nomEntreprise = entreprise?.nom || session.tenant?.name || t("votreEntreprise");

  // ---- Formats ------------------------------------------------------------

  const nf = useMemo(() => new Intl.NumberFormat(loc), [loc]);
  const n = useCallback((x) => nf.format(Number(x) || 0), [nf]);
  const pct = useCallback((x) => (x === null || x === undefined ? "—" : `${new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }).format(x)} %`), [loc]);
  const argent = useCallback((x) => `${new Intl.NumberFormat(loc).format(Math.round(Number(x) || 0))} F`, [loc]);
  const dateCourte = useCallback((iso) => (iso ? new Date(iso).toLocaleDateString(loc, { day: "numeric", month: "short" }) : ""), [loc]);
  const dateHeure = useCallback((iso) => (iso ? new Date(iso).toLocaleString(loc, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : ""), [loc]);
  const heure = useCallback((iso) => (iso ? new Date(iso).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }) : ""), [loc]);

  // ---- Actions ------------------------------------------------------------

  const tache = async (fn, titreErreur) => {
    setOccupe(true);
    try {
      return await fn();
    } catch (e) {
      modal.alert({ title: titreErreur || t("erreur"), message: e.message, tone: "error" });
      return null;
    } finally {
      setOccupe(false);
    }
  };

  const aller = (s, opts = null) => {
    setSection(s);
    setIntention(opts);
  };

  const ecrireCampagne = (id, donnees) =>
    id ? api.records.update(manifest.slug, "campagnes", id, donnees) : api.records.create(manifest.slug, "campagnes", donnees);

  const enregistrerBrouillon = (id, campagne) =>
    tache(async () => {
      const f = await ecrireCampagne(id, { ...campagne, statut: "brouillon", creeLe: campagne.creeLe || new Date().toISOString() });
      await etat.rafraichir();
      notifier({ titre: t("brouillonEnregistre"), message: campagne.nom || "", app: manifest.name, ton: "success" });
      return f;
    }, t("enregistrementImpossible"));

  const lancer = async (id, campagne, retenus, envoyerLe) => {
    const nb = retenus.length;
    const ok = await modal.confirm({
      title: envoyerLe ? t("programmerTitre") : t("lancerTitre"),
      message: t("lancerMessage", { nom: campagne.nom, n: n(nb) }),
      detail: [
        envoyerLe ? t("lancerDepart", { quand: dateHeure(envoyerLe) }) : t("lancerMaintenant"),
        campagne.ab?.actif ? t("lancerAB", { part: campagne.ab.part, heures: campagne.ab.heures }) : "",
      ].filter(Boolean).join(" "),
      confirmLabel: envoyerLe ? t("programmer") : t("lancer"),
    });
    if (!ok) return;
    const f = await tache(async () => {
      const destinataires = D.repartirAB(retenus.map(D.destinataireDe), campagne.ab);
      const r = await ecrireCampagne(id, {
        ...campagne,
        statut: "programmee",
        envoyerLe: envoyerLe || "",
        ab: campagne.ab?.actif ? { ...campagne.ab, gagnant: "" } : { ...D.CAMPAGNE_VIDE.ab },
        destinataires,
        creeLe: campagne.creeLe || new Date().toISOString(),
      });
      await etat.rafraichir();
      return r;
    }, t("lancementImpossible"));
    if (!f) return;
    notifier({ titre: envoyerLe ? t("campagneProgrammee") : t("campagneLancee"), message: t("nDestinataires", { n: n(nb) }), app: manifest.name, ton: "success" });
    aller("rapport", { id: f.id });
  };

  const supprimerCampagne = async (fiche) => {
    const enCours = fiche.data.statut === "envoi";
    const ok = await modal.confirm({
      title: enCours ? t("arreterTitre") : t("supprimerCampagneTitre"),
      message: enCours ? t("arreterMessage", { nom: fiche.data.nom }) : t("supprimerCampagneMessage", { nom: fiche.data.nom }),
      confirmLabel: t("supprimer"),
      danger: true,
    });
    if (!ok) return;
    await tache(async () => {
      await api.records.remove(manifest.slug, "campagnes", fiche.id);
      await etat.rafraichir();
    });
    aller("campagnes");
  };

  const annulerProgrammation = async (fiche) => {
    const ok = await modal.confirm({ title: t("annulerProgTitre"), message: t("annulerProgMessage", { nom: fiche.data.nom }), confirmLabel: t("annulerProg") });
    if (!ok) return;
    const r = await tache(async () => {
      await api.records.update(manifest.slug, "campagnes", fiche.id, { ...fiche.data, statut: "brouillon", envoyerLe: "", destinataires: [] });
      await etat.rafraichir();
      return true;
    });
    if (r) aller("editeur", { id: fiche.id });
  };

  const pause = (fiche) => tache(async () => { await api.campagnesPause(fiche.id); await etat.rafraichir(); });
  const reprendre = (fiche) => tache(async () => { await api.campagnesReprendre(fiche.id); await etat.rafraichir(); });

  const reessayer = (fiche) =>
    tache(async () => {
      await api.records.update(manifest.slug, "campagnes", fiche.id, D.reessayerEchecs(fiche.data));
      await etat.rafraichir();
      notifier({ titre: t("nouvelEssai"), message: t("nouvelEssaiMessage"), app: manifest.name, ton: "success" });
    });

  /// Le message tel qu'un destinataire le recevra, dans les boîtes de
  /// l'équipe — le serveur refuse toute autre adresse.
  const tester = (message, adresses, exemple) =>
    tache(async () => {
      const r = await api.campagnesTester(message, adresses, exemple ? D.destinataireDe(exemple) : null);
      notifier({ titre: t("testEnvoye"), message: adresses.join(", "), app: manifest.name, ton: "success" });
      if (r.refusees) modal.alert({ title: t("testPartiel"), message: t("testPartielMessage", { n: r.refusees }), tone: "info" });
      return true;
    }, t("testImpossible"));

  const enregistrerModele = async (message) => {
    const nom = await modal.prompt({ title: t("enregistrerModele"), label: t("nomModele"), value: message.nom || "", confirmLabel: t("enregistrer") });
    if (!nom) return;
    await tache(async () => {
      await api.records.create(manifest.slug, "modeles", { nom, sujet: message.sujet || "", apercu: message.apercu || "", couleur: message.couleur, langue: message.langue || langue, blocs: message.blocs || [] });
      await etat.rafraichir();
      notifier({ titre: t("modeleEnregistre"), message: nom, app: manifest.name, ton: "success" });
    });
  };

  const enregistrerAuto = (id, donnees) =>
    tache(async () => {
      // Le moteur écrit les inscrits pendant qu'on édite : on repart de la
      // fiche fraîche et on n'y change que le réglage et le message.
      const frais = id ? (await api.records.list(manifest.slug, "automatisations")).find((x) => x.id === id) : null;
      const { inscrits: _ignores, ...reglages } = donnees;
      const data = { ...(frais?.data || { inscrits: [] }), ...reglages };
      const r = id ? await api.records.update(manifest.slug, "automatisations", id, data) : await api.records.create(manifest.slug, "automatisations", data);
      await etat.rafraichir();
      return r;
    }, t("enregistrementImpossible"));

  const supprimerAuto = async (fiche) => {
    const ok = await modal.confirm({ title: t("supprimerAutoTitre"), message: t("supprimerAutoMessage", { nom: fiche.data.nom }), confirmLabel: t("supprimer"), danger: true });
    if (!ok) return false;
    await tache(async () => {
      await api.records.remove(manifest.slug, "automatisations", fiche.id);
      await etat.rafraichir();
    });
    aller("automatisations");
    return true;
  };

  const badges = {
    campagnes: d.campagnes.filter((c) => ["envoi", "programmee", "pause"].includes(c.data.statut)).length,
    contacts: sante.rebonds,
  };

  const valeur = {
    t,
    langue,
    n,
    pct,
    argent,
    dateCourte,
    dateHeure,
    heure,
    ...d,
    contexte,
    engagement,
    sante,
    entreprise,
    nomEntreprise,
    session,
    peutEcrire,
    occupe,
    intention,
    // Actions
    aller,
    tache,
    rafraichir: etat.rafraichir,
    enregistrerBrouillon,
    lancer,
    supprimerCampagne,
    annulerProgrammation,
    pause,
    reprendre,
    reessayer,
    tester,
    enregistrerModele,
    enregistrerAuto,
    supprimerAuto,
  };

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="cmpApp">
        <div className="cmpVerrou"><Icon fafa="faLock" width={20} />{t("verrou")}</div>
      </ModuleWindow>
    );
  }

  const Vue = VUES[section] || Accueil;
  const sectionNav = { editeur: "campagnes", rapport: "campagnes", automatisation: "automatisations" }[section] || section;

  return (
    <ModuleWindow manifest={manifest} className="cmpApp">
      <Ctx.Provider value={valeur}>
        <div className="cmpShell" lang={langue}>
          <aside className="cmpNav cosScroll" aria-label={t("appNom")}>
            <div className="cmpMarque">
              <b>{t("appNom")}</b>
              <span>{t("joignablesN", { n: n(sante.joignables) })}</span>
            </div>
            <nav>
              {NAV.map((x) =>
                x.groupe ? (
                  <div key={x.groupe} className="cmpNavGroupe">{t(x.groupe)}</div>
                ) : (
                  <button key={x.id} type="button" className="cmpNavItem" aria-current={sectionNav === x.id ? "page" : undefined} onClick={() => aller(x.id)}>
                    <Icon fafa={x.icone} width={13} />
                    <span>{t(x.label)}</span>
                    {x.badge && badges[x.badge] ? <em className="cmpPastille" data-ton={x.badge === "contacts" ? "rouge" : ""}>{badges[x.badge]}</em> : null}
                  </button>
                ),
              )}
            </nav>
            <div className="cmpLangue">
              <span>{t("langueAuto")}</span>
              <b>{LANGUES.find((l) => l.code === langue)?.nom || langue}</b>
            </div>
          </aside>
          <main className="cmpPage cosScroll">
            <Contenu etat={etat} vide={false} lignes={8}>
              <Vue key={`${section}-${intention?.id || intention?.cle || ""}`} />
            </Contenu>
          </main>
        </div>
      </Ctx.Provider>
    </ModuleWindow>
  );
}
