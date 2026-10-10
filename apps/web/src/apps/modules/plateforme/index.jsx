// Plateforme.
//
// ─────────────────────────────────────────────────────────────────────────
// LA CONSOLE DE L'EXPLOITANT
//
// Tous les espaces de travail du SaaS d'un coup d'œil : qui paie quoi,
// combien d'utilisateurs, combien de stockage, depuis quand. Et le geste
// commercial qui va avec — changer la formule d'un client qui a réglé par
// virement, offrir un mois, rétrograder un impayé.
//
// L'accès est tranché par le serveur (PLATFORM_ADMINS, une liste d'emails
// dans l'environnement) : quiconque d'autre ouvre cette fenêtre voit une
// porte fermée, pas des chiffres.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE LA REFONTE A CHANGÉ, ET POURQUOI
//
// La première version empilait tout sur une seule page : quatre chiffres,
// une table, puis la configuration du stockage. Trois défauts, chacun
// coûteux à sa manière.
//
//   • **Le réglage le plus dangereux du SaaS était à la même hauteur que
//     la consultation quotidienne.** Changer la destination des fichiers
//     de tous les clients ne se fait pas trois fois par jour ; le mettre
//     sous la table qu'on lit tous les matins invite l'accident. Il est
//     désormais dans sa propre section.
//   • **Quatre nombres bruts ne se pilotent pas.** « 180 000 F de revenu »
//     ne dit pas d'où il vient ni ce qui le menace. Le tableau de bord
//     montre maintenant la répartition par formule et, surtout, **les
//     espaces à surveiller** — au-dessus du quota, à l'étroit, ou vides.
//     C'est la question qu'on se pose vraiment en ouvrant la console.
//   • **La table ne se triait pas.** « Qui consomme le plus ? », « qui
//     s'est inscrit ce mois-ci ? » demandaient de lire ligne à ligne. Les
//     colonnes se trient, et deux filtres isolent les cas à traiter.
//
// La table est aussi devenue une vraie `<table>` : des `<div>` empilés ne
// s'annoncent pas à un lecteur d'écran, et le tri sans `aria-sort` ne se
// perçoit qu'à l'œil.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { Contenu, useChargement } from "../../chargement";
import { Vide } from "../../ui";
import { montant as fcfa } from "../../../utils/monnaie";
import { Stockage } from "./Stockage";
import { Sante } from "./Sante";
import { Securite } from "./Securite";
import { Maintenance } from "./Maintenance";
import "./plateforme.scss";
import { manifest as descriptif } from "./manifest";

export const manifest = { ...descriptif, Window: PlateformeApp };

const formatOctets = (n) => {
  const v = Number(n) || 0;
  if (v < 1024 ** 2) return `${Math.round(v / 1024)} Ko`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} Mo`;
  return `${(v / 1024 ** 3).toFixed(1)} Go`;
};

const SECTIONS = [
  { id: "bord", label: "Tableau de bord", icone: "faGaugeHigh" },
  { id: "espaces", label: "Espaces clients", icone: "faBuilding" },
  { id: "stockage", label: "Stockage", icone: "faCloud" },
  { id: "sante", label: "Santé", icone: "faHeartPulse" },
  { id: "securite", label: "Sécurité", icone: "faShieldHalved" },
  { id: "maintenance", label: "Maintenance", icone: "faScrewdriverWrench" },
];

const JOUR = 86400_000;
const joursDepuis = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / JOUR) : null);

/// « il y a 3 j », « aujourd'hui », « jamais » : la fraîcheur d'un accès.
const ilYa = (iso) => {
  const j = joursDepuis(iso);
  if (j == null) return "jamais";
  if (j < 1) return "aujourd'hui";
  if (j < 2) return "hier";
  if (j < 60) return `il y a ${j} j`;
  return `il y a ${Math.round(j / 30)} mois`;
};

/// Les colonnes triables de la table. `valeur` extrait ce sur quoi on
/// trie — pas ce qu'on affiche : trier « 1,2 Go » comme du texte le
/// placerait avant « 900 Mo ».
const COLONNES = [
  { id: "nom", titre: "Espace", valeur: (e) => e.nom.toLowerCase(), texte: true },
  { id: "plan", titre: "Formule", valeur: (e) => e.prixMois },
  { id: "utilisateurs", titre: "Membres", valeur: (e) => e.utilisateurs, num: true },
  { id: "applications", titre: "Apps", valeur: (e) => e.applications, num: true },
  { id: "fiches", titre: "Fiches", valeur: (e) => e.fiches, num: true },
  { id: "stockage", titre: "Stockage", valeur: (e) => Number(e.usedBytes) },
  { id: "dernierAcces", titre: "Dernier accès", valeur: (e) => (e.dernierAcces ? new Date(e.dernierAcces).getTime() : 0), num: true },
  { id: "creeLe", titre: "Créé le", valeur: (e) => new Date(e.creeLe).getTime(), num: true },
];

/// Ce qui mérite l'attention de l'exploitant, et pourquoi.
///
/// L'ordre compte : un espace bloqué en écriture passe avant un espace
/// simplement inoccupé.
const alerteDe = (e) => {
  const part = Number(e.quota) ? Number(e.usedBytes) / Number(e.quota) : 0;
  if (part >= 1) {
    return { ton: "danger", titre: "Quota dépassé", aide: "Cet espace ne peut plus rien enregistrer." };
  }
  if (part >= 0.85) {
    return { ton: "attention", titre: "Quota bientôt atteint", aide: `${Math.round(part * 100)} % utilisés.` };
  }
  // Un client qui ne revient plus : on le perd bien avant qu'il ne
  // résilie. Seulement pour un espace qui a vraiment servi.
  const absent = joursDepuis(e.dernierAcces);
  if (e.fiches > 0 && !e.suspendu && (absent == null || absent >= 30)) {
    return {
      ton: "attention",
      titre: "Client silencieux",
      aide: absent == null ? "Personne ne s'est jamais reconnecté." : `Aucune connexion depuis ${absent} jours.`,
    };
  }
  if (e.utilisateurs <= 1 && e.fiches === 0) {
    return { ton: "info", titre: "Espace inoccupé", aide: "Créé mais jamais utilisé — un accompagnement ferait la différence." };
  }
  return null;
};

function PlateformeApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";

  const [donnees, setDonnees] = useState(null);
  const [stockage, setStockage] = useState(null);
  const [sante, setSante] = useState(null);
  const [securite, setSecurite] = useState(null);
  const [refus, setRefus] = useState(false);
  const [section, setSection] = useState("bord");
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState("tous");
  const [tri, setTri] = useState({ colonne: "stockage", croissant: false });
  const [occupe, setOccupe] = useState(false);
  // Les membres de l'espace déplié, s'il y en a un. Chargés à la demande :
  // les rapatrier pour tous les espaces à chaque affichage du tableau
  // coûterait une requête par ligne pour une ligne qu'on ouvrira.
  const [membres, setMembres] = useState(null);

  const charger = useCallback(async () => {
    try {
      const [tableau, config, etatSante, etatSecurite] = await Promise.all([
        api.plateforme(),
        // La configuration du stockage est secondaire : si sa table
        // n'existe pas encore, la console doit quand même s'ouvrir.
        api.plateformeStockageLire().catch(() => null),
        // La santé aussi : une API d'avant les sauvegardes n'a pas la route.
        api.plateformeSante().catch(() => null),
        // Détection d'intrusion : même tolérance.
        api.plateformeSecurite().catch(() => null),
      ]);
      setDonnees(tableau);
      setStockage(config);
      setSante(etatSante);
      setSecurite(etatSecurite);
      setRefus(false);
    } catch (e) {
      if (e.status === 403) setRefus(true);
      else throw e;
    }
  }, []);
  const etat = useChargement(ouvert, charger);

  const tous = useMemo(() => donnees?.espaces || [], [donnees]);

  const surveiller = useMemo(
    () => tous.map((e) => ({ espace: e, alerte: alerteDe(e) })).filter((x) => x.alerte),
    [tous],
  );

  /// Le revenu par formule : « 180 000 F » ne dit pas d'où il vient.
  const parFormule = useMemo(() => {
    const formules = donnees?.formules || [];
    return formules.map((f) => {
      const dedans = tous.filter((e) => e.plan === f.id);
      return {
        ...f,
        espaces: dedans.length,
        revenu: dedans.length * f.prixMois,
        part: tous.length ? (dedans.length / tous.length) * 100 : 0,
      };
    });
  }, [donnees, tous]);

  const espaces = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    let liste = q
      ? tous.filter((e) => [e.nom, e.slug].join(" ").toLowerCase().includes(q))
      : [...tous];

    if (filtre === "alerte") liste = liste.filter((e) => alerteDe(e));
    else if (filtre === "payants") liste = liste.filter((e) => e.prixMois > 0);
    else if (filtre === "gratuits") liste = liste.filter((e) => !e.prixMois);

    const col = COLONNES.find((c) => c.id === tri.colonne) || COLONNES[0];
    liste.sort((a, b) => {
      const va = col.valeur(a);
      const vb = col.valeur(b);
      const cmp = col.texte ? String(va).localeCompare(String(vb), "fr") : va - vb;
      return tri.croissant ? cmp : -cmp;
    });
    return liste;
  }, [tous, recherche, filtre, tri]);

  const trierPar = (id) =>
    setTri((t) => (t.colonne === id ? { colonne: id, croissant: !t.croissant } : { colonne: id, croissant: false }));

  const changerFormule = async (espace, plan) => {
    const formule = donnees.formules.find((f) => f.id === plan);
    const ecart = formule.prixMois - espace.prixMois;
    const ok = await modal.confirm({
      title: `Passer « ${espace.nom} » en ${formule.nom} ?`,
      message: formule.prixMois
        ? `Facturation : ${fcfa(formule.prixMois)} / mois. Le quota passe à ${formatOctets(formule.quota)}.`
        : `Formule gratuite — quota ramené à ${formatOctets(formule.quota)}.`,
      // L'effet sur le revenu récurrent, dit avant de valider : c'est la
      // conséquence qui intéresse l'exploitant, et elle n'était nulle part.
      detail:
        (ecart !== 0
          ? `Revenu mensuel ${ecart > 0 ? "en hausse" : "en baisse"} de ${fcfa(Math.abs(ecart))}. `
          : "") +
        (Number(espace.usedBytes) > Number(formule.quota)
          ? "Attention : cet espace occupe déjà plus que le nouveau quota. Il ne perdra rien, mais ne pourra plus rien enregistrer."
          : "Aucun garde-fou de rétrogradation : l'exploitant assume."),
      confirmLabel: "Changer la formule",
      danger: ecart < 0,
    });
    if (!ok) return;
    setOccupe(true);
    try {
      await api.plateformeFormule(espace.id, plan);
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Changement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  /// Déplie ou replie la liste des membres d'un espace.
  const basculerMembres = async (espace) => {
    if (membres?.tenantId === espace.id) {
      setMembres(null);
      return;
    }
    setMembres({ tenantId: espace.id, chargement: true });
    try {
      const d = await api.plateformeMembres(espace.id);
      setMembres({ tenantId: espace.id, ...d });
    } catch (e) {
      setMembres(null);
      modal.alert({ title: "Membres illisibles", message: e.message, tone: "error" });
    }
  };

  const changerRoleMembre = async (tenantId, membre, role) => {
    if (role === membre.role) return;
    setOccupe(true);
    try {
      await api.plateformeRoleMembre(tenantId, membre.id, role);
      const d = await api.plateformeMembres(tenantId);
      setMembres({ tenantId, ...d });
    } catch (e) {
      // Le refus le plus fréquent est « dernier propriétaire » : le message
      // du serveur dit déjà quoi faire, on le montre tel quel.
      modal.alert({ title: "Changement refusé", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  /// Fermer toutes les sessions d'un membre — le geste du support face à
  /// un compte compromis. Rôle et données restent intacts.
  const deconnecterMembre = async (tenantId, membre) => {
    const ok = await modal.confirm({
      title: "Déconnecter ce compte ?",
      message: `${membre.name} sera déconnecté de tous ses appareils.`,
      detail:
        "Son rôle et ses données ne changent pas ; il pourra se reconnecter avec son mot de passe. L'action est inscrite au journal de son espace.",
      confirmLabel: "Déconnecter",
      danger: true,
    });
    if (!ok) return;
    setOccupe(true);
    try {
      await api.plateformeDeconnexion(tenantId, membre.id);
      modal.alert({ title: "Compte déconnecté", message: `${membre.name} devra se reconnecter.` });
    } catch (e) {
      modal.alert({ title: "Déconnexion refusée", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  /// Suspendre un espace, ou lever sa suspension.
  ///
  /// La suspension demande un motif : il est montré à l'utilisateur qui
  /// tente de se connecter. « Suspendu » sans explication transforme un
  /// litige commercial en incident technique, et fait perdre du temps aux
  /// deux parties.
  const basculerSuspension = async (espace) => {
    if (espace.suspendu) {
      const ok = await modal.confirm({
        title: `Rouvrir « ${espace.nom} » ?`,
        message: "Ses membres pourront se reconnecter immédiatement.",
        detail: espace.motifSuspension ? `Motif enregistré : ${espace.motifSuspension}` : undefined,
        confirmLabel: "Rouvrir l'accès",
      });
      if (!ok) return;
      await appliquerSuspension(espace, false, "");
      return;
    }

    const motif = await modal.prompt({
      title: `Suspendre « ${espace.nom} » ?`,
      message:
        "Ses membres ne pourront plus se connecter. Aucune donnée n'est supprimée : " +
        "tout revient tel quel à la réouverture.",
      detail: "Le motif sera montré à la personne qui tente de se connecter.",
      placeholder: "Facture de mars impayée",
      confirmLabel: "Suspendre l'espace",
      danger: true,
    });
    if (motif === null) return;
    await appliquerSuspension(espace, true, motif);
  };

  const appliquerSuspension = async (espace, suspendu, motif) => {
    setOccupe(true);
    try {
      await api.plateformeSuspension(espace.id, suspendu, motif);
      await etat.rafraichir();
    } catch (e) {
      modal.alert({
        title: suspendu ? "Suspension impossible" : "Réouverture impossible",
        message: e.message,
        tone: "error",
      });
    } finally {
      setOccupe(false);
    }
  };

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="pltApp">
        <div className="pltVerrou">Connectez-vous.</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="pltApp">
      <div className="pltCoquille">
        {refus ? (
          <div className="pltShell cosScroll">
            <Vide
              icone="faLock"
              titre="Console réservée à l'exploitant"
              aide={`Cette fenêtre montre tous les espaces clients du SaaS. Seuls les comptes listés dans PLATFORM_ADMINS, côté serveur, peuvent l'ouvrir — être administrateur de son espace ne suffit pas. Vous êtes connecté avec ${session.user?.email || "un compte inconnu"} : cette adresse doit figurer, exactement, dans PLATFORM_ADMINS.`}
            />
          </div>
        ) : (
          <>
            <nav className="pltNav" aria-label="Sections de la console">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="pltNavItem"
                  data-actif={section === s.id}
                  aria-current={section === s.id ? "page" : undefined}
                  onClick={() => setSection(s.id)}
                >
                  <Icon fafa={s.icone} width={13} />
                  <span>{s.label}</span>
                  {/* Le nombre d'espaces à traiter se voit depuis
                      n'importe quelle section : c'est ce qu'on vient
                      chercher. */}
                  {s.id === "bord" && surveiller.length ? (
                    <em className="pltBadge">{surveiller.length}</em>
                  ) : null}
                </button>
              ))}
            </nav>

            <div className="pltShell cosScroll">
              <Contenu etat={etat} vide={!donnees} lignes={5}>
                {donnees ? (
                  <>
                    {section === "bord" ? (
                      <Bord
                        donnees={donnees}
                        parFormule={parFormule}
                        surveiller={surveiller}
                        sante={sante}
                        securite={securite}
                        onAller={setSection}
                        onVoirEspaces={() => { setFiltre("alerte"); setSection("espaces"); }}
                      />
                    ) : null}

                    {section === "espaces" ? (
                      <Espaces
                        espaces={espaces}
                        total={tous.length}
                        formules={donnees.formules}
                        recherche={recherche}
                        setRecherche={setRecherche}
                        filtre={filtre}
                        setFiltre={setFiltre}
                        tri={tri}
                        trierPar={trierPar}
                        occupe={occupe}
                        onChangerFormule={changerFormule}
                        membres={membres}
                        onVoirMembres={basculerMembres}
                        onChangerRoleMembre={changerRoleMembre}
                        onDeconnecterMembre={deconnecterMembre}
                        onBasculerSuspension={basculerSuspension}
                      />
                    ) : null}

                    {section === "sante" ? (
                      sante ? (
                        <Sante
                          sante={sante}
                          onRecharger={etat.rafraichir}
                          onAllerStockage={() => setSection("stockage")}
                        />
                      ) : (
                        <Vide
                          icone="faHeartPulse"
                          titre="État de santé indisponible"
                          aide="Le serveur n'a pas répondu, ou la migration de base n'est pas appliquée. Relancez l'API, puis rouvrez cette console."
                        />
                      )
                    ) : null}

                    {section === "securite" ? (
                      securite ? (
                        <Securite securite={securite} onRecharger={etat.rafraichir} />
                      ) : (
                        <Vide
                          icone="faShieldHalved"
                          titre="Détection d'intrusion indisponible"
                          aide="Le serveur n'a pas répondu, ou la migration de base n'est pas appliquée. Relancez l'API, puis rouvrez cette console."
                        />
                      )
                    ) : null}

                    {section === "maintenance" ? <Maintenance /> : null}

                    {section === "stockage" ? (
                      stockage ? (
                        <Stockage config={stockage} onRecharger={etat.rafraichir} />
                      ) : (
                        <Vide
                          icone="faCloud"
                          titre="Configuration du stockage indisponible"
                          aide="Le serveur n'a pas répondu, ou la migration de base n'est pas appliquée. Relancez l'API, puis rouvrez cette console."
                        />
                      )
                    ) : null}
                  </>
                ) : null}
              </Contenu>
            </div>
          </>
        )}
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------

/// Les inscriptions des six derniers mois, du plus ancien au plus récent.
const inscriptionsParMois = (espaces) => {
  const mois = [];
  const d = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    mois.push({
      cle: `${m.getFullYear()}-${m.getMonth()}`,
      libelle: m.toLocaleDateString("fr-FR", { month: "short" }),
      n: 0,
    });
  }
  for (const e of espaces) {
    const c = new Date(e.creeLe);
    const ligne = mois.find((m) => m.cle === `${c.getFullYear()}-${c.getMonth()}`);
    if (ligne) ligne.n += 1;
  }
  return mois;
};

/// L'état des trois chantiers de l'exploitant, en une ligne chacun.
const etatsPlateforme = (sante, securite) => {
  const etats = [];
  if (sante) {
    const s = sante.sauvegardes;
    const age = s.derniereBase ? (Date.now() - new Date(s.derniereBase.debut)) / 3600_000 : Infinity;
    etats.push({
      section: "sante",
      icone: "faDatabase",
      titre: "Sauvegardes",
      ton: !s.active || age > 36 ? "danger" : s.horsSitePossible ? "ok" : "attention",
      texte: !s.active
        ? "désactivées"
        : age > 36
          ? "base non sauvegardée depuis plus d'un jour"
          : s.horsSitePossible
            ? "à jour, copiées hors site"
            : "à jour, sur le serveur seulement",
    });
    etats.push({
      section: "sante",
      icone: "faBug",
      titre: "Erreurs",
      ton: sante.erreurs.aTraiter ? "attention" : "ok",
      texte: sante.erreurs.aTraiter ? `${sante.erreurs.aTraiter} à traiter` : "aucune à traiter",
    });
  }
  if (securite) {
    const graves = securite.resume?.ouvertesGraves || 0;
    etats.push({
      section: "securite",
      icone: "faShieldHalved",
      titre: "Sécurité",
      ton: graves ? "danger" : "ok",
      texte: graves
        ? `${graves} alerte${graves > 1 ? "s" : ""} grave${graves > 1 ? "s" : ""}`
        : `${securite.ipsBloquees?.length || 0} adresse(s) bloquée(s), rien de grave`,
    });
  }
  return etats;
};

const Bord = ({ donnees, parFormule, surveiller, sante, securite, onAller, onVoirEspaces }) => {
  const espaces = donnees.espaces || [];
  const mois = inscriptionsParMois(espaces);
  const maxMois = Math.max(1, ...mois.map((m) => m.n));
  const nouveaux30 = espaces.filter((e) => joursDepuis(e.creeLe) < 30).length;
  const actifs7 = espaces.filter((e) => {
    const j = joursDepuis(e.dernierAcces);
    return j != null && j < 7;
  }).length;
  const payants = espaces.filter((e) => e.prixMois > 0).length;
  const etats = etatsPlateforme(sante, securite);

  return (
  <>
    <header className="pltTete">
      <div>
        <h2>Votre SaaS</h2>
        <p className="pltAide">
          L'état de la plateforme ce matin : ce qu'elle rapporte, ce qu'elle
          sert, et ce qui demande une décision.
        </p>
      </div>
    </header>

    <div className="pltChiffres">
      <div className="pltChiffre" data-fort="true">
        <b>{fcfa(donnees.totaux.mrr)}</b>
        <span>revenu mensuel · {payants} payant{payants > 1 ? "s" : ""}</span>
      </div>
      <div className="pltChiffre">
        <b>{donnees.totaux.espaces}</b>
        <span>espaces clients · +{nouveaux30} sur 30 j</span>
      </div>
      <div className="pltChiffre">
        <b>{actifs7}</b>
        <span>espaces actifs sur 7 jours</span>
      </div>
      <div className="pltChiffre">
        <b>{donnees.totaux.utilisateurs}</b>
        <span>utilisateurs</span>
      </div>
      <div className="pltChiffre">
        <b>{formatOctets(donnees.totaux.stockage)}</b>
        <span>stockage servi</span>
      </div>
    </div>

    {etats.length ? (
      <div className="pltEtats">
        {etats.map((e) => (
          <button key={e.titre} type="button" className="pltEtat" data-ton={e.ton} onClick={() => onAller(e.section)}>
            <span className="pltEtatIcone"><Icon fafa={e.icone} width={13} /></span>
            <span>
              <b>{e.titre}</b>
              <small>{e.texte}</small>
            </span>
            <Icon fafa="faChevronRight" width={9} />
          </button>
        ))}
      </div>
    ) : null}

    <section className="pltBloc">
      <div className="pltBlocTete">
        <div>
          <h3>Inscriptions</h3>
          <p className="pltAide">Nouveaux espaces par mois, sur six mois.</p>
        </div>
      </div>
      <div className="pltMois" role="img"
           aria-label={mois.map((m) => `${m.libelle} : ${m.n}`).join(", ")}>
        {mois.map((m) => (
          <div key={m.cle} className="pltMoisBarre">
            <em>{m.n || ""}</em>
            <i style={{ height: `${(m.n / maxMois) * 100}%` }} data-vide={!m.n || undefined} />
            <span>{m.libelle}</span>
          </div>
        ))}
      </div>
    </section>

    {/* D'où vient le revenu. Une somme seule ne dit pas si elle tient à un
        seul client ou à trente. */}
    <section className="pltBloc">
      <div className="pltBlocTete">
        <div>
          <h3>D'où vient le revenu</h3>
          <p className="pltAide">Répartition des espaces par formule.</p>
        </div>
      </div>
      <div className="pltFormules">
        {parFormule.map((f) => (
          <div key={f.id} className="pltFormule">
            <div className="pltFormuleHaut">
              <b>{f.nom}</b>
              <span>{f.prixMois ? `${fcfa(f.prixMois)} / mois` : "gratuit"}</span>
            </div>
            <div className="pltJauge" role="img"
                 aria-label={`${f.espaces} espace(s), ${Math.round(f.part)} % du parc`}>
              <i style={{ width: `${Math.max(f.part, f.espaces ? 3 : 0)}%` }} />
            </div>
            <div className="pltFormuleBas">
              <span>{f.espaces} espace{f.espaces > 1 ? "s" : ""}</span>
              <b>{f.revenu ? fcfa(f.revenu) : "—"}</b>
            </div>
          </div>
        ))}
      </div>
    </section>

    <section className="pltBloc">
      <div className="pltBlocTete">
        <div>
          <h3>À surveiller</h3>
          <p className="pltAide">
            Les espaces qui demandent une décision — quota atteint, ou client
            qui n'a jamais démarré.
          </p>
        </div>
        {surveiller.length ? (
          <button type="button" className="pltLien" onClick={onVoirEspaces}>
            Voir dans la liste
          </button>
        ) : null}
      </div>

      {surveiller.length ? (
        <ul className="pltAlertes">
          {surveiller.map(({ espace, alerte }) => (
            <li key={espace.id} data-ton={alerte.ton}>
              <span className="pltAlertePastille" />
              <div>
                <b>{espace.nom}</b>
                <span>{alerte.titre} — {alerte.aide}</span>
              </div>
              <span className="pltAlerteChiffre">
                {formatOctets(espace.usedBytes)} / {formatOctets(espace.quota)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pltRien">
          <Icon fafa="faCircleCheck" width={13} /> Rien à signaler : aucun espace
          n'est à l'étroit ni à l'abandon.
        </p>
      )}
    </section>
  </>
  );
};

// ---------------------------------------------------------------------------
// Espaces clients
// ---------------------------------------------------------------------------

const FILTRES = [
  { id: "tous", label: "Tous" },
  { id: "alerte", label: "À surveiller" },
  { id: "payants", label: "Payants" },
  { id: "gratuits", label: "Gratuits" },
];

const Espaces = ({
  espaces, total, formules, recherche, setRecherche, filtre, setFiltre,
  tri, trierPar, occupe, onChangerFormule,
  // Le tableau vit dans ce composant, l'état dans le parent : tout ce qu'il
  // manipule doit lui arriver en propriété. Les avoir seulement déclarés
  // au-dessus ne suffit pas — et `?.` ne protège pas d'un identifiant qui
  // n'existe pas, il lève un ReferenceError et emporte l'écran entier.
  membres, onVoirMembres, onChangerRoleMembre, onDeconnecterMembre, onBasculerSuspension,
}) => (
  <>
    <header className="pltTete">
      <div>
        <h2>Espaces clients</h2>
        <p className="pltAide">
          {espaces.length === total
            ? `${total} espace${total > 1 ? "s" : ""}. Le changement de formule est immédiat.`
            : `${espaces.length} sur ${total} espaces.`}
        </p>
      </div>
      <div className="pltRecherche">
        <Icon fafa="faMagnifyingGlass" width={11} />
        <input
          value={recherche}
          placeholder="Chercher un espace"
          aria-label="Chercher un espace"
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>
    </header>

    <div className="pltFiltres" role="group" aria-label="Filtrer les espaces">
      {FILTRES.map((f) => (
        <button
          key={f.id}
          type="button"
          className="pltFiltre"
          data-actif={filtre === f.id}
          aria-pressed={filtre === f.id}
          onClick={() => setFiltre(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>

    {espaces.length ? (
      <div className="pltTableEnveloppe">
        <table className="pltTable">
          <thead>
            <tr>
              {COLONNES.map((c) => (
                <th
                  key={c.id}
                  data-num={c.num || undefined}
                  aria-sort={
                    tri.colonne === c.id ? (tri.croissant ? "ascending" : "descending") : "none"
                  }
                >
                  {/* Un en-tête cliquable est un bouton : sans cela, le
                      tri est inatteignable au clavier. */}
                  <button type="button" onClick={() => trierPar(c.id)}>
                    {c.titre}
                    <Icon
                      fafa={
                        tri.colonne !== c.id ? "faSort"
                        : tri.croissant ? "faSortUp" : "faSortDown"
                      }
                      width={9}
                    />
                  </button>
                </th>
              ))}
              {/* Colonne d'action : pas de tri, donc pas de bouton
                  d'en-tête — un intitulé pour les lecteurs d'écran suffit. */}
              <th scope="col">Accès</th>
            </tr>
          </thead>
          <tbody>
            {espaces.map((e) => {
              const alerte = alerteDe(e);
              const part = Number(e.quota)
                ? Math.min(100, (Number(e.usedBytes) / Number(e.quota)) * 100)
                : 0;
              return (
                <React.Fragment key={e.id}>
                <tr data-alerte={alerte?.ton} data-suspendu={e.suspendu}>
                  <th scope="row" className="pltNom">
                    <span>
                      <button
                        type="button"
                        className="pltNomBtn"
                        aria-expanded={membres?.tenantId === e.id}
                        onClick={() => onVoirMembres(e)}
                      >
                        {e.nom}
                      </button>
                      {/* Une pastille, jamais une bordure latérale colorée.
                          Elle porte le motif en infobulle : la question qui
                          suit « pourquoi est-il fermé ? » ne doit pas
                          obliger à rouvrir une fiche. */}
                      {e.suspendu && (
                        <b className="pltSuspendu" title={e.motifSuspension || "Sans motif"}>
                          suspendu
                        </b>
                      )}
                    </span>
                    <em>{e.slug}</em>
                  </th>
                  <td>
                    <select
                      value={e.plan}
                      disabled={occupe}
                      aria-label={`Formule de ${e.nom}`}
                      onChange={(ev) => onChangerFormule(e, ev.target.value)}
                    >
                      {formules.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nom}
                          {f.prixMois ? ` — ${fcfa(f.prixMois)}/mois` : " — gratuit"}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-num>{e.utilisateurs}</td>
                  <td data-num>{e.applications}</td>
                  <td data-num>{e.fiches}</td>
                  <td>
                    {/* Une jauge se lit d'un coup d'œil ; le chiffre reste,
                        parce qu'une barre seule ne se cite pas. */}
                    <div className="pltUsage" data-plein={part >= 100} data-serre={part >= 85}>
                      <div className="pltUsageBarre">
                        <i style={{ width: `${part}%` }} />
                      </div>
                      <span>
                        {formatOctets(e.usedBytes)} / {formatOctets(e.quota)}
                      </span>
                    </div>
                  </td>
                  <td data-num title={e.dernierAcces ? new Date(e.dernierAcces).toLocaleString("fr-FR") : undefined}>
                    {ilYa(e.dernierAcces)}
                  </td>
                  <td data-num>{new Date(e.creeLe).toLocaleDateString("fr-FR")}</td>
                  <td>
                    <button
                      type="button"
                      className="pltBascule"
                      data-suspendu={e.suspendu}
                      disabled={occupe}
                      onClick={() => onBasculerSuspension(e)}
                    >
                      {e.suspendu ? "Rouvrir" : "Suspendre"}
                    </button>
                  </td>
                </tr>
                {membres?.tenantId === e.id && (
                  <tr className="pltMembresLigne">
                    <td colSpan={COLONNES.length + 1}>
                      {membres.chargement ? (
                        <p className="pltDiscret">Chargement…</p>
                      ) : (
                        <div className="pltMembres">
                          <ul>
                            {membres.membres.map((m) => (
                              <li key={m.id}>
                                <span className="pltMembreNom">
                                  <b>{m.name}</b>
                                  <em>{m.email}</em>
                                </span>
                                <select
                                  value={m.role}
                                  disabled={occupe}
                                  aria-label={`Rôle de ${m.name}`}
                                  onChange={(ev) => onChangerRoleMembre(e.id, m, ev.target.value)}
                                >
                                  <option value="OWNER">Propriétaire</option>
                                  <option value="ADMIN">Administrateur</option>
                                  <option value="MEMBER">Membre</option>
                                </select>
                                <button
                                  type="button"
                                  className="pltDeconnecter"
                                  disabled={occupe}
                                  title={`Déconnecter ${m.name} de tous ses appareils`}
                                  aria-label={`Déconnecter ${m.name} de tous ses appareils`}
                                  onClick={() => onDeconnecterMembre(e.id, m)}
                                >
                                  <Icon fafa="faRightFromBracket" width={11} />
                                </button>
                              </li>
                            ))}
                          </ul>
                          <p className="pltDiscret">
                            {membres.membres.length} membre
                            {membres.membres.length > 1 ? "s" : ""}
                            {membres.invitationsEnAttente > 0 &&
                              ` · ${membres.invitationsEnAttente} invitation${
                                membres.invitationsEnAttente > 1 ? "s" : ""
                              } en attente`}
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    ) : (
      <Vide
        icone="faMagnifyingGlass"
        titre="Aucun espace ne correspond"
        aide="Changez le filtre ou effacez la recherche."
      />
    )}
  </>
);
