import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { changeTheme } from "../../../actions";
import { Icon, Image, ToolBar } from "../../../utils/general";
import { api, clearToken } from "../../../api/client";
import { syncInstalledModules, detachAllModules, moduleBySlug } from "../../../apps/sync";
import { scrollElementTo } from "../../../apps/scrollTo";
import { modal } from "../../../apps/modalRequest";
import {
  POLICES,
  importerFond,
  choisirFond,
  retirerFond,
  importerPolice,
  choisirPolice,
  listerFonds,
} from "../../../apps/appearance";
import { Avatar } from "../../../apps/Avatar";
import { chargerApercu, oublierApercu } from "./assets/FileThumb";
import { choisirImage, redimensionnerImage } from "../../../apps/image";
import {
  FUSEAUX,
  choisirFuseau,
  fuseauChoisi,
  fuseauDetecte,
  fuseauEffectif,
  heureDans,
} from "../../../utils/heure";
import {
  DEVISES,
  choisirDevise,
  deviseChoisie,
  deviseDetectee,
  montant,
} from "../../../utils/monnaie";
import {
  LANGUES,
  choisirLangue,
  langueChoisie,
  langueDetectee,
} from "../../../utils/langue";
import { useTraduction } from "../../../utils/intl";
import { useNomApp } from "../../../utils/nomsApps";
import "./assets/settings.scss";

// Paramètres de CompanyOS.
//
// Réécrits pour que chaque réglage agisse vraiment : plus une seule tuile
// décorative. Ce qui n'est pas pilotable depuis un navigateur (Wi-Fi,
// Bluetooth, batterie, luminosité) n'y figure pas.

const SECTIONS = [
  { id: "systeme", label: "Système", icon: "faDisplay" },
  { id: "apparence", label: "Apparence", icon: "faPalette" },
  { id: "bureau", label: "Bureau et barre des tâches", icon: "faTableColumns" },
  { id: "applications", label: "Applications", icon: "faGrip" },
  { id: "stockage", label: "Stockage", icon: "faHardDrive" },
  { id: "compte", label: "Compte", icon: "faUser" },
  { id: "espace", label: "Espace de travail", icon: "faBuilding" },
  { id: "formule", label: "Formule et tarifs", icon: "faCreditCard" },
  { id: "journal", label: "Journal d'activité", icon: "faClockRotateLeft" },
  { id: "langue", label: "Langue et région", icon: "faLanguage" },
  { id: "apropos", label: "À propos", icon: "faCircleInfo" },
];

/// Traductions de la navigation. Le corps des sections reste en français
/// pour l'instant — l'extraction se fait au fil de l'eau ; le repli par
/// clé garantit qu'aucun libellé ne disparaît.
const TEXTES = {
  fr: {},
  en: {
    "section.systeme": "System",
    "section.apparence": "Appearance",
    "section.bureau": "Desktop and taskbar",
    "section.applications": "Applications",
    "section.stockage": "Storage",
    "section.compte": "Account",
    "section.espace": "Workspace",
    "section.formule": "Plan and pricing",
    "section.journal": "Activity log",
    "section.langue": "Language and region",
    "section.apropos": "About",
  },
};

/// Le libellé d'une section : traduit si la langue le couvre, sinon le
/// français de SECTIONS.
const libelleSection = (t, s) => {
  const traduit = t(`section.${s.id}`);
  return traduit === `section.${s.id}` ? s.label : traduit;
};

const VERSION = "0.1.0";

/// Traduction des verbes techniques du journal. Une action inconnue —
/// parce qu'un module récent en a introduit une — s'affiche telle quelle
/// plutôt que de disparaître : mieux vaut « stock.transfert » qu'un vide.
const ACTIONS = {
  "espace.creation": ["a créé l'espace de travail", "faBuilding"],
  "espace.formule": ["a changé la formule de l'espace", "faCreditCard"],
  "courrier.envoi": ["a envoyé un courriel à", "faPaperPlane"],
  "courrier.reglages": ["a modifié le relais SMTP", "faEnvelope"],
  "courrier.relance": ["relance automatique envoyée à", "faBell"],
  "espace.renommage": ["a renommé l'espace", "faPen"],
  "session.connexion": ["s'est connecté", "faRightToBracket"],
  "compte.motdepasse": ["a changé son mot de passe", "faKey"],
  "compte.renommage": ["a changé son nom", "faPen"],
  "compte.photo": ["a changé sa photo", "faCamera"],
  "compte.photo.retrait": ["a retiré sa photo", "faCamera"],
  "invitation.envoi": ["a invité", "faEnvelope"],
  "invitation.annulation": ["a annulé l'invitation de", "faXmark"],
  "membre.arrivee": ["a rejoint l'espace", "faUserPlus"],
  "membre.role": ["a changé le rôle de", "faUserShield"],
  "membre.retrait": ["a retiré", "faUserMinus"],
  "app.installation": ["a installé", "faDownload"],
  "app.desinstallation": ["a désinstallé", "faTrash"],
  "app.miseajour": ["a mis à jour", "faCircleArrowUp"],
  "studio.creation": ["a créé l'application", "faWandMagicSparkles"],
  "studio.modification": ["a modifié l'application", "faWandMagicSparkles"],
  "studio.suppression": ["a supprimé l'application", "faTrash"],
  "dossier.creation": ["a créé le dossier", "faFolderPlus"],
  "fichier.import": ["a importé", "faFileArrowUp"],
  "fichier.renommage": ["a renommé", "faPen"],
  "fichier.deplacement": ["a déplacé", "faRightLeft"],
  "fichier.corbeille": ["a mis à la corbeille", "faTrashCan"],
  "fichier.restauration": ["a restauré", "faTrashArrowUp"],
  "fichier.suppression": ["a supprimé définitivement", "faFireFlameSimple"],
  "corbeille.vidage": ["a vidé la corbeille", "faFireFlameSimple"],
};

/// Le contexte d'une entrée, en une phrase. Rien n'est indispensable ici :
/// une entrée sans détails reste parfaitement lisible.
const contexte = (e) => {
  const d = e.details || {};
  if (e.action === "membre.role") return `${d.avant} → ${d.apres}`;
  if (e.action === "membre.retrait") return `${d.nom || ""} (${d.role || ""})`;
  if (e.action === "invitation.envoi") return ROLES[d.role] || d.role;
  if (e.action === "fichier.import" && d.octets) return formatBytes(d.octets);
  if (e.action === "fichier.corbeille" && d.elements > 1) return `${d.elements} éléments`;
  if (e.action === "corbeille.vidage") return `${d.elements || 0} éléments`;
  if (e.action === "espace.renommage" && d.avant) return `avant : ${d.avant}`;
  return "";
};

/// Un horodatage complet : le journal sert à établir des faits, pas à
/// donner une impression — « il y a 3 h » n'a jamais réglé un litige.
const horodatage = (iso) =>
  new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const THEMES_FOND = {
  clair: "light",
  sombre: "dark",
  aurore: "dark",
  prairie: "light",
  ambre: "light",
  nuit: "dark",
};

const formatBytes = (bytes) => {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
};

/// Rôles, tels qu'on les nomme à l'écran. Ce ne sont pas des libellés
/// décoratifs : le serveur applique exactement cette hiérarchie — voir
/// `exigerRole` dans server/src/auth.js.
///
///   Propriétaire   — tout, y compris renommer l'espace et céder les clés
///   Administrateur — gère les membres et les applications installées
///   Membre         — utilise les applications installées
const ROLES = { OWNER: "Propriétaire", ADMIN: "Administrateur", MEMBER: "Membre" };
const PLANS = { FREE: "Gratuit", PRO: "Pro", ENTERPRISE: "Entreprise" };

/// Vignette d'un fond d'écran importé.
///
/// Défini au niveau du module, et non dans le composant des Paramètres :
/// déclaré à l'intérieur, React en ferait un type nouveau à chaque rendu,
/// démonterait la vignette et relancerait le téléchargement de l'image à
/// chaque frappe ailleurs dans la page.
const ApercuFond = ({ node, actif, onChoisir, onSupprimer }) => {
  const [url, setUrl] = useState(null);
  const [echec, setEchec] = useState(false);

  useEffect(() => {
    let vivant = true;
    chargerApercu(node).then((u) => {
      if (!vivant) return;
      if (u) setUrl(u);
      else setEchec(true);
    });
    return () => {
      vivant = false;
    };
  }, [node.id]);

  return (
    <div className="setWallCase" data-actif={actif}>
      {url ? (
        <img
          className="setWall"
          data-actif={actif}
          src={url}
          alt={node.name}
          title={node.name}
          onClick={onChoisir}
        />
      ) : (
        // Un cadre de la même taille pendant le chargement : sans lui, la
        // grille se réorganise sous les yeux à mesure que les images
        // arrivent, et on clique sur autre chose que ce qu'on visait.
        <div className="setWall setWallVide" onClick={echec ? undefined : onChoisir}>
          <Icon fafa={echec ? "faTriangleExclamation" : "faImage"} width={16} />
        </div>
      )}
      <div className="setWallPied">
        <span className="setWallNom" title={node.name}>
          {node.name}
        </span>
        {actif ? <span className="setWallActif">Actif</span> : null}
      </div>
      <span
        className="setWallSuppr handcr"
        title="Supprimer ce fond"
        onClick={onSupprimer}
      >
        <Icon fafa="faXmark" width={9} />
      </span>
    </div>
  );
};

/// Interrupteur réutilisé partout dans la page.
const Toggle = ({ on, onClick }) => (
  <div className="setToggle handcr" data-on={on} onClick={onClick}>
    <span />
  </div>
);

/// Ligne de réglage : libellé, explication, contrôle à droite.
const Row = ({ title, desc, children }) => (
  <div className="setRow">
    <div className="setRowText">
      <div className="setRowTitle">{title}</div>
      {desc ? <div className="setRowDesc">{desc}</div> : null}
    </div>
    <div className="setRowCtrl">{children}</div>
  </div>
);

export const Settings = () => {
  const t = useTraduction(TEXTES);
  const nomApp = useNomApp();
  const wnapp = useSelector((state) => state.apps.settings);
  const theme = useSelector((state) => state.setting.person.theme);
  const wall = useSelector((state) => state.wallpaper);
  const desktop = useSelector((state) => state.desktop);
  const taskbar = useSelector((state) => state.taskbar);
  const session = useSelector((state) => state.session);
  const appearance = useSelector((state) => state.appearance);
  const dispatch = useDispatch();

  const fondInput = React.useRef(null);
  const policeInput = React.useRef(null);
  const [fondsPerso, setFondsPerso] = useState([]);

  const [section, setSection] = useState("systeme");
  const [installed, setInstalled] = useState([]);
  const [usage, setUsage] = useState(null);
  const [dossiers, setDossiers] = useState([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Équipe
  const [membres, setMembres] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [mailInvite, setMailInvite] = useState("");
  const [roleInvite, setRoleInvite] = useState("MEMBER");

  // Journal d'activité
  const [journal, setJournal] = useState([]);
  const [facettes, setFacettes] = useState({ actions: [], auteurs: [] });
  const [filtre, setFiltre] = useState({ action: "", auteur: "" });
  const [journalFini, setJournalFini] = useState(false);

  // Formule et tarifs
  const [fact, setFact] = useState(null);
  // Fuseau horaire : "auto" ou un identifiant IANA, retenu sur le poste.
  const [fuseau, setFuseau] = useState(fuseauChoisi());
  // Langue et devise d'affichage : "auto" ou un code, retenus sur le poste.
  const [langue, setLangue] = useState(langueChoisie());
  const [devise, setDevise] = useState(deviseChoisie());

  // Formulaires
  const [nomProfil, setNomProfil] = useState("");
  const [nomEspace, setNomEspace] = useState("");
  const [mdp, setMdp] = useState({ current: "", next: "", confirm: "" });

  const mainRef = React.useRef(null);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
  };

  const connecte = session.status === "authenticated";

  const load = async () => {
    if (!connecte) return;
    try {
      const [apps, use, racine] = await Promise.all([
        api.installedApps(),
        api.usage(),
        api.listFiles(null),
      ]);
      setInstalled(apps);
      setUsage(use);
      setDossiers(racine.filter((n) => n.type === "FOLDER"));
      setFondsPerso(await listerFonds());
      setMembres(await api.members().catch(() => []));
      setFact(await api.facturation().catch(() => null));
      // Les invitations sont réservées aux administrateurs : un membre
      // reçoit un 403, et c'est très bien — on affiche simplement la liste
      // vide plutôt que de tester le rôle avant de demander.
      setInvitations(await api.invitations().catch(() => []));
    } catch (err) {
      flash(err.message);
    }
  };

  // ---- Équipe -------------------------------------------------------------

  const peutGerer = ["OWNER", "ADMIN"].includes(session.user?.role);
  const estProprietaire = session.user?.role === "OWNER";

  // ---- Formule ------------------------------------------------------------

  /// Prix affiché d'une formule : « Gratuit » ou « 15 000 F / mois »,
  /// dans la devise d'affichage de l'espace.
  const prixDe = (f) => (f.prixMois ? `${montant(f.prixMois)} / mois` : "Gratuit");

  /// Changement de formule — réservé au propriétaire, confirmé, et le
  /// serveur revérifie tout : rôle, stockage, effectif.
  const changerFormule = async (f) => {
    const ok = await modal.confirm({
      title: `Passer à la formule ${f.nom} ?`,
      message: f.prixMois
        ? `Votre espace passera à ${prixDe(f)}, avec ${formatBytes(f.quota)} de stockage.`
        : `Votre espace repassera en formule gratuite, limitée à ${formatBytes(f.quota)} de stockage.`,
      detail: f.utilisateursMax
        ? `Jusqu'à ${f.utilisateursMax} utilisateurs.`
        : "Utilisateurs illimités.",
      confirmLabel: "Changer de formule",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.changerFormule(f.id);
      setFact(await api.facturation().catch(() => null));
      // La session porte la formule et le quota : on la met à jour pour que
      // le volet latéral et la jauge de stockage suivent sans rechargement.
      dispatch({
        type: "SESSION_SET",
        payload: {
          user: session.user,
          tenant: { ...session.tenant, plan: res.plan, quota: res.quota },
        },
      });
      flash(`Vous êtes maintenant en formule ${f.nom}.`);
    } catch (err) {
      modal.alert({ title: "Changement impossible", message: err.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  // ---- Fuseau horaire -----------------------------------------------------

  const appliquerFuseau = (valeur) => {
    choisirFuseau(valeur);
    setFuseau(valeur);
  };

  // ---- Langue et devise ---------------------------------------------------

  const appliquerLangueChoisie = (valeur) => {
    choisirLangue(valeur);
    setLangue(valeur);
  };

  const appliquerDevise = (valeur) => {
    choisirDevise(valeur);
    setDevise(valeur);
  };

  // ---- Journal ------------------------------------------------------------

  /// Le journal se charge par tranches, du plus récent au plus ancien.
  /// `avant` sert de curseur : on repart de la dernière ligne affichée
  /// plutôt que d'un décalage, qui glisserait à chaque nouvel événement.
  const chargerJournal = async ({ suite = false } = {}) => {
    if (!peutGerer) return;
    try {
      const lot = await api.audit({
        action: filtre.action || undefined,
        auteur: filtre.auteur || undefined,
        avant: suite && journal.length ? journal[journal.length - 1].createdAt : undefined,
        limite: 50,
      });
      setJournal(suite ? [...journal, ...lot] : lot);
      setJournalFini(lot.length < 50);
      if (!suite) setFacettes(await api.auditFacettes().catch(() => facettes));
    } catch (err) {
      flash(err.message);
    }
  };

  // On ne charge le journal qu'en entrant dans sa section : c'est la
  // requête la plus lourde des paramètres, inutile de la payer pour
  // quelqu'un venu changer son fond d'écran.
  useEffect(() => {
    if (section === "journal") chargerJournal();
  }, [section, filtre.action, filtre.auteur]);

  const rafraichirEquipe = async () => {
    setMembres(await api.members().catch(() => []));
    setInvitations(await api.invitations().catch(() => []));
  };

  const inviter = async () => {
    const email = mailInvite.trim();
    if (!email || busy) return;
    setBusy(true);
    try {
      const inv = await api.invite(email, roleInvite);
      setMailInvite("");
      await rafraichirEquipe();
      await modal.alert({
        title: "Invitation créée",
        message: `Transmettez ce code à ${inv.email} :\n\n${inv.code}`,
        detail:
          "Il permet de créer un compte dans cet espace, une seule fois, pendant 14 jours. CompanyOS n'envoie pas d'e-mail : c'est à vous de le communiquer.",
        tone: "success",
      });
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copierCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      flash("Code copié");
    } catch {
      flash("Copie impossible — sélectionnez le code à la main.");
    }
  };

  const annulerInvitation = async (inv) => {
    const ok = await modal.confirm({
      title: "Annuler l'invitation",
      message: `Annuler l'invitation de ${inv.email} ?`,
      detail: "Son code cessera immédiatement de fonctionner.",
      confirmLabel: "Annuler l'invitation",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.cancelInvite(inv.id);
      await rafraichirEquipe();
    } catch (err) {
      flash(err.message);
    }
  };

  const changerRole = async (membre, role) => {
    if (role === membre.role) return;
    setBusy(true);
    try {
      await api.setMemberRole(membre.id, role);
      await rafraichirEquipe();
      flash(`${membre.name} est désormais ${ROLES[role].toLowerCase()}`);
    } catch (err) {
      flash(err.message);
      await rafraichirEquipe();
    } finally {
      setBusy(false);
    }
  };

  const retirerMembre = async (membre) => {
    const ok = await modal.confirm({
      title: "Retirer le membre",
      message: `Retirer ${membre.name} de l'espace de travail ?`,
      detail:
        "Son compte est supprimé, mais ses fichiers et ses saisies restent : ils appartiennent à l'entreprise, pas à la personne.",
      confirmLabel: "Retirer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeMember(membre.id);
      await rafraichirEquipe();
    } catch (err) {
      flash(err.message);
    }
  };

  // ---- Apparence personnalisée -------------------------------------------

  const importerUnFond = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const node = await importerFond(file);
      setFondsPerso(await listerFonds());
      await load();
      flash(`« ${node.name} » est maintenant votre fond d'écran`);
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  /// Supprime un fond importé. Il part à la corbeille comme n'importe quel
  /// fichier — c'en est un — donc récupérable pendant 30 jours.
  const supprimerFond = async (node) => {
    const ok = await modal.confirm({
      title: "Supprimer le fond d'écran",
      message: `Mettre « ${node.name} » à la corbeille ?`,
      detail:
        appearance.wallNodeId === node.id
          ? "C'est le fond actif : l'OS reviendra au fond livré. Récupérable pendant 30 jours."
          : "Récupérable pendant 30 jours depuis la corbeille.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      // L'ordre compte : retirer la préférence **avant** de supprimer le
      // fichier. L'inverse laisserait l'OS afficher un fond dont le nœud
      // n'existe plus, sans moyen de le recharger.
      if (appearance.wallNodeId === node.id) await retirerFond();
      await api.deleteNode(node.id);
      oublierApercu(node.id);
      setFondsPerso(await listerFonds());
      dispatch({ type: "CLOUD_TOUCH" });
      flash(`« ${node.name} » supprimé`);
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const importerUnePolice = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await importerPolice(file);
      await load();
      flash(`Police « ${file.name} » appliquée à toute l'interface`);
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!wnapp.hide && connecte) load();
  }, [wnapp.hide, session.status]);

  useEffect(() => {
    setNomProfil(session.user?.name || "");
    setNomEspace(session.tenant?.name || "");
  }, [session.user?.name, session.tenant?.name]);

  const goToSection = (id) => {
    setSection(id);
    scrollElementTo(mainRef.current, 0);
  };

  // ---- Actions ------------------------------------------------------------

  const changerFond = (nom) => {
    const suivant = THEMES_FOND[nom.split("/")[0]];
    if (suivant !== theme) changeTheme();
    dispatch({ type: "WALLSET", payload: nom });
  };

  const desinstaller = async (app) => {
    if (app.isCore) return;
    const ok = await modal.confirm({
      title: "Désinstaller l'application",
      message: `Retirer « ${nomApp(app)} » de cet espace de travail ?`,
      detail: "Les données saisies sont conservées et reviendront si l'application est réinstallée.",
      confirmLabel: "Désinstaller",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.uninstallApp(app.slug);
      await syncInstalledModules();
      await load();
      flash(`« ${nomApp(app)} » a été retirée`);
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const enregistrerProfil = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const user = await api.updateProfile(nomProfil);
      dispatch({ type: "SESSION_SET", payload: { user, tenant: session.tenant } });
      dispatch({ type: "STNGSETV", payload: { path: "person.name", value: user.name } });
      flash("Profil mis à jour");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  /// Changer sa photo. L'image est ramenée à 256 px carrés **avant**
  /// l'envoi : une photo de téléphone fait plusieurs mégaoctets et se
  /// retrouverait dans chaque liste de membres.
  const changerPhoto = async () => {
    if (busy) return;
    const fichier = await choisirImage();
    if (!fichier) return;

    setBusy(true);
    try {
      const user = await api.updateAvatar(await redimensionnerImage(fichier));
      dispatch({ type: "SESSION_SET", payload: { user, tenant: session.tenant } });
      // La liste des membres affiche aussi la photo : la recharger évite
      // de se voir soi-même avec l'ancienne juste à côté de la nouvelle.
      await rafraichirEquipe();
      flash("Photo de profil mise à jour");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const retirerPhoto = async () => {
    const ok = await modal.confirm({
      title: "Retirer la photo",
      message: "Votre avatar reviendra à vos initiales.",
      confirmLabel: "Retirer",
      danger: true,
    });
    if (!ok || busy) return;

    setBusy(true);
    try {
      const user = await api.updateAvatar(null);
      dispatch({ type: "SESSION_SET", payload: { user, tenant: session.tenant } });
      await rafraichirEquipe();
      flash("Photo retirée");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const enregistrerEspace = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const tenant = await api.updateTenant(nomEspace);
      dispatch({ type: "SESSION_SET", payload: { user: session.user, tenant } });
      flash("Espace de travail renommé");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changerMotDePasse = async () => {
    if (busy) return;
    if (mdp.next !== mdp.confirm) {
      flash("Les deux nouveaux mots de passe ne correspondent pas");
      return;
    }
    setBusy(true);
    try {
      await api.updatePassword(mdp.current, mdp.next);
      setMdp({ current: "", next: "", confirm: "" });
      flash("Mot de passe modifié");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deconnecter = () => {
    clearToken();
    dispatch({ type: "SESSION_CLEAR" });
    detachAllModules();
    dispatch({ type: "SETTINGS", payload: "close" });
  };

  // ---- Données dérivées ---------------------------------------------------

  const pctStockage = usage ? Math.min(100, (usage.usedBytes / usage.quota) * 100) : 0;

  const parCategorie = useMemo(() => {
    const groupes = {};
    installed.forEach((a) => {
      (groupes[a.category] = groupes[a.category] || []).push(a);
    });
    return Object.entries(groupes).sort((a, b) => a[0].localeCompare(b[0]));
  }, [installed]);

  const tailleIcones =
    desktop.size >= 1.5 ? "large" : desktop.size >= 1.2 ? "medium" : "small";

  return (
    <div
      className="settingsApp floatTab dpShad"
      data-size={wnapp.size}
      data-max={wnapp.max}
      style={{
        ...(wnapp.size == "cstm" ? wnapp.dim : null),
        zIndex: wnapp.z,
      }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar
        app={wnapp.action}
        icon={wnapp.icon}
        size={wnapp.size}
        name={nomApp("settings")}
      />
      <div className="windowScreen flex flex-col" data-dock="true">
        <div className="restWindow flex-grow flex flex-col">
          <div className="setShell">
            <aside className="setNav cosScroll">
              <div className="setAccount">
                <Avatar user={session.user} taille={38} />
                <div className="setAccountInfo">
                  <div className="setAccountName">
                    {session.user?.name || "Non connecté"}
                  </div>
                  <div className="setAccountMeta">
                    {session.tenant?.name || "Aucun espace"}
                  </div>
                </div>
              </div>

              {SECTIONS.map((s) => (
                <div
                  key={s.id}
                  className="setNavItem handcr"
                  data-active={section === s.id}
                  onClick={() => goToSection(s.id)}
                >
                  <Icon fafa={s.icon} width={13} />
                  <span>{libelleSection(t, s)}</span>
                </div>
              ))}
            </aside>

            <div className="setMain cosScroll" ref={mainRef}>
              {/* ---------- Système ---------- */}
              <section className="setSection" data-hidden={section !== "systeme"}>
                <h2>Système</h2>
                <p className="setHint">Version, session et raccourcis</p>

                <div className="setCard setSysCard">
                  <Image src={`img/wallpaper/${wall.src}`} w={110} ext />
                  <div>
                    <div className="setSysName">CompanyOS</div>
                    <div className="setSysMeta">
                      Version {VERSION} · {session.tenant?.name || "—"}
                    </div>
                    <div className="setSysMeta">
                      Plan {PLANS[session.tenant?.plan] || "—"} ·{" "}
                      {installed.length} application
                      {installed.length > 1 ? "s" : ""} installée
                      {installed.length > 1 ? "s" : ""}
                    </div>
                  </div>
                </div>

                <Row
                  title="Stockage utilisé"
                  desc={
                    usage
                      ? `${formatBytes(usage.usedBytes)} sur ${formatBytes(usage.quota)}`
                      : "Chargement…"
                  }
                >
                  <div
                    className="setBtnGhost handcr"
                    onClick={() => goToSection("stockage")}
                  >
                    Détail
                  </div>
                </Row>

                <Row title="Mises à jour" desc={`CompanyOS ${VERSION} — à jour`}>
                  <div className="setBadge">À jour</div>
                </Row>

                <Row
                  title="Session"
                  desc={`Connecté en tant que ${session.user?.email || "—"}`}
                >
                  <div className="setBtnGhost setDanger handcr" onClick={deconnecter}>
                    Se déconnecter
                  </div>
                </Row>
              </section>

              {/* ---------- Apparence ---------- */}
              <section className="setSection" data-hidden={section !== "apparence"}>
                <h2>Apparence</h2>
                <p className="setHint">Thème et fond d'écran</p>

                <Row
                  title="Thème sombre"
                  desc="S'applique à tout le système et à toutes les applications"
                >
                  <Toggle on={theme === "dark"} onClick={() => changeTheme()} />
                </Row>

                <div className="setSubTitle">Police de l'interface</div>
                <div className="setFonts">
                  {POLICES.map((p) => (
                    <div
                      key={p.id}
                      className="setFont handcr"
                      data-active={
                        !appearance.fontNodeId && appearance.fontId === p.id
                      }
                      style={{ fontFamily: p.stack }}
                      onClick={() => {
                        choisirPolice(p.id);
                        flash(`Police « ${p.label} » appliquée`);
                      }}
                    >
                      <div className="setFontName">{p.label}</div>
                      <div className="setFontSample">Aa — Facture 2026-014</div>
                    </div>
                  ))}
                </div>

                <Row
                  title="Police personnalisée"
                  desc={
                    appearance.fontName
                      ? `${appearance.fontName} — importée dans le cloud`
                      : "Fichier .ttf, .otf, .woff ou .woff2"
                  }
                >
                  {appearance.fontNodeId ? (
                    <div
                      className="setBtnGhost handcr"
                      onClick={() => {
                        choisirPolice("systeme");
                        flash("Police système rétablie");
                      }}
                    >
                      Retirer
                    </div>
                  ) : null}
                  <div
                    className="setBtnGhost handcr"
                    data-off={busy}
                    onClick={() => policeInput.current?.click()}
                  >
                    Importer une police
                  </div>
                  <input
                    ref={policeInput}
                    type="file"
                    accept=".ttf,.otf,.woff,.woff2,font/*"
                    className="none"
                    onChange={importerUnePolice}
                  />
                </Row>

                <div className="setSubTitle">Fond d'écran</div>
                <div className="setWalls">
                  {wall.themes.map((nom) => (
                    <Image
                      key={nom}
                      className={
                        !appearance.wallUrl && wall.src.includes(nom)
                          ? "setWall selected"
                          : "setWall"
                      }
                      src={`img/wallpaper/${nom}/img0.svg`}
                      ext
                      onClick={() => {
                        retirerFond();
                        changerFond(`${nom}/img0.svg`);
                      }}
                    />
                  ))}
                </div>
                <p className="setHint">
                  Choisir un fond livré ajuste le thème pour rester lisible.
                </p>

                <div className="setSubTitle">Vos fonds d'écran</div>
                {fondsPerso.length === 0 ? (
                  <div className="setEmptyBox">
                    Aucune image importée. Vos fonds sont rangés dans le dossier
                    « Fonds d'écran » du cloud et comptent dans votre quota.
                  </div>
                ) : (
                  // Une grille de vignettes, comme les fonds livrés juste
                  // au-dessus : on choisit un fond d'écran en le regardant,
                  // pas en lisant « IMG_2847.jpg ».
                  <div className="setWalls">
                    {fondsPerso.map((f) => (
                      <ApercuFond
                        key={f.id}
                        node={f}
                        actif={appearance.wallNodeId === f.id}
                        onChoisir={async () => {
                          await choisirFond(f.id);
                          flash(`« ${f.name} » appliqué`);
                        }}
                        onSupprimer={() => supprimerFond(f)}
                      />
                    ))}
                  </div>
                )}

                <div className="setActionsRow" style={{ marginTop: 12 }}>
                  <div
                    className="setPrimary handcr"
                    data-off={busy}
                    onClick={() => fondInput.current?.click()}
                  >
                    {busy ? "…" : "Importer une image"}
                  </div>
                  {appearance.wallUrl ? (
                    <div
                      className="setBtnGhost handcr"
                      onClick={async () => {
                        await retirerFond();
                        flash("Fond personnalisé retiré");
                      }}
                    >
                      Revenir aux fonds livrés
                    </div>
                  ) : null}
                  <input
                    ref={fondInput}
                    type="file"
                    accept="image/*"
                    className="none"
                    onChange={importerUnFond}
                  />
                </div>
              </section>

              {/* ---------- Bureau et barre des tâches ---------- */}
              <section className="setSection" data-hidden={section !== "bureau"}>
                <h2>Bureau et barre des tâches</h2>
                <p className="setHint">Disposition des icônes et de la barre</p>

                <Row title="Afficher les icônes du bureau">
                  <Toggle
                    on={!desktop.hide}
                    onClick={() => dispatch({ type: "DESKTOGG" })}
                  />
                </Row>

                <Row title="Taille des icônes">
                  <div className="setChips">
                    {[
                      { id: "small", label: "Petite", val: 1 },
                      { id: "medium", label: "Moyenne", val: 1.2 },
                      { id: "large", label: "Grande", val: 1.5 },
                    ].map((t) => (
                      <div
                        key={t.id}
                        className="setChip handcr"
                        data-active={tailleIcones === t.id}
                        onClick={() => dispatch({ type: "DESKSIZE", payload: t.val })}
                      >
                        {t.label}
                      </div>
                    ))}
                  </div>
                </Row>

                <Row
                  title="Disposition des icônes"
                  desc="Les icônes se déplacent à la souris ; leur position est retenue"
                >
                  <div
                    className="setBtnGhost handcr"
                    onClick={() => {
                      dispatch({ type: "DESKLAYOUT_RESET" });
                      flash("Icônes réorganisées en colonnes");
                    }}
                  >
                    Réorganiser
                  </div>
                </Row>

                <div className="setSubTitle">Barre des tâches</div>

                <Row title="Alignement des icônes">
                  <div className="setChips">
                    {[
                      { id: "left", label: "À gauche", action: "TASKLEF" },
                      { id: "center", label: "Au centre", action: "TASKCEN" },
                    ].map((t) => (
                      <div
                        key={t.id}
                        className="setChip handcr"
                        data-active={taskbar.align === t.id}
                        onClick={() => dispatch({ type: t.action })}
                      >
                        {t.label}
                      </div>
                    ))}
                  </div>
                </Row>

                <Row title="Afficher la recherche">
                  <Toggle
                    on={taskbar.search}
                    onClick={() =>
                      dispatch({
                        type: "TASKSRCH",
                        payload: String(!taskbar.search),
                      })
                    }
                  />
                </Row>
              </section>

              {/* ---------- Applications ---------- */}
              <section className="setSection" data-hidden={section !== "applications"}>
                <h2>Applications</h2>
                <p className="setHint">Modules installés dans cet espace de travail</p>

                <div className="setActionsRow">
                  <div
                    className="setBtnGhost handcr"
                    onClick={() => dispatch({ type: "WNSTORE", payload: "full" })}
                  >
                    Ouvrir la Boutique
                  </div>
                  <div
                    className="setBtnGhost handcr"
                    onClick={() => dispatch({ type: "STUDIOAPP", payload: "full" })}
                  >
                    Créer une application
                  </div>
                </div>

                {parCategorie.map(([categorie, liste]) => (
                  <div key={categorie}>
                    <div className="setSubTitle">{categorie}</div>
                    <div className="setList">
                      {liste.map((a) => (
                        <div key={a.slug} className="setAppRow">
                          <Icon src={a.icon} width={22} />
                          <div className="setAppInfo">
                            <div className="setAppName">{nomApp(a)}</div>
                            <div className="setAppMeta">
                              v{a.version}
                              {a.kind === "CUSTOM" ? " · créée dans le Studio" : ""}
                              {a.kind === "NATIVE" && !moduleBySlug[a.slug] && !a.isCore
                                ? " · module à venir"
                                : ""}
                            </div>
                          </div>
                          {a.isCore ? (
                            <div className="setBadge">Socle</div>
                          ) : (
                            <div
                              className="setBtnGhost setDanger handcr"
                              data-off={busy}
                              onClick={() => desinstaller(a)}
                            >
                              Désinstaller
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>

              {/* ---------- Stockage ---------- */}
              <section className="setSection" data-hidden={section !== "stockage"}>
                <h2>Stockage</h2>
                <p className="setHint">Espace consommé par l'espace de travail</p>

                <div className="setCard">
                  <div className="setStorageHead">
                    <span>{usage ? formatBytes(usage.usedBytes) : "—"} utilisés</span>
                    <span className="setMuted">
                      sur {usage ? formatBytes(usage.quota) : "—"}
                    </span>
                  </div>
                  <div className="setStorageBar">
                    <div
                      className="setStorageFill"
                      data-alert={pctStockage > 85}
                      style={{ width: `${Math.max(pctStockage, 0.5)}%` }}
                    />
                  </div>
                  <div className="setStorageFree">
                    {usage ? formatBytes(usage.availableBytes) : "—"} disponibles
                  </div>
                </div>

                <div className="setSubTitle">Dossiers à la racine</div>
                {dossiers.length === 0 ? (
                  <div className="setEmptyBox">Aucun dossier pour l'instant.</div>
                ) : (
                  <div className="setList">
                    {dossiers.map((d) => (
                      <div key={d.id} className="setAppRow">
                        <Icon src="win/folder" width={20} />
                        <div className="setAppInfo">
                          <div className="setAppName">{d.name}</div>
                        </div>
                        <div
                          className="setBtnGhost handcr"
                          onClick={() => dispatch({ type: "EXPLORER", payload: "full" })}
                        >
                          Ouvrir
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ---------- Compte ---------- */}
              <section className="setSection" data-hidden={section !== "compte"}>
                <h2>Compte</h2>
                <p className="setHint">Vos informations personnelles</p>

                <div className="setCard setAccountCard">
                  <div className="setPhoto">
                    <Avatar user={session.user} taille={56} />
                    <span
                      className="setPhotoBtn handcr"
                      title="Changer la photo"
                      onClick={changerPhoto}
                    >
                      <Icon fafa="faCamera" width={10} />
                    </span>
                  </div>
                  <div>
                    <div className="setSysName">{session.user?.name || "—"}</div>
                    <div className="setSysMeta">{session.user?.email || "—"}</div>
                    <div className="setSysMeta">
                      {ROLES[session.user?.role] || session.user?.role}
                    </div>
                    <div className="setActionsRow mt-2">
                      <div className="setBtnGhost handcr" onClick={changerPhoto}>
                        {session.user?.avatar ? "Changer la photo" : "Ajouter une photo"}
                      </div>
                      {session.user?.avatar ? (
                        <div
                          className="setBtnGhost setDanger handcr"
                          onClick={retirerPhoto}
                        >
                          Retirer
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="setSubTitle">Nom affiché</div>
                <div className="setInline">
                  <input
                    type="text"
                    value={nomProfil}
                    onChange={(e) => setNomProfil(e.target.value)}
                  />
                  <div
                    className="setPrimary handcr"
                    data-off={busy || !nomProfil.trim()}
                    onClick={enregistrerProfil}
                  >
                    Enregistrer
                  </div>
                </div>

                <div className="setSubTitle">Mot de passe</div>
                <div className="setGrid">
                  <label className="setField">
                    <span className="setLabel">Mot de passe actuel</span>
                    <input
                      type="password"
                      value={mdp.current}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMdp((m) => ({ ...m, current: v }));
                      }}
                    />
                  </label>
                  <label className="setField">
                    <span className="setLabel">Nouveau mot de passe</span>
                    <input
                      type="password"
                      value={mdp.next}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMdp((m) => ({ ...m, next: v }));
                      }}
                    />
                  </label>
                  <label className="setField">
                    <span className="setLabel">Confirmer</span>
                    <input
                      type="password"
                      value={mdp.confirm}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMdp((m) => ({ ...m, confirm: v }));
                      }}
                    />
                  </label>
                </div>
                <div
                  className="setPrimary handcr"
                  data-off={busy || !mdp.current || mdp.next.length < 8}
                  onClick={changerMotDePasse}
                >
                  Modifier le mot de passe
                </div>
              </section>

              {/* ---------- Espace de travail ---------- */}
              <section className="setSection" data-hidden={section !== "espace"}>
                <h2>Espace de travail</h2>
                <p className="setHint">Identité de l'entreprise et abonnement</p>

                <Row title="Identifiant" desc={session.tenant?.slug || "—"} />
                <Row
                  title="Formule"
                  desc={`${PLANS[session.tenant?.plan] || "—"} · ${
                    usage ? formatBytes(usage.quota) : "—"
                  } de stockage`}
                >
                  <div
                    className="setBadge handcr"
                    onClick={() => setSection("formule")}
                    title="Voir les formules et tarifs"
                  >
                    {PLANS[session.tenant?.plan] || "—"}
                  </div>
                </Row>

                <div className="setSubTitle">Nom de l'entreprise</div>
                {session.user?.role === "OWNER" ? (
                  <div className="setInline">
                    <input
                      type="text"
                      value={nomEspace}
                      onChange={(e) => setNomEspace(e.target.value)}
                    />
                    <div
                      className="setPrimary handcr"
                      data-off={busy || !nomEspace.trim()}
                      onClick={enregistrerEspace}
                    >
                      Renommer
                    </div>
                  </div>
                ) : (
                  <div className="setEmptyBox">
                    Seul le propriétaire de l'espace peut le renommer.
                  </div>
                )}

                <div className="setSubTitle">
                  Membres de l'équipe
                  <span className="setCompte">{membres.length}</span>
                </div>

                <div className="setMembres">
                  {membres.map((m) => {
                    const moi = m.id === session.user?.id;
                    return (
                      <div className="setMembre" key={m.id}>
                        <Avatar user={m} taille={30} />
                        <div className="setMembreInfo">
                          <div className="setMembreNom">
                            {m.name}
                            {moi ? <em> — vous</em> : null}
                          </div>
                          <div className="setMembreMail">{m.email}</div>
                        </div>

                        {peutGerer && !moi ? (
                          <select
                            className="setRole"
                            value={m.role}
                            disabled={busy}
                            onChange={(e) => changerRole(m, e.target.value)}
                          >
                            {/* Désigner un propriétaire, c'est céder les
                                clés : le serveur le réserve au propriétaire
                                en place, l'écran fait de même. */}
                            {session.user?.role === "OWNER" ? (
                              <option value="OWNER">{ROLES.OWNER}</option>
                            ) : null}
                            <option value="ADMIN">{ROLES.ADMIN}</option>
                            <option value="MEMBER">{ROLES.MEMBER}</option>
                          </select>
                        ) : (
                          <span className="setBadge">{ROLES[m.role]}</span>
                        )}

                        {peutGerer && !moi ? (
                          <Icon
                            className="setRetirer"
                            fafa="faUserMinus"
                            width={12}
                            onClick={() => retirerMembre(m)}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {peutGerer ? (
                  <>
                    <div className="setSubTitle">Inviter quelqu'un</div>
                    <p className="setHint">
                      L'invitation produit un code à transmettre — par message, de
                      vive voix, comme vous voulez. CompanyOS n'envoie pas d'e-mail.
                    </p>
                    <div className="setInline">
                      <input
                        type="email"
                        placeholder="adresse@entreprise.ci"
                        value={mailInvite}
                        onChange={(e) => setMailInvite(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && inviter()}
                      />
                      <select
                        className="setRole"
                        value={roleInvite}
                        onChange={(e) => setRoleInvite(e.target.value)}
                      >
                        <option value="MEMBER">{ROLES.MEMBER}</option>
                        <option value="ADMIN">{ROLES.ADMIN}</option>
                      </select>
                      <div
                        className="setPrimary handcr"
                        data-off={busy || !mailInvite.trim()}
                        onClick={inviter}
                      >
                        Inviter
                      </div>
                    </div>

                    {invitations.length ? (
                      <>
                        <div className="setSubTitle">Invitations en attente</div>
                        <div className="setMembres">
                          {invitations.map((i) => (
                            <div className="setMembre" key={i.id}>
                              <span className="setAvatar setAvatarAttente">
                                <Icon fafa="faHourglassHalf" width={11} />
                              </span>
                              <div className="setMembreInfo">
                                <div className="setMembreNom">{i.email}</div>
                                <div className="setMembreMail">
                                  {ROLES[i.role]} · expire le{" "}
                                  {new Date(i.expiresAt).toLocaleDateString("fr-FR")}
                                </div>
                              </div>
                              <code
                                className="setCode handcr"
                                title="Cliquer pour copier"
                                onClick={() => copierCode(i.code)}
                              >
                                {i.code}
                              </code>
                              <Icon
                                className="setRetirer"
                                fafa="faXmark"
                                width={12}
                                onClick={() => annulerInvitation(i)}
                              />
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </>
                ) : (
                  <div className="setEmptyBox">
                    Seuls les administrateurs de l'espace peuvent inviter ou
                    retirer des membres.
                  </div>
                )}
              </section>

              {/* ---------- Journal d'activité ---------- */}
              <section className="setSection" data-hidden={section !== "journal"}>
                <h2>Journal d'activité</h2>
                <p className="setHint">
                  Qui a fait quoi dans l'espace de travail, et quand
                </p>

                {!peutGerer ? (
                  <div className="setEmptyBox">
                    Seuls les administrateurs de l'espace peuvent consulter le
                    journal.
                  </div>
                ) : (
                  <>
                    <div className="setFiltres">
                      <select
                        className="setRole"
                        value={filtre.action}
                        onChange={(e) => setFiltre({ ...filtre, action: e.target.value })}
                      >
                        <option value="">Toutes les actions</option>
                        {facettes.actions.map((a) => (
                          <option key={a.action} value={a.action}>
                            {(ACTIONS[a.action]?.[0] || a.action)} ({a.total})
                          </option>
                        ))}
                      </select>
                      <select
                        className="setRole"
                        value={filtre.auteur}
                        onChange={(e) => setFiltre({ ...filtre, auteur: e.target.value })}
                      >
                        <option value="">Tout le monde</option>
                        {facettes.auteurs.map((a) => (
                          <option key={a.email} value={a.email}>
                            {a.nom} ({a.total})
                          </option>
                        ))}
                      </select>
                      <Icon
                        className="setRetirer"
                        fafa="faRotate"
                        width={12}
                        title="Rafraîchir"
                        onClick={() => chargerJournal()}
                      />
                    </div>

                    {!journal.length ? (
                      <div className="setEmptyBox">
                        Aucune activité pour ce filtre.
                      </div>
                    ) : (
                      <div className="setMembres">
                        {journal.map((e) => {
                          const [libelle, icone] = ACTIONS[e.action] || [e.action, "faCircleDot"];
                          const ctx = contexte(e);
                          return (
                            <div className="setMembre" key={e.id}>
                              <span className="setAvatar setAvatarJournal">
                                <Icon fafa={icone} width={11} />
                              </span>
                              <div className="setMembreInfo">
                                <div className="setMembreNom">
                                  <strong>{e.userName}</strong> {libelle}
                                  {e.cible ? <em> {e.cible}</em> : null}
                                </div>
                                <div className="setMembreMail">
                                  {horodatage(e.createdAt)}
                                  {ctx ? ` · ${ctx}` : ""}
                                  {e.ip ? ` · ${e.ip}` : ""}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {journal.length && !journalFini ? (
                      <div
                        className="setBtn setBtnGhost"
                        onClick={() => chargerJournal({ suite: true })}
                      >
                        Charger les entrées plus anciennes
                      </div>
                    ) : null}

                    <p className="setHint mt-3">
                      Le journal ne peut être ni modifié ni effacé, y compris
                      par le propriétaire de l'espace.
                    </p>
                  </>
                )}
              </section>

              {/* ---------- Formule et tarifs ---------- */}
              <section className="setSection" data-hidden={section !== "formule"}>
                <h2>Formule et tarifs</h2>
                <p className="setHint">
                  Ce que votre espace consomme, et ce que chaque formule offre
                </p>

                {fact ? (
                  <>
                    <div className="setFormules">
                      {fact.formules.map((f) => {
                        const actuelle = f.id === fact.actuelle;
                        return (
                          <div
                            key={f.id}
                            className="setFormule"
                            data-actuelle={actuelle ? "true" : "false"}
                          >
                            {actuelle ? (
                              <div className="setFormuleBadge">Votre formule</div>
                            ) : null}
                            <div className="setFormuleNom">{f.nom}</div>
                            <div className="setFormulePrix">{prixDe(f)}</div>
                            <p className="setFormuleResume">{f.resume}</p>
                            <ul className="setFormuleListe">
                              {f.avantages.map((a) => (
                                <li key={a}>{a}</li>
                              ))}
                            </ul>
                            {actuelle ? null : estProprietaire ? (
                              <div
                                className="setPrimary handcr setFormuleAction"
                                data-off={busy}
                                onClick={() => changerFormule(f)}
                              >
                                {f.prixMois &&
                                fact.formules.findIndex((x) => x.id === fact.actuelle) <
                                  fact.formules.findIndex((x) => x.id === f.id)
                                  ? "Passer à cette formule"
                                  : "Choisir cette formule"}
                              </div>
                            ) : (
                              <div className="setFormuleNote">
                                Seul le propriétaire de l'espace peut changer de
                                formule.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <Row
                      title="Consommation actuelle"
                      desc={`${fact.usage.utilisateurs} utilisateur${
                        fact.usage.utilisateurs > 1 ? "s" : ""
                      } · ${formatBytes(fact.usage.usedBytes)} sur ${formatBytes(
                        fact.usage.quota,
                      )} de stockage`}
                    />
                    <p className="setHint">
                      Rétrograder n'est possible que si la consommation tient
                      dans la formule visée — rien n'est jamais coupé d'office.
                      Le règlement se fait par Mobile Money ou virement, sur
                      facture.
                    </p>
                  </>
                ) : (
                  <p className="setHint">Tarifs indisponibles pour le moment.</p>
                )}
              </section>

              {/* ---------- Langue et région ---------- */}
              <section className="setSection" data-hidden={section !== "langue"}>
                <h2>Langue et région</h2>
                <p className="setHint">Affichage du shell et des applications</p>

                {/* La langue pilote i18next : les surfaces traduites (le
                    module Présentations, les chaînes extraites au fil de
                    l'eau) suivent immédiatement ; le shell historique reste
                    en français en attendant son extraction. */}
                <Row
                  title="Langue d'affichage"
                  desc={
                    langue === "auto"
                      ? `Automatique — ${
                          langueDetectee() === "fr" ? "français" : "anglais"
                        } détecté depuis le navigateur`
                      : "Épinglée — retenue sur ce poste"
                  }
                >
                  <select
                    className="setRole"
                    value={langue}
                    onChange={(e) => appliquerLangueChoisie(e.target.value)}
                  >
                    <option value="auto">
                      Automatique ({langueDetectee() === "fr" ? "Français" : "English"})
                    </option>
                    {LANGUES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.nom}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row
                  title="Devise d'affichage"
                  desc={
                    (devise === "auto" ? deviseDetectee() : devise) === "XOF"
                      ? "Franc CFA — la monnaie des données"
                      : `Conversion indicative à l'écran — ${montant(15000)} pour 15 000 F. Les données restent en franc CFA.`
                  }
                >
                  <select
                    className="setRole"
                    value={devise}
                    onChange={(e) => appliquerDevise(e.target.value)}
                  >
                    <option value="auto">
                      Automatique ({deviseDetectee()} selon le fuseau)
                    </option>
                    {DEVISES.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.nom} ({d.symbole})
                      </option>
                    ))}
                  </select>
                </Row>

                <Row
                  title="Format de date et d'heure"
                  desc={`Français (France) — ${new Date().toLocaleDateString(
                    "fr-FR",
                  )} · ${new Date().toLocaleTimeString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`}
                />

                <Row
                  title="Fuseau horaire"
                  desc={
                    fuseau === "auto"
                      ? `Automatique — ${fuseauDetecte()} détecté par le navigateur · il est ${heureDans(
                          fuseauEffectif(),
                        )}`
                      : `Épinglé — il est ${heureDans(fuseauEffectif())}`
                  }
                >
                  <select
                    className="setRole"
                    value={fuseau}
                    onChange={(e) => appliquerFuseau(e.target.value)}
                  >
                    <option value="auto">
                      Automatique ({fuseauDetecte()})
                    </option>
                    {FUSEAUX.map((z) => (
                      <option key={z} value={z}>
                        {z.replace("_", " ")} — {heureDans(z)}
                      </option>
                    ))}
                  </select>
                </Row>
              </section>

              {/* ---------- À propos ---------- */}
              <section className="setSection" data-hidden={section !== "apropos"}>
                <h2>À propos</h2>
                <p className="setHint">CompanyOS {VERSION}</p>

                <div className="setAbout">
                  <p>
                    CompanyOS est un système d'exploitation web : un bureau unique
                    qui réunit les applications de gestion de l'entreprise et les
                    fait communiquer entre elles.
                  </p>
                  <p>
                    Chaque espace de travail dispose de son propre stockage, de son
                    catalogue d'applications et de ses données, sans jamais croiser
                    ceux des autres clients.
                  </p>
                </div>

                <Row title="Version" desc={`CompanyOS ${VERSION}`} />
                <Row
                  title="Navigateur"
                  desc={`${navigator.language} · ${
                    navigator.hardwareConcurrency || "?"
                  } cœurs`}
                />
                <Row
                  title="Interface"
                  desc="Fondée sur le projet libre win11React (Creative Commons)"
                />
              </section>

              {notice ? <div className="setNotice">{notice}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
