import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { changeTheme } from "../../../../actions";
import { Icon, ToolBar } from "../../../../utils/general";
import { api, clearToken } from "../../../../api/client";
import { syncInstalledModules, detachAllModules } from "../../../../apps/sync";
import { scrollElementTo } from "../../../../apps/scrollTo";
import { modal } from "../../../../apps/modalRequest";
import {
  importerFond,
  retirerFond,
  importerPolice,
  listerFonds,
} from "../../../../apps/appearance";
import { Avatar } from "../../../../apps/Avatar";
import { oublierApercu } from "../assets/FileThumb";
import { choisirImage, redimensionnerImage } from "../../../../apps/image";
import { choisirFuseau, fuseauChoisi } from "../../../../utils/heure";
import {
  choisirDevise,
  deviseChoisie,
  montant,
} from "../../../../utils/monnaie";
import { choisirLangue, langueChoisie } from "../../../../utils/langue";
import { useTraduction } from "../../../../utils/intl";
import { useNomApp } from "../../../../utils/nomsApps";
import { ROLES, formatBytes } from "./commun";
import { SectionSysteme } from "./Systeme";
import { SectionApparence } from "./Apparence";
import { SectionBureau } from "./Bureau";
import { SectionApplications } from "./Applications";
import { SectionStockage } from "./Stockage";
import { SectionCompte } from "./Compte";
import { SectionEspace } from "./Espace";
import { SectionJournal } from "./Journal";
import { SectionFormule } from "./Formule";
import { SectionLangue } from "./Langue";
import { SectionAPropos } from "./APropos";
import "../assets/settings.scss";

// Paramètres de CompanyOS.
//
// Réécrits pour que chaque réglage agisse vraiment : plus une seule tuile
// décorative. Ce qui n'est pas pilotable depuis un navigateur (Wi-Fi,
// Bluetooth, batterie, luminosité) n'y figure pas.
//
// Le dossier est découpé comme l'écran lui-même : ce fichier tient l'état,
// les actions et le volet de navigation, et chaque rubrique de ce volet a
// son fichier (Systeme, Apparence, Bureau, Applications, Stockage, Compte,
// Espace, Journal, Formule, Langue, APropos). Les rubriques n'ont aucun
// état à elles : elles reçoivent en props ce qu'elles affichent et les
// actions qu'elles déclenchent, pour que rien ne se pilote depuis deux
// endroits à la fois. `commun.jsx` garde ce qu'elles se partagent — la
// ligne de réglage, l'interrupteur, la vignette de fond d'écran et les
// tables de libellés.

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

const THEMES_FOND = {
  clair: "light",
  sombre: "dark",
  aurore: "dark",
  prairie: "light",
  ambre: "light",
  nuit: "dark",
};

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
              <SectionSysteme
                section={section}
                wall={wall}
                session={session}
                installed={installed}
                usage={usage}
                goToSection={goToSection}
                deconnecter={deconnecter}
              />

              {/* ---------- Apparence ---------- */}
              <SectionApparence
                section={section}
                theme={theme}
                appearance={appearance}
                wall={wall}
                busy={busy}
                flash={flash}
                policeInput={policeInput}
                importerUnePolice={importerUnePolice}
                fondInput={fondInput}
                importerUnFond={importerUnFond}
                fondsPerso={fondsPerso}
                supprimerFond={supprimerFond}
                changerFond={changerFond}
              />

              {/* ---------- Bureau et barre des tâches ---------- */}
              <SectionBureau
                section={section}
                desktop={desktop}
                taskbar={taskbar}
                tailleIcones={tailleIcones}
                dispatch={dispatch}
                flash={flash}
              />

              {/* ---------- Applications ---------- */}
              <SectionApplications
                section={section}
                parCategorie={parCategorie}
                nomApp={nomApp}
                busy={busy}
                dispatch={dispatch}
                desinstaller={desinstaller}
              />

              {/* ---------- Stockage ---------- */}
              <SectionStockage
                section={section}
                usage={usage}
                pctStockage={pctStockage}
                dossiers={dossiers}
                dispatch={dispatch}
              />

              {/* ---------- Compte ---------- */}
              <SectionCompte
                section={section}
                session={session}
                busy={busy}
                changerPhoto={changerPhoto}
                retirerPhoto={retirerPhoto}
                nomProfil={nomProfil}
                setNomProfil={setNomProfil}
                enregistrerProfil={enregistrerProfil}
                mdp={mdp}
                setMdp={setMdp}
                changerMotDePasse={changerMotDePasse}
              />

              {/* ---------- Espace de travail ---------- */}
              <SectionEspace
                section={section}
                setSection={setSection}
                session={session}
                usage={usage}
                busy={busy}
                peutGerer={peutGerer}
                nomEspace={nomEspace}
                setNomEspace={setNomEspace}
                enregistrerEspace={enregistrerEspace}
                membres={membres}
                changerRole={changerRole}
                retirerMembre={retirerMembre}
                invitations={invitations}
                mailInvite={mailInvite}
                setMailInvite={setMailInvite}
                roleInvite={roleInvite}
                setRoleInvite={setRoleInvite}
                inviter={inviter}
                copierCode={copierCode}
                annulerInvitation={annulerInvitation}
              />

              {/* ---------- Journal d'activité ---------- */}
              <SectionJournal
                section={section}
                peutGerer={peutGerer}
                filtre={filtre}
                setFiltre={setFiltre}
                facettes={facettes}
                journal={journal}
                journalFini={journalFini}
                chargerJournal={chargerJournal}
              />

              {/* ---------- Formule et tarifs ---------- */}
              <SectionFormule
                section={section}
                fact={fact}
                prixDe={prixDe}
                estProprietaire={estProprietaire}
                busy={busy}
                changerFormule={changerFormule}
              />

              {/* ---------- Langue et région ---------- */}
              <SectionLangue
                section={section}
                langue={langue}
                appliquerLangueChoisie={appliquerLangueChoisie}
                devise={devise}
                appliquerDevise={appliquerDevise}
                fuseau={fuseau}
                appliquerFuseau={appliquerFuseau}
              />

              {/* ---------- À propos ---------- */}
              <SectionAPropos section={section} />

              {notice ? <div className="setNotice">{notice}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
