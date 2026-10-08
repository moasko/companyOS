// Campagnes.
//
// ─────────────────────────────────────────────────────────────────────────
// L'EMAIL MARKETING DE L'ENTREPRISE
//
// Le geste des grands outils d'emailing ramené à ce qu'une PME en fait
// vraiment : choisir un public dans son CRM, écrire une fois, envoyer
// proprement, comprendre ce qui a marché. Trois écrans :
//
//   • le tableau de bord — chiffres d'ensemble, santé du fichier clients,
//     campagnes par statut, et ce qui demande une action ;
//   • l'éditeur en trois étapes — Audience (segment du CRM, enrichi par
//     la Facturation et l'historique des envois), Message (aperçu en
//     direct, ordinateur ou mobile), Envoi (créneaux, test, lancement) ;
//   • le rapport — entonnoir, ouvertures heure par heure, destinataires
//     filtrables, relance des non-ouvreurs, export.
//
// Le serveur égrène l'envoi par petits lots (apps/api/src/campagnes.js)
// et revalide chaque destinataire contre le CRM ; les règles vivent dans
// @companyos/shared/campagnes, partagées avec lui.
//
// Chaque message porte son lien de désinscription. Un désinscrit est
// marqué dans le CRM et ne reverra jamais une campagne.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { notifier, suivreLien } from "../../notifications";
import { ouvrirFenetre } from "../../windows";
import { Contenu, useChargement } from "../../chargement";
import { useEntreprise } from "../../entreprise";
import { adresseValide, appliquerModele } from "@companyos/shared/courrier";
import * as D from "@companyos/shared/campagnes";
import "./campagnes.scss";

export const manifest = {
  id: "campagnes",
  slug: "campagnes",
  name: "Campagnes",
  icon: "campagnes",
  action: "CAMPAGNESAPP",
  Window: CampagnesApp,
};

const COULEURS = ["#c2410c", "#1d4ed8", "#047857", "#7c3aed", "#be123c", "#18181b"];
const ETAPES = [
  { id: "audience", label: "Audience" },
  { id: "message", label: "Message" },
  { id: "envoi", label: "Envoi" },
];

const nombre = (n) => new Intl.NumberFormat("fr-FR").format(n || 0);
const pourcent = (n) => (n === null || n === undefined ? "—" : `${String(n).replace(".", ",")} %`);
const dateCourte = (iso) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
const dateHeure = (iso) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");
const initiales = (nom = "") =>
  nom.split(/\s+/).filter((m) => /^[A-Za-zÀ-ÿ]/.test(m)).slice(0, 2).map((m) => m[0]).join("").toUpperCase() || "?";

/// Valeur d'un `<input type="datetime-local">` pour une date locale.
const versLocal = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/// Créneaux rapides : les moments où les mails professionnels sont lus.
const creneaux = (maintenant = new Date()) => {
  const a = (jours, h, m = 0) => {
    const d = new Date(maintenant);
    d.setDate(d.getDate() + jours);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const prochain = (jourSemaine, h, m = 0) => {
    const ecart = ((jourSemaine - maintenant.getDay() + 7) % 7) || 7;
    return a(ecart, h, m);
  };
  return [
    { label: "Demain 8:00", date: a(1, 8) },
    { label: "Lundi 9:00", date: prochain(1, 9) },
    { label: "Mardi 8:30", date: prochain(2, 8, 30) },
  ];
};

const telecharger = (contenu, nom, type) => {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nom });
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
};

// ---------------------------------------------------------------------------
// L'application
// ---------------------------------------------------------------------------

function CampagnesApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  // Les campagnes partent au nom de l'entreprise : le serveur réserve
  // leur écriture aux administrateurs.
  const peutEcrire = ["OWNER", "ADMIN"].includes(session.user?.role);

  const [campagnes, setCampagnes] = useState([]);
  const [clients, setClients] = useState([]);
  const [modeles, setModeles] = useState([]);
  const [factures, setFactures] = useState([]);
  const [vue, setVue] = useState({ mode: "liste" }); // liste | edition {id?, initial?} | rapport {id}
  const [occupe, setOccupe] = useState(false);
  const { entreprise } = useEntreprise(ouvert);

  const charger = useCallback(async () => {
    const [camp, cli, mod, fac] = await Promise.all([
      api.records.list(manifest.slug, "campagnes"),
      api.records.list("crm", "clients").catch(() => []),
      api.records.list("courrier", "modeles").catch(() => []),
      api.records.list("facturation", "factures").catch(() => []),
    ]);
    setCampagnes(camp.sort((a, b) => (b.data.creeLe || "").localeCompare(a.data.creeLe || "")));
    setClients(cli);
    setModeles(mod);
    setFactures(fac);
  }, []);
  const etat = useChargement(ouvert, charger);

  // Une campagne en cours d'envoi : la page se rafraîchit toute seule.
  useEffect(() => {
    if (!ouvert) return undefined;
    if (!campagnes.some((c) => ["envoi", "programmee"].includes(c.data.statut))) return undefined;
    const minuteur = setInterval(() => etat.rafraichir(), 8000);
    return () => clearInterval(minuteur);
  }, [ouvert, campagnes]);

  const contexte = useMemo(() => D.contexteAudience({ factures, campagnes }), [factures, campagnes]);
  const nomEntreprise = entreprise?.nom || session.tenant?.name || "Votre entreprise";

  // ---- Actions ------------------------------------------------------------

  const ecrire = async (fiche, donnees) =>
    fiche
      ? api.records.update(manifest.slug, "campagnes", fiche.id, donnees)
      : api.records.create(manifest.slug, "campagnes", donnees);

  const lancer = async (fiche, campagne, retenus, envoyerLe) => {
    const n = retenus.length;
    const ok = await modal.confirm({
      title: envoyerLe ? "Programmer la campagne ?" : "Lancer la campagne ?",
      message: `« ${campagne.nom} » partira vers ${nombre(n)} destinataire${n > 1 ? "s" : ""}.`,
      detail: envoyerLe
        ? `Départ ${dateHeure(envoyerLe)}, ${D.libelleDuree(n)} d'envoi par petits lots. Annulable jusqu'au départ.`
        : `Départ dans la minute, ${D.libelleDuree(n)} d'envoi par petits lots — pour rester hors des spams.`,
      confirmLabel: envoyerLe ? "Programmer" : "Lancer l'envoi",
    });
    if (!ok) return;
    setOccupe(true);
    try {
      const enregistree = await ecrire(fiche, {
        ...campagne,
        statut: "programmee",
        envoyerLe: envoyerLe || "",
        destinataires: retenus.map(D.destinataireDe),
        creeLe: campagne.creeLe || new Date().toISOString(),
      });
      await etat.rafraichir();
      setVue({ mode: "rapport", id: enregistree.id });
      notifier({
        titre: envoyerLe ? "Campagne programmée" : "Campagne lancée",
        message: `${nombre(n)} destinataire(s).`,
        app: "Campagnes",
        ton: "success",
      });
    } catch (e) {
      modal.alert({ title: "Lancement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const enregistrerBrouillon = async (fiche, campagne, { rester = false } = {}) => {
    setOccupe(true);
    try {
      const enregistree = await ecrire(fiche, {
        ...campagne,
        statut: "brouillon",
        creeLe: campagne.creeLe || new Date().toISOString(),
      });
      await etat.rafraichir();
      if (rester) setVue({ mode: "edition", id: enregistree.id });
      else setVue({ mode: "liste" });
      notifier({ titre: "Brouillon enregistré", message: campagne.nom || "", app: "Campagnes", ton: "success" });
      return enregistree;
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
      return null;
    } finally {
      setOccupe(false);
    }
  };

  const supprimer = async (fiche) => {
    const enCours = fiche.data.statut === "envoi";
    const ok = await modal.confirm({
      title: enCours ? "Arrêter et supprimer ?" : "Supprimer cette campagne ?",
      message: enCours
        ? `« ${fiche.data.nom} » est en cours d'envoi : les messages restants ne partiront pas.`
        : `« ${fiche.data.nom} » et ses résultats seront retirés.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.records.remove(manifest.slug, "campagnes", fiche.id);
    setVue({ mode: "liste" });
    await etat.rafraichir();
  };

  /// Une programmation annulée redevient un brouillon modifiable.
  const annulerProgrammation = async (fiche) => {
    const ok = await modal.confirm({
      title: "Annuler la programmation ?",
      message: `« ${fiche.data.nom} » redevient un brouillon : rien ne partira.`,
      confirmLabel: "Annuler la programmation",
    });
    if (!ok) return;
    try {
      await api.records.update(manifest.slug, "campagnes", fiche.id, {
        ...fiche.data,
        statut: "brouillon",
        envoyerLe: "",
        destinataires: [],
      });
      await etat.rafraichir();
      setVue({ mode: "edition", id: fiche.id });
    } catch (e) {
      modal.alert({ title: "Annulation impossible", message: e.message, tone: "error" });
    }
  };

  const reessayer = async (fiche) => {
    try {
      await api.records.update(manifest.slug, "campagnes", fiche.id, D.reessayerEchecs(fiche.data));
      await etat.rafraichir();
      notifier({ titre: "Nouvel essai programmé", message: "Les échecs repartent au prochain passage.", app: "Campagnes", ton: "success" });
    } catch (e) {
      modal.alert({ title: "Nouvel essai impossible", message: e.message, tone: "error" });
    }
  };

  /// Le message tel qu'un destinataire le recevra — dans les boîtes de
  /// l'équipe, jamais chez un client.
  const tester = async (campagne, adresses, exemple) => {
    const variables = exemple
      ? D.variablesPour(D.destinataireDe(exemple), nomEntreprise)
      : { client: "Exemple Client", contact: "Exemple Client", ville: "Abidjan", entreprise: nomEntreprise };
    setOccupe(true);
    try {
      for (const a of adresses) {
        await api.courrierEnvoyer({
          a,
          sujet: `[TEST] ${appliquerModele(campagne.sujet, variables)}`,
          texte: appliquerModele(campagne.texte, variables),
        });
      }
      notifier({ titre: "Test envoyé", message: adresses.join(", "), app: "Campagnes", ton: "success" });
      return true;
    } catch (e) {
      modal.alert({ title: "Test impossible", message: e.message, tone: "error" });
      return false;
    } finally {
      setOccupe(false);
    }
  };

  const enregistrerModele = async (campagne) => {
    const nom = await modal.prompt({
      title: "Enregistrer comme modèle",
      label: "Nom du modèle",
      value: campagne.nom || "",
      confirmLabel: "Enregistrer",
    });
    if (!nom) return;
    try {
      await api.records.create("courrier", "modeles", { nom, sujet: campagne.sujet, texte: campagne.texte });
      setModeles(await api.records.list("courrier", "modeles").catch(() => modeles));
      notifier({ titre: "Modèle enregistré", message: nom, app: "Campagnes", ton: "success" });
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    }
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="cmpApp">
        <div className="cmpVerrou">Connectez-vous pour lancer des campagnes.</div>
      </ModuleWindow>
    );
  }

  const fiche = vue.id ? campagnes.find((c) => c.id === vue.id) : null;

  return (
    <ModuleWindow manifest={manifest} className="cmpApp">
      <div className="cmpShell">
        {vue.mode === "edition" ? (
          <Editeur
            key={vue.id || vue.cle || "nouvelle"}
            fiche={fiche}
            initial={vue.initial}
            clients={clients}
            contexte={contexte}
            modeles={modeles}
            entreprise={entreprise}
            nomEntreprise={nomEntreprise}
            occupe={occupe}
            peutEcrire={peutEcrire}
            emailSession={session.user?.email || ""}
            onRetour={() => setVue({ mode: "liste" })}
            onBrouillon={(c, opts) => enregistrerBrouillon(fiche, c, opts)}
            onTester={tester}
            onLancer={(c, retenus, quand) => lancer(fiche, c, retenus, quand)}
            onModele={enregistrerModele}
            onSupprimer={fiche ? () => supprimer(fiche) : null}
          />
        ) : vue.mode === "rapport" && fiche ? (
          <Rapport
            fiche={fiche}
            peutEcrire={peutEcrire}
            onRetour={() => setVue({ mode: "liste" })}
            onSupprimer={() => supprimer(fiche)}
            onDupliquer={() => setVue({ mode: "edition", initial: D.dupliquer(fiche.data), cle: Date.now() })}
            onRelancer={() => setVue({ mode: "edition", initial: D.relanceDe(fiche.data), cle: Date.now() })}
            onReessayer={() => reessayer(fiche)}
            onAnnuler={() => annulerProgrammation(fiche)}
          />
        ) : (
          <TableauDeBord
            etat={etat}
            campagnes={campagnes}
            clients={clients}
            peutEcrire={peutEcrire}
            onNouvelle={() => setVue({ mode: "edition", cle: Date.now() })}
            onOuvrir={(c) => setVue(c.data.statut === "brouillon" ? { mode: "edition", id: c.id } : { mode: "rapport", id: c.id })}
            onDupliquer={(c) => setVue({ mode: "edition", initial: D.dupliquer(c.data), cle: Date.now() })}
            onRelancer={(c) => setVue({ mode: "edition", initial: D.relanceDe(c.data), cle: Date.now() })}
            onAnnuler={annulerProgrammation}
            onSupprimer={supprimer}
          />
        )}
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Petits composants
// ---------------------------------------------------------------------------

const Statut = ({ statut }) => {
  const s = D.STATUTS_CAMPAGNE[statut] || D.STATUTS_CAMPAGNE.brouillon;
  return <span className="cmpStatut" data-ton={s.ton}>{s.label}</span>;
};

const Onglets = ({ options, valeur, onChoisir, label }) => (
  <div className="cmpOnglets" role="tablist" aria-label={label}>
    {options.map((o) => (
      <button key={o.id} type="button" role="tab" aria-selected={valeur === o.id} onClick={() => onChoisir(o.id)}>
        {o.label}
        {o.nb !== undefined ? <span>{nombre(o.nb)}</span> : null}
      </button>
    ))}
  </div>
);

const Recherche = ({ valeur, onChanger, placeholder, label }) => (
  <label className="cmpRecherche">
    <Icon fafa="faMagnifyingGlass" width={12} />
    <input aria-label={label || placeholder} value={valeur} placeholder={placeholder} onChange={(e) => onChanger(e.target.value)} />
  </label>
);

/// Un menu d'actions qui se ferme au clic extérieur et à Échap.
const MenuActions = ({ actions, label }) => {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!ouvert) return undefined;
    const fermer = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !ref.current?.contains(e.target)) setOuvert(false);
    };
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", fermer);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", fermer);
    };
  }, [ouvert]);
  const visibles = actions.filter(Boolean);
  if (!visibles.length) return <span />;
  return (
    <span className="cmpMenuZone" ref={ref}>
      <button
        type="button"
        className="cmpIcone"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        onClick={(e) => { e.stopPropagation(); setOuvert(!ouvert); }}
      >
        <Icon fafa="faEllipsisVertical" width={12} />
      </button>
      {ouvert ? (
        <span className="cmpMenu" role="menu">
          {visibles.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              data-danger={a.danger || undefined}
              onClick={(e) => { e.stopPropagation(); setOuvert(false); a.faire(); }}
            >
              <Icon fafa={a.icone} width={12} />
              {a.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Le tableau de bord
// ---------------------------------------------------------------------------

const TableauDeBord = ({ etat, campagnes, clients, peutEcrire, onNouvelle, onOuvrir, onDupliquer, onRelancer, onAnnuler, onSupprimer }) => {
  const [onglet, setOnglet] = useState("toutes");
  const [recherche, setRecherche] = useState("");
  const sante = useMemo(() => D.santeDe(clients), [clients]);
  const stats = useMemo(() => D.statistiquesGlobales(campagnes), [campagnes]);

  const compte = (s) => campagnes.filter((c) => c.data.statut === s).length;
  const onglets = [
    { id: "toutes", label: "Toutes", nb: campagnes.length },
    { id: "brouillon", label: "Brouillons", nb: compte("brouillon") },
    { id: "programmee", label: "Programmées", nb: compte("programmee") },
    { id: "envoi", label: "En cours", nb: compte("envoi") },
    { id: "terminee", label: "Terminées", nb: compte("terminee") },
  ];
  const q = recherche.trim().toLowerCase();
  const visibles = campagnes.filter((c) =>
    (onglet === "toutes" || c.data.statut === onglet) &&
    (!q || [c.data.nom, c.data.sujet].some((v) => String(v || "").toLowerCase().includes(q))));

  // Ce qui attend une décision : relancer les non-ouvreurs d'une campagne
  // récente (une seule fois), surveiller ce qui va partir.
  const relancees = new Set(campagnes.map((c) => c.data.relanceDe).filter(Boolean));
  const aFaire = [
    ...campagnes
      .filter((c) => c.data.statut === "terminee" && !relancees.has(c.data.nom))
      .map((c) => ({ c, n: D.resumeDe(c.data.destinataires).envoyes - D.resumeDe(c.data.destinataires).ouverts }))
      .filter((x) => x.n >= 1)
      .slice(0, 2)
      .map(({ c, n }) => ({
        id: `r${c.id}`,
        icone: "faRotateRight",
        ton: "accent",
        titre: "Relancer les non-ouvreurs",
        texte: `« ${c.data.nom} » : ${nombre(n)} personne${n > 1 ? "s" : ""} n'ont pas ouvert. Même message, nouvel objet.`,
        action: peutEcrire ? { label: "Préparer la relance", faire: () => onRelancer(c) } : null,
      })),
    ...campagnes
      .filter((c) => c.data.statut === "programmee")
      .slice(0, 2)
      .map((c) => ({
        id: `p${c.id}`,
        icone: "faClock",
        titre: c.data.envoyerLe ? `Programmée ${dateHeure(c.data.envoyerLe)}` : "Départ imminent",
        texte: `« ${c.data.nom} » — ${nombre(c.data.destinataires?.length)} destinataires. Annulable jusqu'au départ.`,
        action: { label: "Voir", faire: () => onOuvrir(c) },
      })),
  ];

  const part = (n) => (sante.total ? `${(n / sante.total) * 100}%` : "0%");

  return (
    <div className="cmpPage cosScroll">
      <div className="cmpConteneur">
        <header className="cmpTete">
          <div>
            <h1>Campagnes</h1>
            <p>Écrivez à vos clients du CRM, suivez qui ouvre et qui clique.</p>
          </div>
          <div className="cmpTeteActions">
            <Recherche valeur={recherche} onChanger={setRecherche} placeholder="Rechercher une campagne" />
            <button type="button" className="cmpPrincipal" onClick={onNouvelle} disabled={!peutEcrire} title={peutEcrire ? "" : "Réservé aux administrateurs"}>
              <Icon fafa="faPlus" width={12} />
              Nouvelle campagne
            </button>
          </div>
        </header>

        {!peutEcrire ? (
          <div className="cmpBandeau" data-ton="info">
            <Icon fafa="faLock" width={12} />
            Les campagnes partent au nom de l'entreprise : seuls les administrateurs les créent et les lancent. Vous pouvez consulter les résultats.
          </div>
        ) : null}

        <section className="cmpKpis" aria-label="Indicateurs">
          <div className="cmpKpi"><span>Contacts joignables</span><b>{nombre(sante.joignables)}</b><small>sur {nombre(sante.total)} fiches du CRM</small></div>
          <div className="cmpKpi"><span>Messages envoyés · 30 jours</span><b>{nombre(stats.envoyes)}</b><small>dans {stats.campagnes} campagne{stats.campagnes > 1 ? "s" : ""}</small></div>
          <div className="cmpKpi"><span>Taux d'ouverture moyen</span><b>{pourcent(stats.tauxOuverture)}</b><small>campagnes terminées</small></div>
          <div className="cmpKpi"><span>Taux de clic moyen</span><b>{pourcent(stats.tauxClic)}</b><small>messages avec bouton</small></div>
        </section>

        <div className="cmpColonnes">
          <section className="cmpCarte cmpListe" aria-label="Liste des campagnes">
            <div className="cmpCarteTete">
              <Onglets options={onglets} valeur={onglet} onChoisir={setOnglet} label="Statut" />
            </div>
            <Contenu
              etat={etat}
              vide={!campagnes.length}
              lignes={5}
              rendreVide={() => (
                <div className="cmpVide">
                  <Icon fafa="faBullhorn" width={26} />
                  <b>Aucune campagne</b>
                  <span>Nouvelle offre, fermeture annuelle, vœux : écrivez une fois, le CRM fournit les destinataires.</span>
                  {peutEcrire ? <button type="button" className="cmpPrincipal" onClick={onNouvelle}><Icon fafa="faPlus" width={12} />Créer la première</button> : null}
                </div>
              )}
            >
              <div className="cmpTableau" role="table" aria-label="Campagnes">
                <div className="cmpLigne cmpLigneTete" role="row">
                  <span role="columnheader">Campagne</span>
                  <span role="columnheader">Statut</span>
                  <span role="columnheader">Audience</span>
                  <span role="columnheader">Envoi</span>
                  <span role="columnheader">Ouverture</span>
                  <span role="columnheader">Clics</span>
                  <span role="columnheader"><span className="cmpMasque">Actions</span></span>
                </div>
                {visibles.map((c) => {
                  const d = c.data;
                  const r = D.resumeDe(d.destinataires);
                  const envoi = d.statut === "brouillon" ? "Non planifiée"
                    : d.statut === "programmee" ? (d.envoyerLe ? `${dateCourte(d.envoyerLe)}, ${heure(d.envoyerLe)}` : "Dans la minute")
                      : d.statut === "envoi" ? `${nombre(r.envoyes + r.echecs)} / ${nombre(r.total)} · ${r.pourcent} %`
                        : `${nombre(r.envoyes)} envoyés · ${dateCourte(d.termineeLe || d.envoyerLe || d.creeLe)}`;
                  return (
                    <div key={c.id} className="cmpLigne" role="row" data-statut={d.statut}>
                      <button type="button" className="cmpLigneOuvrir" onClick={() => onOuvrir(c)}>
                        <span className="cmpPastille" aria-hidden="true" />
                        <span className="cmpLigneNom">
                          <b>{d.nom || "(sans nom)"}</b>
                          <small>{d.sujet || "Objet à écrire"}</small>
                        </span>
                      </button>
                      <span><Statut statut={d.statut} /></span>
                      <span className="cmpNum">{d.statut === "brouillon" ? "—" : nombre(r.total)}</span>
                      <span className="cmpEnvoi">
                        <small>{envoi}</small>
                        {d.statut !== "brouillon" ? <span className="cmpJauge"><span style={{ width: `${r.pourcent}%` }} /></span> : null}
                      </span>
                      <b className="cmpNum">{r.envoyes ? pourcent(r.tauxOuverture) : "—"}</b>
                      <b className="cmpNum">{r.envoyes && d.cta?.label ? pourcent(r.tauxClic) : "—"}</b>
                      <MenuActions
                        label={`Actions pour ${d.nom || "la campagne"}`}
                        actions={[
                          { label: d.statut === "brouillon" ? "Reprendre" : "Voir le rapport", icone: "faArrowRight", faire: () => onOuvrir(c) },
                          peutEcrire && { label: "Dupliquer", icone: "faClone", faire: () => onDupliquer(c) },
                          peutEcrire && d.statut === "programmee" && { label: "Annuler la programmation", icone: "faBan", faire: () => onAnnuler(c) },
                          peutEcrire && { label: "Supprimer", icone: "faTrashCan", danger: true, faire: () => onSupprimer(c) },
                        ]}
                      />
                    </div>
                  );
                })}
                {!visibles.length ? <div className="cmpVideLigne">Aucune campagne ne correspond.</div> : null}
              </div>
            </Contenu>
          </section>

          <aside className="cmpCote">
            <section className="cmpCarte cmpBloc">
              <h2>Santé de votre liste</h2>
              <div className="cmpEmpile" role="img" aria-label={`${sante.joignables} joignables, ${sante.sansEmail} sans e-mail, ${sante.desinscrits} désinscrits`}>
                <span data-ton="ok" style={{ width: part(sante.joignables) }} />
                <span data-ton="attention" style={{ width: part(sante.sansEmail) }} />
                <span data-ton="neutre" style={{ width: part(sante.desinscrits) }} />
              </div>
              <ul className="cmpLegende">
                <li><i data-ton="ok" />Joignables<b>{nombre(sante.joignables)}</b></li>
                <li><i data-ton="attention" />Sans e-mail valide<b>{nombre(sante.sansEmail)}</b></li>
                <li><i data-ton="neutre" />Désinscrits<b>{nombre(sante.desinscrits)}</b></li>
              </ul>
              {sante.sansEmail ? (
                <button type="button" className="cmpLien" onClick={() => ouvrirFenetre("crm")}>Compléter les e-mails dans le CRM →</button>
              ) : null}
            </section>

            <section className="cmpCarte cmpBloc">
              <h2>À faire</h2>
              {aFaire.length ? aFaire.map((x) => (
                <div key={x.id} className="cmpAFaire" data-ton={x.ton}>
                  <Icon fafa={x.icone} width={13} />
                  <span>
                    <b>{x.titre}</b>
                    <small>{x.texte}</small>
                    {x.action ? <button type="button" className="cmpLien" onClick={x.action.faire}>{x.action.label} →</button> : null}
                  </span>
                </div>
              )) : <p className="cmpDoux">Rien en attente. Les relances et les envois programmés apparaîtront ici.</p>}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// L'éditeur, en trois étapes
// ---------------------------------------------------------------------------

const Editeur = ({
  fiche, initial, clients, contexte, modeles, entreprise, nomEntreprise, occupe, peutEcrire, emailSession,
  onRetour, onBrouillon, onTester, onLancer, onModele, onSupprimer,
}) => {
  const [c, setC] = useState(() => {
    const base = { ...D.CAMPAGNE_VIDE, ...(initial || fiche?.data || {}) };
    return { ...base, filtres: D.normaliserFiltres(base.filtres), exclus: base.exclus || [] };
  });
  const [etape, setEtape] = useState(initial?.relanceDe ? "message" : "audience");
  const [modifie, setModifie] = useState(!!initial);
  const [quand, setQuand] = useState(""); // vide = tout de suite
  const [programmer, setProgrammer] = useState(false);
  const [testEnvoye, setTestEnvoye] = useState(false);
  const [adressesTest, setAdressesTest] = useState(emailSession);
  const [rechercheDest, setRechercheDest] = useState("");
  const [toutVoir, setToutVoir] = useState(false);
  const [appareil, setAppareil] = useState("ordinateur");
  const champObjet = useRef(null);
  const champTexte = useRef(null);
  const dernierChamp = useRef("texte");

  const maj = (patch) => { setModifie(true); setC((x) => ({ ...x, ...(typeof patch === "function" ? patch(x) : patch) })); };
  const majFiltres = (patch) => maj((x) => ({ filtres: { ...x.filtres, ...patch } }));

  const segment = useMemo(() => D.segmenter(clients, c.filtres, { exclus: c.exclus, contexte }), [clients, c.filtres, c.exclus, contexte]);
  const retenus = segment.retenus;
  const villes = useMemo(() => D.valeursDe(clients, "ville"), [clients]);
  const secteurs = useMemo(() => D.valeursDe(clients, "secteur"), [clients]);
  const verifs = D.verificationsLancement(c, retenus.length, testEnvoye);
  const bloquants = verifs.filter((v) => !v.ok && !v.conseil && !v.facultatif);
  const objet = D.analyseObjet(c.sujet);

  // Tant qu'il y a des modifications, fermer la fenêtre du navigateur demande confirmation.
  useEffect(() => {
    if (!modifie) return undefined;
    const avant = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", avant);
    return () => window.removeEventListener("beforeunload", avant);
  }, [modifie]);

  const retour = async () => {
    if (modifie && !(await modal.confirm({
      title: "Quitter sans enregistrer ?",
      message: "Les modifications de cette campagne seront perdues.",
      confirmLabel: "Quitter",
      danger: true,
    }))) return;
    onRetour();
  };

  const basculerExclu = (id) =>
    maj((x) => ({ exclus: x.exclus.includes(id) ? x.exclus.filter((e) => e !== id) : [...x.exclus, id] }));

  const ajouterA = (champ, valeur) => {
    if (!valeur) return;
    majFiltres({ [champ]: [...new Set([...(c.filtres[champ] || []), valeur])] });
  };
  const retirerDe = (champ, valeur) => majFiltres({ [champ]: c.filtres[champ].filter((v) => v !== valeur) });

  /// Glisse une variable là où se trouve le curseur (objet ou message).
  const inserer = (id) => {
    const cible = dernierChamp.current === "sujet" ? champObjet.current : champTexte.current;
    const champ = dernierChamp.current === "sujet" ? "sujet" : "texte";
    const jeton = `{{${id}}}`;
    const valeur = c[champ] || "";
    const debut = cible?.selectionStart ?? valeur.length;
    const fin = cible?.selectionEnd ?? valeur.length;
    maj({ [champ]: valeur.slice(0, debut) + jeton + valeur.slice(fin) });
    window.requestAnimationFrame(() => {
      cible?.focus();
      cible?.setSelectionRange(debut + jeton.length, debut + jeton.length);
    });
  };

  const choisirModele = async () => {
    const m = await modal.open({
      title: "Partir d'un modèle",
      render: ({ close }) => (
        <div className="crrChoix cosScroll">
          {modeles.map((x) => (
            <div key={x.id} className="crrChoixLigne handcr" onClick={() => close(x)}>
              <div>
                <div className="crrChoixNom">{x.data.nom}</div>
                <div className="crrChoixChemin">{x.data.sujet}</div>
              </div>
            </div>
          ))}
        </div>
      ),
    });
    if (m) maj({ sujet: m.data.sujet || "", texte: m.data.texte || "" });
  };

  const envoyerTest = async () => {
    const adresses = adressesTest.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean);
    const invalides = adresses.filter((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
    if (!adresses.length || invalides.length) {
      modal.alert({ title: "Adresse de test invalide", message: invalides.length ? invalides.join(", ") : "Indiquez au moins une adresse.", tone: "info" });
      return;
    }
    if (adresses.length > 5) {
      modal.alert({ title: "Cinq adresses au plus", message: "Le test sert à relire : quelques boîtes de l'équipe suffisent.", tone: "info" });
      return;
    }
    if (await onTester(c, adresses, retenus[0])) setTestEnvoye(true);
  };

  const enregistrer = async () => {
    const f = await onBrouillon(c, { rester: true });
    if (f) setModifie(false);
  };

  const lancer = () => {
    if (bloquants.length) {
      const premier = bloquants[0].id;
      setEtape(premier === "nom" || premier === "audience" ? "audience" : "message");
      return;
    }
    onLancer(c, retenus, programmer && quand ? new Date(quand).toISOString() : "");
  };

  const index = ETAPES.findIndex((e) => e.id === etape);
  const etapeFaite = {
    audience: !!String(c.nom).trim() && retenus.length > 0,
    message: !!String(c.sujet).trim() && !!String(c.texte).trim(),
    envoi: false,
  };
  const qDest = rechercheDest.trim().toLowerCase();
  const listeDest = segment.correspondants
    .filter((x) => !qDest || [x.data.nom, x.data.entreprise, x.data.email, x.data.ville].some((v) => String(v || "").toLowerCase().includes(qDest)));
  const dernierAchat = (id) => contexte.derniereFacture?.[id];

  return (
    <div className="cmpEditeur">
      <header className="cmpBarre">
        <button type="button" className="cmpRetour" onClick={retour}>
          <Icon fafa="faChevronLeft" width={11} />
          Campagnes
        </button>
        <span className="cmpSep" />
        <label className="cmpNomInterne">
          <span>Nom interne</span>
          <input
            value={c.nom}
            placeholder="Offre de rentrée, Fermeture annuelle…"
            aria-invalid={!String(c.nom).trim() || undefined}
            onChange={(e) => maj({ nom: e.target.value })}
            autoFocus={!fiche && !initial}
          />
        </label>

        <nav className="cmpEtapes" aria-label="Étapes">
          {ETAPES.map((e, i) => (
            <React.Fragment key={e.id}>
              {i ? <span className="cmpEtapeTrait" aria-hidden="true" /> : null}
              <button
                type="button"
                className="cmpEtape"
                aria-current={etape === e.id ? "step" : undefined}
                data-etat={etape === e.id ? "actif" : etapeFaite[e.id] ? "fait" : i < index ? "fait" : "a-faire"}
                onClick={() => setEtape(e.id)}
              >
                <b>{etape !== e.id && etapeFaite[e.id] ? <Icon fafa="faCheck" width={9} /> : i + 1}</b>
                {e.label}
                {e.id === "audience" && retenus.length ? <small>{nombre(retenus.length)}</small> : null}
              </button>
            </React.Fragment>
          ))}
        </nav>

        <div className="cmpBarreActions">
          {onSupprimer ? (
            <button type="button" className="cmpIcone" aria-label="Supprimer la campagne" title="Supprimer" onClick={onSupprimer} disabled={!peutEcrire}>
              <Icon fafa="faTrashCan" width={12} />
            </button>
          ) : null}
          <button type="button" className="cmpSecondaire" disabled={occupe || !peutEcrire || !String(c.nom).trim()} onClick={enregistrer} title={String(c.nom).trim() ? "" : "Donnez d'abord un nom interne"}>
            {modifie ? "Enregistrer" : "Enregistré"}
          </button>
        </div>
      </header>

      {c.relanceDe ? (
        <div className="cmpBandeau" data-ton="accent">
          <Icon fafa="faRotateRight" width={12} />
          Relance de « {c.relanceDe} » : seuls ceux qui n'ont pas ouvert la recevront. Changez l'objet — c'est lui qui n'a pas convaincu.
        </div>
      ) : null}

      <div className="cmpPage cosScroll">
        <div className="cmpConteneur cmpColonnes">
          {etape === "audience" ? (
            <>
              <main className="cmpPrincipale">
                <section className="cmpCarte cmpBloc">
                  <div className="cmpBlocTete">
                    <h2>À qui écrivez-vous ?</h2>
                    <p>Les contacts viennent du CRM. Chaque critère réduit l'audience.</p>
                  </div>
                  {c.filtres.ids ? (
                    <div className="cmpBandeau" data-ton="info">
                      <Icon fafa="faUsers" width={12} />
                      Liste fermée : {nombre(c.filtres.ids.length)} contacts choisis à la création de la relance.
                    </div>
                  ) : null}
                  <div className="cmpCriteres">
                    <span className="cmpCritere">Statut CRM</span>
                    <div className="cmpChips" role="radiogroup" aria-label="Statut CRM">
                      {Object.entries(D.STATUTS_CRM).map(([id, label]) => (
                        <button key={id} type="button" role="radio" aria-checked={c.filtres.statut === id} className="cmpChip" onClick={() => majFiltres({ statut: id })}>
                          {label}
                        </button>
                      ))}
                    </div>

                    <span className="cmpCritere">Villes</span>
                    <ChoixMultiples valeurs={c.filtres.villes} options={villes} tous="Toutes les villes" ajouter="Ajouter une ville" onAjouter={(v) => ajouterA("villes", v)} onRetirer={(v) => retirerDe("villes", v)} />

                    <span className="cmpCritere">Secteurs</span>
                    <ChoixMultiples valeurs={c.filtres.secteurs} options={secteurs} tous="Tous les secteurs" ajouter="Ajouter un secteur" onAjouter={(v) => ajouterA("secteurs", v)} onRetirer={(v) => retirerDe("secteurs", v)} />

                    <span className="cmpCritere">Activité</span>
                    <label className="cmpCase">
                      <input type="checkbox" checked={c.filtres.achatMois > 0} onChange={(e) => majFiltres({ achatMois: e.target.checked ? 6 : 0 })} />
                      A reçu une facture ces
                      <select aria-label="Période d'achat" value={c.filtres.achatMois || 6} onChange={(e) => majFiltres({ achatMois: Number(e.target.value) })}>
                        <option value={1}>30 derniers jours</option>
                        <option value={3}>3 derniers mois</option>
                        <option value={6}>6 derniers mois</option>
                        <option value={12}>12 derniers mois</option>
                      </select>
                      <small>d'après la Facturation</small>
                    </label>

                    <span className="cmpCritere">Pression</span>
                    <label className="cmpCase">
                      <input type="checkbox" checked={c.filtres.repos > 0} onChange={(e) => majFiltres({ repos: e.target.checked ? 7 : 0 })} />
                      Écarter ceux qui ont reçu une campagne il y a moins de
                      <select aria-label="Délai de repos" value={c.filtres.repos || 7} onChange={(e) => majFiltres({ repos: Number(e.target.value) })}>
                        <option value={3}>3 jours</option>
                        <option value={7}>7 jours</option>
                        <option value={14}>14 jours</option>
                        <option value={30}>30 jours</option>
                      </select>
                    </label>
                  </div>
                </section>

                <section className="cmpCarte">
                  <div className="cmpCarteTete">
                    <div className="cmpBlocTete">
                      <h2>Destinataires</h2>
                      <p>Décochez un contact pour l'écarter de cette campagne seulement.</p>
                    </div>
                    <Recherche valeur={rechercheDest} onChanger={setRechercheDest} placeholder="Nom, e-mail, ville" label="Rechercher un destinataire" />
                  </div>
                  <div className="cmpTableau" role="table" aria-label="Destinataires">
                    {(toutVoir ? listeDest : listeDest.slice(0, 8)).map((x) => {
                      const d = x.data;
                      const raison = !adresseValide(d.email) ? "Pas d'e-mail valide"
                        : d.emailDesinscrit ? "Désinscrit" : null;
                      const inclus = !raison && !c.exclus.includes(x.id) && retenus.includes(x);
                      const auRepos = !raison && !c.exclus.includes(x.id) && !retenus.includes(x);
                      return (
                        <div key={x.id} className="cmpLigne cmpLigneDest" role="row" data-inactif={!inclus || undefined}>
                          <input
                            type="checkbox"
                            aria-label={`Inclure ${d.entreprise || d.nom}`}
                            checked={inclus}
                            disabled={!!raison || auRepos}
                            onChange={() => basculerExclu(x.id)}
                          />
                          <span className="cmpPersonne">
                            <span className="cmpAvatar" aria-hidden="true">{initiales(d.entreprise || d.nom)}</span>
                            <b>{d.entreprise || d.nom}</b>
                          </span>
                          <span className="cmpDoux">{d.email || "—"}</span>
                          <span>{d.ville || "—"}</span>
                          <small className="cmpDoux">
                            {raison || (auRepos ? "Au repos (campagne récente)" : dernierAchat(x.id) ? `Facture le ${new Date(dernierAchat(x.id)).toLocaleDateString("fr-FR")}` : "")}
                          </small>
                        </div>
                      );
                    })}
                    {!listeDest.length ? <div className="cmpVideLigne">Personne ne correspond : élargissez les critères, ou complétez les e-mails dans le CRM.</div> : null}
                  </div>
                  {listeDest.length > 8 ? (
                    <div className="cmpCartePied">
                      {toutVoir ? listeDest.length : Math.min(8, listeDest.length)} sur {nombre(listeDest.length)} affichés ·{" "}
                      <button type="button" className="cmpLien" onClick={() => setToutVoir(!toutVoir)}>{toutVoir ? "Réduire" : "Tout voir"}</button>
                    </div>
                  ) : null}
                </section>
              </main>

              <aside className="cmpCote">
                <section className="cmpAudience" aria-live="polite">
                  <span>Audience retenue</span>
                  <p><b>{nombre(retenus.length)}</b> destinataire{retenus.length > 1 ? "s" : ""}</p>
                  <ul>
                    <li>Correspondent aux critères<b>{nombre(segment.correspondants.length)}</b></li>
                    {segment.sansEmail ? <li>Sans e-mail valide<b>− {nombre(segment.sansEmail)}</b></li> : null}
                    {segment.desinscrits ? <li>Désinscrits<b>− {nombre(segment.desinscrits)}</b></li> : null}
                    {segment.doublons ? <li>Adresses en double<b>− {nombre(segment.doublons)}</b></li> : null}
                    {segment.auRepos ? <li>Au repos<b>− {nombre(segment.auRepos)}</b></li> : null}
                    {segment.exclus ? <li>Écartés à la main<b>− {nombre(segment.exclus)}</b></li> : null}
                  </ul>
                  {retenus.length ? <small>Envoi estimé : {D.libelleDuree(retenus.length)}, par lots de {D.MESSAGES_PAR_PASSAGE} messages — pour rester hors des spams.</small> : null}
                </section>
                <Verifications verifs={verifs} />
                <button type="button" className="cmpAction" onClick={() => setEtape("message")}>
                  Continuer : le message
                  <Icon fafa="faArrowRight" width={12} />
                </button>
              </aside>
            </>
          ) : (
            <>
              <main className="cmpPrincipale">
                {etape === "message" ? (
                  <section className="cmpCarte cmpBloc">
                    <div className="cmpBlocTete cmpBlocTeteLigne">
                      <h2>Le message</h2>
                      <div className="cmpBoutons">
                        {modeles.length ? <button type="button" className="cmpSecondaire" onClick={choisirModele}>Partir d'un modèle</button> : null}
                        <button type="button" className="cmpSecondaire" disabled={!peutEcrire || !c.sujet.trim() || !c.texte.trim()} onClick={() => onModele(c)}>Enregistrer comme modèle</button>
                      </div>
                    </div>

                    <label className="cmpChamp">
                      <span>
                        Objet
                        <small data-ton={objet.ton}>{objet.longueur ? `${objet.longueur} caractères · ` : ""}{objet.avis}</small>
                      </span>
                      <input
                        ref={champObjet}
                        value={c.sujet}
                        placeholder="{{client}}, du nouveau chez {{entreprise}}"
                        onFocus={() => { dernierChamp.current = "sujet"; }}
                        onChange={(e) => maj({ sujet: e.target.value })}
                      />
                    </label>
                    <label className="cmpChamp">
                      <span>Texte d'aperçu <small>— la ligne grise qui suit l'objet dans la boîte de réception</small></span>
                      <input value={c.apercu || ""} maxLength={140} placeholder="Valable jusqu'au 30 octobre, livraison offerte." onChange={(e) => maj({ apercu: e.target.value })} />
                    </label>

                    <div className="cmpRedaction">
                      <div className="cmpInserer">
                        <span>Insérer :</span>
                        {D.VARIABLES.map((v) => (
                          <button key={v.id} type="button" title={v.aide} onMouseDown={(e) => e.preventDefault()} onClick={() => inserer(v.id)}>
                            {`{{${v.id}}}`}
                          </button>
                        ))}
                      </div>
                      <textarea
                        ref={champTexte}
                        aria-label="Message"
                        rows={10}
                        value={c.texte}
                        placeholder={"Bonjour {{client}},\n\n…"}
                        onFocus={() => { dernierChamp.current = "texte"; }}
                        onChange={(e) => maj({ texte: e.target.value })}
                      />
                    </div>

                    <div className="cmpGrille2">
                      <label className="cmpChamp">
                        <span>Bouton d'action <small>facultatif — il mesure les clics</small></span>
                        <input value={c.cta?.label || ""} placeholder="Voir l'offre" onChange={(e) => maj({ cta: { ...c.cta, label: e.target.value } })} />
                      </label>
                      <label className="cmpChamp" data-erreur={(c.cta?.label && !/^https?:\/\//i.test(c.cta?.url || "")) || undefined}>
                        <span>Lien du bouton</span>
                        <input value={c.cta?.url || ""} placeholder="https://…" inputMode="url" onChange={(e) => maj({ cta: { ...c.cta, url: e.target.value } })} />
                      </label>
                    </div>

                    <div className="cmpCouleurs">
                      <span>Couleur</span>
                      <div role="radiogroup" aria-label="Couleur">
                        {COULEURS.map((hex) => (
                          <button key={hex} type="button" role="radio" aria-checked={c.couleur?.toLowerCase() === hex} aria-label={`Couleur ${hex}`} style={{ background: hex }} onClick={() => maj({ couleur: hex })} />
                        ))}
                        <label className="cmpCouleurLibre" title="Couleur personnalisée">
                          <Icon fafa="faEyeDropper" width={10} />
                          <input type="color" aria-label="Couleur personnalisée" value={c.couleur || "#c2410c"} onChange={(e) => maj({ couleur: e.target.value })} />
                        </label>
                      </div>
                      <span className="cmpFiche" data-ok={!!entreprise?.adresse || undefined}>
                        <Icon fafa={entreprise?.adresse ? "faCircleCheck" : "faCircleInfo"} width={12} />
                        {entreprise?.adresse
                          ? "Logo, adresse et NCC repris de la fiche de l'entreprise"
                          : "Complétez la fiche de l'entreprise : logo et adresse en pied de message"}
                      </span>
                    </div>
                    <div className="cmpBas">
                      <button type="button" className="cmpSecondaire" onClick={() => setEtape("audience")}><Icon fafa="faArrowLeft" width={11} /> L'audience</button>
                      <button type="button" className="cmpAction" onClick={() => setEtape("envoi")}>Continuer : l'envoi <Icon fafa="faArrowRight" width={12} /></button>
                    </div>
                  </section>
                ) : (
                  <section className="cmpCarte cmpBloc">
                    <div className="cmpBlocTete"><h2>L'envoi</h2></div>
                    <div className="cmpMoments" role="radiogroup" aria-label="Moment de l'envoi">
                      <button type="button" role="radio" aria-checked={!programmer} onClick={() => setProgrammer(false)}>
                        <b>Maintenant</b><small>Départ dans la minute</small>
                      </button>
                      <button type="button" role="radio" aria-checked={programmer} onClick={() => { setProgrammer(true); if (!quand) setQuand(versLocal(creneaux()[0].date)); }}>
                        <b>Programmer</b><small>{programmer && quand ? dateHeure(new Date(quand).toISOString()) : "À l'heure où vos clients lisent"}</small>
                      </button>
                    </div>
                    {programmer ? (
                      <div className="cmpCreneaux">
                        {creneaux().map((s) => (
                          <button key={s.label} type="button" className="cmpChip" aria-pressed={quand === versLocal(s.date)} onClick={() => setQuand(versLocal(s.date))}>{s.label}</button>
                        ))}
                        <input type="datetime-local" aria-label="Date et heure d'envoi" value={quand} min={versLocal(new Date())} onChange={(e) => setQuand(e.target.value)} />
                      </div>
                    ) : null}

                    <div className="cmpTest">
                      <label className="cmpChamp">
                        <span>M'envoyer un test <small>jusqu'à 5 adresses de l'équipe</small></span>
                        <input value={adressesTest} placeholder="vous@entreprise.ci, collegue@entreprise.ci" onChange={(e) => setAdressesTest(e.target.value)} />
                      </label>
                      <button type="button" className="cmpSecondaire" disabled={occupe || !c.sujet.trim() || !c.texte.trim()} onClick={envoyerTest}>
                        {testEnvoye ? <><Icon fafa="faCheck" width={11} /> Renvoyer le test</> : "Envoyer le test"}
                      </button>
                    </div>

                    {!peutEcrire ? (
                      <div className="cmpBandeau" data-ton="info"><Icon fafa="faLock" width={12} />Seul un administrateur peut lancer l'envoi.</div>
                    ) : null}

                    <div className="cmpLancement">
                      <span>
                        {nombre(retenus.length)} destinataire{retenus.length > 1 ? "s" : ""}
                        {retenus.length ? ` · ${D.libelleDuree(retenus.length)} d'envoi` : ""}.
                        {programmer ? " Annulable jusqu'au départ." : ""}
                        {bloquants.length ? <em> Il manque : {bloquants.map((b) => b.label.toLowerCase()).join(", ")}.</em> : null}
                      </span>
                      <button type="button" className="cmpAction" disabled={occupe || !peutEcrire || (programmer && !quand)} onClick={lancer}>
                        <Icon fafa={programmer ? "faClock" : "faPaperPlane"} width={12} />
                        {programmer ? "Programmer la campagne" : "Lancer l'envoi"}
                      </button>
                    </div>
                  </section>
                )}
              </main>

              <aside className="cmpCote cmpCoteLarge" aria-label="Aperçu">
                <div className="cmpBlocTeteLigne">
                  <h2 className="cmpTitreCote">Aperçu</h2>
                  <Onglets
                    label="Appareil"
                    valeur={appareil}
                    onChoisir={setAppareil}
                    options={[{ id: "ordinateur", label: "Ordinateur" }, { id: "mobile", label: "Mobile" }]}
                  />
                </div>
                <ApercuMail campagne={c} exemple={retenus[0]} entreprise={entreprise} nomEntreprise={nomEntreprise} appareil={appareil} />
                {objet.conseils.length ? (
                  <div className="cmpBandeau" data-ton="accent">
                    <Icon fafa="faTriangleExclamation" width={12} />
                    {objet.conseils.join(" ")}
                  </div>
                ) : c.sujet ? (
                  <div className="cmpBandeau" data-ton="ok"><Icon fafa="faCircleCheck" width={12} />Objet sans mot à risque pour les filtres anti-spam.</div>
                ) : null}
                {etape === "envoi" ? <Verifications verifs={verifs} /> : null}
              </aside>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const ChoixMultiples = ({ valeurs, options, tous, ajouter, onAjouter, onRetirer }) => {
  const restantes = options.filter((o) => !valeurs.includes(o));
  return (
    <div className="cmpChips">
      {valeurs.map((v) => (
        <span key={v} className="cmpJeton">
          {v}
          <button type="button" aria-label={`Retirer ${v}`} onClick={() => onRetirer(v)}><Icon fafa="faXmark" width={9} /></button>
        </span>
      ))}
      {!valeurs.length ? <span className="cmpDoux">{tous}</span> : null}
      {restantes.length ? (
        <select className="cmpAjouter" aria-label={ajouter} value="" onChange={(e) => onAjouter(e.target.value)}>
          <option value="">+ {ajouter}</option>
          {restantes.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : null}
    </div>
  );
};

const Verifications = ({ verifs }) => (
  <section className="cmpCarte cmpBloc">
    <h2 className="cmpTitreCote">Avant de lancer</h2>
    <ul className="cmpVerifs">
      {verifs.filter((v) => !v.facultatif).map((v) => (
        <li key={v.id} data-ok={v.ok || undefined} data-conseil={v.conseil || undefined}>
          <span aria-hidden="true">{v.ok ? <Icon fafa="faCheck" width={9} /> : null}</span>
          {v.label}
          {v.conseil && !v.ok ? <small>conseillé</small> : null}
        </li>
      ))}
    </ul>
  </section>
);

// ---------------------------------------------------------------------------
// L'aperçu du mail, tel que le destinataire le recevra
// ---------------------------------------------------------------------------

const ApercuMail = ({ campagne, exemple, entreprise, nomEntreprise, appareil }) => {
  const variables = exemple
    ? D.variablesPour(D.destinataireDe(exemple), nomEntreprise)
    : { client: "Koné Distribution", contact: "Aya Koné", ville: "Abidjan", entreprise: nomEntreprise };
  const sujet = appliquerModele(campagne.sujet || "", variables);
  const pied = [nomEntreprise, [entreprise?.adresse, entreprise?.ville].filter(Boolean).join(", "), entreprise?.ncc ? `NCC ${entreprise.ncc}` : "", entreprise?.telephone]
    .filter(Boolean).join(" · ");
  // Dans l'aperçu, le logo est une image locale : on l'injecte après coup
  // (le gabarit n'accepte que des liens http(s), comme dans un vrai mail).
  let html = D.htmlDe(
    {
      ...campagne,
      texte: appliquerModele(campagne.texte || "Votre message apparaîtra ici…", variables),
      sujet,
    },
    {
      entreprise: nomEntreprise,
      lienCta: campagne.cta?.url ? "https://apercu.local/" : "",
      lienDesinscription: "https://apercu.local/",
      pied,
    },
  );
  if (entreprise?.logo && /^data:image\//.test(entreprise.logo)) {
    html = html.replace(
      /(<td style="background:[^"]*;padding:20px 32px">\s*)/,
      `$1<img src="${entreprise.logo}" alt="" height="36" style="height:36px;max-width:160px;vertical-align:middle;margin-right:12px;border-radius:6px;background:#ffffff">`,
    );
  }
  return (
    <div className="cmpApercu" data-appareil={appareil}>
      <div className="cmpBoite">
        <span className="cmpAvatar" aria-hidden="true">{initiales(nomEntreprise)}</span>
        <span className="cmpBoiteTexte">
          <span><b>{nomEntreprise}</b><small>maintenant</small></span>
          <b>{sujet || "(objet du message)"}</b>
          <small>{campagne.apercu || appliquerModele(campagne.texte || "", variables).slice(0, 90)}</small>
        </span>
      </div>
      <div className="cmpCadre">
        <iframe title="Aperçu du mail" srcDoc={html} sandbox="" />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Le rapport d'une campagne programmée, en cours ou terminée
// ---------------------------------------------------------------------------

const Rapport = ({ fiche, peutEcrire, onRetour, onSupprimer, onDupliquer, onRelancer, onReessayer, onAnnuler }) => {
  const c = fiche.data;
  const r = D.resumeDe(c.destinataires);
  const [filtre, setFiltre] = useState("tous");
  const [recherche, setRecherche] = useState("");
  const [limite, setLimite] = useState(50);
  const courbe = useMemo(() => D.ouverturesParHeure(c), [c]);
  // Une échelle ronde : 4, 10, 20, 50… — jamais « 1, 1, 0 ».
  const brut = Math.max(1, ...courbe.cases.map((x) => x.n));
  const max = brut <= 4 ? 4 : [10, 20, 50, 100, 200, 500, 1000].find((m) => m >= brut) || Math.ceil(brut / 1000) * 1000;
  const pic = courbe.cases.reduce((m, x) => (x.n > m.n ? x : m), { n: 0 });
  const sixHeures = courbe.cases.slice(0, 6).reduce((s, x) => s + x.n, 0);
  const nonOuverts = (c.destinataires || []).filter(D.FILTRES_DESTINATAIRES.nonOuverts.garde).length;

  const filtres = Object.entries(D.FILTRES_DESTINATAIRES).map(([id, f]) => ({
    id,
    label: f.label,
    nb: (c.destinataires || []).filter(f.garde).length,
  }));
  const q = recherche.trim().toLowerCase();
  const liste = (c.destinataires || []).filter(D.FILTRES_DESTINATAIRES[filtre].garde)
    .filter((d) => !q || [d.nom, d.email, d.ville].some((v) => String(v || "").toLowerCase().includes(q)));

  const etapes = [
    { label: "Destinataires", valeur: r.total, taux: "", aide: c.statut === "programmee" ? "figés au lancement" : `${nombre(r.attente)} en attente`, pct: 100, neutre: true },
    { label: "Délivrés", valeur: r.envoyes, taux: r.total ? `${Math.round((r.envoyes / r.total) * 100)} %` : "", aide: r.echecs ? `${r.echecs} échec${r.echecs > 1 ? "s" : ""}` : "aucun échec", pct: r.total ? (r.envoyes / r.total) * 100 : 0 },
    { label: "Ouverts", valeur: r.ouverts, taux: pourcent(r.tauxOuverture), aide: "au moins — certaines boîtes bloquent le suivi", pct: r.tauxOuverture },
    { label: "Ont cliqué", valeur: r.cliques, taux: c.cta?.label ? pourcent(r.tauxClic) : "", aide: c.cta?.label ? (r.ouverts ? `${Math.round((r.cliques / r.ouverts) * 100)} % de ceux qui ont ouvert` : "—") : "pas de bouton dans ce message", pct: r.tauxClic },
  ];

  const exporter = () => telecharger(`﻿${D.csvDe(c)}`, `${(c.nom || "campagne").replace(/[\\/:*?"<>|]/g, "-")}.csv`, "text/csv;charset=utf-8");

  return (
    <div className="cmpEditeur">
      <header className="cmpBarre">
        <button type="button" className="cmpRetour" onClick={onRetour}>
          <Icon fafa="faChevronLeft" width={11} />
          Campagnes
        </button>
        <span className="cmpSep" />
        <div className="cmpRapportTitre">
          <span><b>{c.nom}</b><Statut statut={c.statut} /></span>
          <small>
            {c.statut === "programmee"
              ? (c.envoyerLe ? `Départ prévu ${dateHeure(c.envoyerLe)}` : "Départ dans la minute")
              : c.statut === "envoi"
                ? `Envoi en cours · ${r.pourcent} % · reste ${D.libelleDuree(r.attente) || "peu"}`
                : `Envoyée ${dateHeure(c.envoyerLe || c.creeLe)}${c.termineeLe ? ` → ${heure(c.termineeLe)}` : ""}${fiche.auteur?.name ? ` · par ${fiche.auteur.name}` : ""}`}
          </small>
        </div>
        <div className="cmpBarreActions">
          {r.total ? <button type="button" className="cmpSecondaire" onClick={exporter}><Icon fafa="faFileArrowDown" width={11} /> Exporter (CSV)</button> : null}
          {peutEcrire ? <button type="button" className="cmpSecondaire" onClick={onDupliquer}><Icon fafa="faClone" width={11} /> Dupliquer</button> : null}
          {peutEcrire && c.statut === "programmee" ? <button type="button" className="cmpSecondaire" onClick={onAnnuler}><Icon fafa="faBan" width={11} /> Annuler la programmation</button> : null}
          {peutEcrire && c.statut === "terminee" && nonOuverts ? (
            <button type="button" className="cmpPrincipal" onClick={onRelancer}><Icon fafa="faRotateRight" width={11} /> Relancer les {nombre(nonOuverts)} non-ouvreurs</button>
          ) : null}
          {peutEcrire ? <button type="button" className="cmpIcone" aria-label="Supprimer la campagne" title="Supprimer" onClick={onSupprimer}><Icon fafa="faTrashCan" width={12} /></button> : null}
        </div>
      </header>

      <div className="cmpPage cosScroll">
        <div className="cmpConteneur">
          {c.statut === "envoi" ? (
            <div className="cmpProgression" role="progressbar" aria-valuenow={r.pourcent} aria-valuemin={0} aria-valuemax={100} aria-label="Progression de l'envoi">
              <span style={{ width: `${r.pourcent}%` }} />
            </div>
          ) : null}

          <section className="cmpKpis" aria-label="Entonnoir">
            {etapes.map((e) => (
              <div key={e.label} className="cmpKpi">
                <span>{e.label}</span>
                <span className="cmpKpiValeur"><b>{nombre(e.valeur)}</b>{e.taux ? <em>{e.taux}</em> : null}</span>
                <span className="cmpJauge cmpJaugeHaute" data-neutre={e.neutre || undefined}><span style={{ width: `${Math.min(100, e.pct || 0)}%` }} /></span>
                <small>{e.aide}</small>
              </div>
            ))}
          </section>

          <div className="cmpColonnes">
            <section className="cmpCarte cmpBloc cmpPrincipale">
              <div className="cmpBlocTeteLigne">
                <h2>Ouvertures, heure par heure</h2>
                {pic.n ? <small className="cmpDoux">Pic à {new Date(pic.heure).getHours()} h : {pic.n} ouverture{pic.n > 1 ? "s" : ""} · {r.ouverts ? Math.round((sixHeures / r.ouverts) * 100) : 0} % dans les 6 premières heures</small> : null}
              </div>
              {courbe.cases.length && r.ouverts ? (
                <figure className="cmpCourbe">
                  <div className="cmpCourbeZone">
                    <div className="cmpAxe" aria-hidden="true"><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div>
                    <div className="cmpBarres" role="img" aria-label={`Ouvertures sur 24 heures, pic de ${pic.n} à ${new Date(pic.heure || Date.now()).getHours()} h`}>
                      {courbe.cases.map((x) => (
                        <span key={x.heure} className="cmpBarreH" title={`${new Date(x.heure).getHours()} h : ${x.n} ouverture${x.n > 1 ? "s" : ""}`}>
                          <span style={{ height: `${(x.n / max) * 100}%` }} data-vide={!x.n || undefined} />
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="cmpGraduations" aria-hidden="true">
                    {courbe.cases.filter((_, i) => i % 6 === 0).map((x) => <span key={x.heure}>{new Date(x.heure).getHours()} h</span>)}
                    <span>+24 h</span>
                  </div>
                  <figcaption>Survolez une barre pour le nombre exact. Les ouvertures reposent sur une image invisible : le chiffre réel est au moins celui-ci.</figcaption>
                </figure>
              ) : (
                <p className="cmpDoux">{c.statut === "programmee" ? "Les ouvertures s'afficheront ici après le départ." : "Aucune ouverture enregistrée pour l'instant."}</p>
              )}
            </section>

            <aside className="cmpCote">
              {r.echecs || r.desinscrits ? (
                <section className="cmpCarte cmpBloc">
                  <h2 className="cmpTitreCote">À traiter</h2>
                  {r.echecs ? (
                    <div className="cmpAFaire" data-ton="erreur">
                      <Icon fafa="faCircleXmark" width={13} />
                      <span>
                        <b>{r.echecs} échec{r.echecs > 1 ? "s" : ""}</b>
                        <small>{(c.destinataires || []).find((d) => d.statut === "echec")?.erreur || "Adresse refusée par le serveur du destinataire."}</small>
                        <span className="cmpLiens">
                          {peutEcrire && c.statut === "terminee" ? <button type="button" className="cmpLien" onClick={onReessayer}>Réessayer</button> : null}
                          <button type="button" className="cmpLien" onClick={() => setFiltre("echecs")}>Voir la liste</button>
                        </span>
                      </span>
                    </div>
                  ) : null}
                  {r.desinscrits ? (
                    <div className="cmpAFaire">
                      <Icon fafa="faBellSlash" width={13} />
                      <span><b>{r.desinscrits} désinscription{r.desinscrits > 1 ? "s" : ""}</b><small>Marquées dans le CRM : plus aucune campagne ne leur sera envoyée.</small></span>
                    </div>
                  ) : null}
                </section>
              ) : null}
              <section className="cmpCarte cmpBloc">
                <h2 className="cmpTitreCote">Le message envoyé</h2>
                <b>{c.sujet}</b>
                {c.apercu ? <small className="cmpDoux">{c.apercu}</small> : null}
                <p className="cmpMessageLu">{c.texte}</p>
                {c.cta?.label ? <small className="cmpDoux">Bouton « {c.cta.label} » → {c.cta.url} · {nombre(r.cliques)} clic{r.cliques > 1 ? "s" : ""}</small> : null}
              </section>
            </aside>
          </div>

          {r.total ? (
            <section className="cmpCarte">
              <div className="cmpCarteTete">
                <Onglets options={filtres} valeur={filtre} onChoisir={(f) => { setFiltre(f); setLimite(50); }} label="Filtrer les destinataires" />
                <Recherche valeur={recherche} onChanger={setRecherche} placeholder="Nom, e-mail, ville" label="Rechercher un destinataire" />
              </div>
              <div className="cmpTableau" role="table" aria-label="Destinataires">
                {liste.slice(0, limite).map((d) => (
                  <div key={d.email} className="cmpLigne cmpLigneRapport" role="row">
                    <b>{d.nom}</b>
                    <span className="cmpDoux">{d.email}</span>
                    <span>{d.ville || "—"}</span>
                    <span className="cmpActivite" data-ton={d.statut === "echec" ? "erreur" : d.clique ? "fort" : d.ouvert ? "ok" : undefined}>
                      {d.statut === "echec" ? `Échec : ${d.erreur || "refusé"}`
                        : d.statut === "attente" ? "En attente"
                          : [
                            d.ouvert ? `Ouvert ${d.ouvertLe ? heure(d.ouvertLe) : ""}` : "Délivré — pas encore ouvert",
                            d.clique ? `Cliqué ${d.cliqueLe ? heure(d.cliqueLe) : ""}` : "",
                            d.desinscrit ? "Désinscrit" : "",
                          ].filter(Boolean).join(" · ")}
                    </span>
                    {d.clientId ? (
                      <button type="button" className="cmpLien" onClick={() => suivreLien({ lien: { app: "crm", params: { client: d.clientId } } })}>Fiche CRM →</button>
                    ) : <span />}
                  </div>
                ))}
                {!liste.length ? <div className="cmpVideLigne">Personne dans cette catégorie.</div> : null}
              </div>
              {liste.length > limite ? (
                <div className="cmpCartePied">
                  {limite} sur {nombre(liste.length)} affichés · <button type="button" className="cmpLien" onClick={() => setLimite(limite + 100)}>Afficher plus</button>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
};
