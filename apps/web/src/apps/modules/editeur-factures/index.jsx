import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { composerCourriel } from "../../courrielRequest";
import { choisirClient, choisirProduit } from "../../referentiel";
import { accesDonnees } from "../../donnees";
import { ensureRootFolder, saveAs } from "../../cloud";
import { ouvrirFenetre } from "../../windows";
import { referentiel } from "../../referentiel";
import { choisirFichierCloud } from "../../ChoisirFichier";
import { ouvrirParametres } from "../../parametresRequest";
import { chargerSignatures, useEntreprise } from "../../entreprise";
import { FicheEntreprise } from "../../entreprise/FicheEntreprise";
import { imageSignature } from "../signature/domaine";
import { ID_EDITEUR, prendreDemande, surDemande } from "../../editeurFacturesRequest";
import { montantDans } from "../../../utils/monnaie";
import { etatPaiement } from "@companyos/shared/facturation";
import {
  CONDITIONS,
  FREQUENCES,
  MODES_ENVOI,
  MOYENS_PAIEMENT,
  chiffres,
  dateSuivante,
  depuisFacturation,
  echeanceSelon,
  factureVide,
  idLigne,
  initiales,
  ligneVide,
  numeroSuivant,
  recurrencesDues,
  situationClient,
  today,
  verifier,
  versFacturation,
} from "./domaine";
import { MODELES, PALETTE, couleurDe } from "./modeles";
import { Apercu } from "./Apercu";
import { factureEnPdf } from "./pdf";
import { imagesPdf } from "./images";
import "./editeur.scss";

// ---------------------------------------------------------------------------
// Éditeur de factures
//
// La création d'une facture de bout en bout, avec son aperçu en direct :
// client du CRM, articles du catalogue du Stock, six modèles, paiement
// fractionné, facturation récurrente, envoi au client par le Courrier.
//
// Les factures sont rangées dans la Facturation (voir domaine.js) : elle en
// assure le suivi — règlements, relances, état de paiement —, le panneau
// « Aujourd'hui » du bureau les compte, le CRM les montre sur la fiche du
// client. L'éditeur, lui, garde seulement ses réglages par défaut
// (`emetteur` : modèle, couleur, conditions…) et les factures récurrentes
// (`recurrences`).
//
// Il ne réinvente rien de ce que l'OS sait déjà faire :
//   • l'identité de l'entreprise vient de la fiche partagée (Paramètres ›
//     Fiche de l'entreprise) — logo, cachet, NCC, RIB, signataire ;
//   • la signature manuscrite vient de l'application Signature ;
//   • les pièces jointes et le PDF passent par le Cloud (gestionnaire de
//     fichiers) ;
//   • clients du CRM, articles et niveaux de stock du Stock, règlements de
//     la Facturation pour la situation du client.
// ---------------------------------------------------------------------------

export const manifest = {
  id: ID_EDITEUR,
  slug: "editeur-factures",
  name: "Éditeur de factures",
  icon: "editeur-factures",
  version: "1.1.0",
  nouveautes: [
    { version: "1.1.0", texte: "Fiche de l'entreprise partagée, signature et cachet sur le PDF, pièces jointes du Cloud, vérifications en direct et raccourcis clavier." },
    { version: "1.0.0", texte: "Six modèles, aperçu en direct, paiement fractionné, factures récurrentes et envoi au client en PDF." },
  ],
  capacites: {
    lit: [
      "crm:clients",
      "stock:articles",
      "facturation:factures",
      "facturation:reglements",
      "entreprise:profil",
      "signature:signatures",
    ],
    ecrit: ["facturation:factures"],
  },
  action: "EDITEURFACTURESAPP",
  Window: EditeurFactures,
};

// Les données propres à l'app vivent sous son slug (l'API n'accepte que
// minuscules et tirets), pas sous l'identifiant de fenêtre.
const donnees = accesDonnees({ ...manifest, id: manifest.slug });

const LARGEUR_PAGE = 794;
const HAUTEUR_PAGE = 1123;

const TUILES = [
  { couleur: "#7C3AED", icone: "faWindowMaximize" },
  { couleur: "#059669", icone: "faPenNib" },
  { couleur: "#EA580C", icone: "faChartLine" },
  { couleur: "#0284C7", icone: "faBullhorn" },
  { couleur: "#DB2777", icone: "faTag" },
];

const ONGLETS_MODE = [
  { id: "standard", label: "Standard", icone: "faFileLines" },
  { id: "fractionne", label: "Paiement fractionné", icone: "faScissors" },
  { id: "recurrente", label: "Facture récurrente", icone: "faRotate" },
];

const cleBrouillon = (tenantId) => `companyos-editeur-factures:${tenantId || "local"}`;

const lireBrouillon = (cle) => {
  try {
    return JSON.parse(localStorage.getItem(cle) || "null");
  } catch {
    return null;
  }
};

/// Les champs d'identité qu'un ancien profil de l'éditeur gardait, avant
/// que la fiche de l'entreprise ne soit partagée : proposés en repli.
const IDENTITE_ANCIENNE = [
  "nom", "adresse", "ville", "pays", "email", "telephone", "ncc", "rccm",
  "banque", "titulaire", "iban", "mobileOperateur", "mobileNumero", "signataire", "mentions", "logo",
];

const estMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
const MOD = estMac ? "⌘" : "Ctrl";

// ---------------------------------------------------------------------------
// Petits composants de formulaire, à l'image de la maquette : l'étiquette
// en petit au-dessus de la valeur, dans un même cadre.
// ---------------------------------------------------------------------------

const Champ = ({ label, icone, children, action, erreur, champ }) => (
  <label className="efChamp" data-erreur={!!erreur || undefined} data-champ={champ}>
    <span className="efChampLabel">{label}</span>
    <span className="efChampValeur">
      {children}
      {action}
      {icone ? <Icon fafa={icone} width={13} /> : null}
    </span>
    {erreur ? <span className="efChampErreur" role="alert">{erreur}</span> : null}
  </label>
);

/// Un champ numérique qui ne change pas de valeur quand on fait défiler la
/// page par-dessus, et dont le contenu se sélectionne à l'entrée.
const Nombre = (props) => (
  <input
    type="number"
    inputMode="decimal"
    step="any"
    min="0"
    onWheel={(e) => e.currentTarget.blur()}
    onFocus={(e) => e.currentTarget.select()}
    {...props}
  />
);

const Menu = ({ ouvert, fermer, children, className = "" }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (!ouvert) return undefined;
    const surClic = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !ref.current?.parentElement?.contains(e.target)) fermer();
    };
    document.addEventListener("mousedown", surClic);
    document.addEventListener("keydown", surClic);
    return () => {
      document.removeEventListener("mousedown", surClic);
      document.removeEventListener("keydown", surClic);
    };
  }, [ouvert, fermer]);
  if (!ouvert) return null;
  return (
    <div ref={ref} className={`efMenu ${className}`} role="menu">
      {children}
    </div>
  );
};

const EntreeMenu = ({ icone, children, onClick, aide, desactive, raccourci }) => (
  <button type="button" role="menuitem" className="efMenuEntree" disabled={desactive} onClick={onClick}>
    {icone ? <Icon fafa={icone} width={13} /> : <span />}
    <span>
      {children}
      {aide ? <small>{aide}</small> : null}
    </span>
    {raccourci ? <kbd>{raccourci}</kbd> : null}
  </button>
);

/// Un volet latéral : boîte de dialogue au sens de l'accessibilité, qui
/// prend le focus à l'ouverture et se ferme avec Échap.
const Volet = ({ titre, onFermer, children, large = false, actions = null }) => {
  const ref = useRef(null);
  useEffect(() => {
    const premier = ref.current?.querySelector("input, select, textarea, button:not(.efFermerVolet)");
    (premier || ref.current)?.focus();
  }, []);

  // Échap ferme le volet même quand le focus est retombé sur la page (un
  // bouton qui vient de se désactiver le rend au document) — mais jamais
  // par-dessus une boîte de dialogue ouverte.
  const fermerRef = useRef(onFermer);
  fermerRef.current = onFermer;
  useEffect(() => {
    const surTouche = (e) => {
      if (e.key !== "Escape" || document.querySelector(".cosModalBack")) return;
      if (e.target === document.body || ref.current?.contains(e.target)) fermerRef.current();
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, []);
  return (
    <aside
      ref={ref}
      className="efPanneau"
      data-large={large || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={titre}
      tabIndex={-1}
    >
      <div className="efPanneauTete">
        <h3>{titre}</h3>
        {actions}
        <button type="button" className="efIconeBouton efFermerVolet" aria-label="Fermer" onClick={onFermer}>
          <Icon fafa="faXmark" width={12} />
        </button>
      </div>
      <div className="efPanneauCorps cosScroll">{children}</div>
    </aside>
  );
};

// ---------------------------------------------------------------------------
// L'application
// ---------------------------------------------------------------------------

function EditeurFactures() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const cle = cleBrouillon(session.tenant?.id);
  const estAdmin = ["OWNER", "ADMIN"].includes(session.user?.role);

  const [facture, setFacture] = useState(() => factureVide());
  const [ficheId, setFicheId] = useState(null);
  const [ficheOrigine, setFicheOrigine] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [reglements, setReglements] = useState([]);
  const [emetteur, setEmetteur] = useState(null);
  const [recurrences, setRecurrences] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const [stocks, setStocks] = useState({});
  const [charge, setCharge] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null);
  const [menu, setMenu] = useState(null);
  const [panneau, setPanneau] = useState(null);
  const [pleinEcran, setPleinEcran] = useState(false);
  const [echelle, setEchelle] = useState(0.6);
  const [modifie, setModifie] = useState(false);
  const [tentative, setTentative] = useState(false);
  const [brouillonLocal, setBrouillonLocal] = useState(null);
  const [vue, setVue] = useState("formulaire");
  const [recherche, setRecherche] = useState("");

  const coquille = useRef(null);
  const zoneApercu = useRef(null);
  const pageRef = useRef(null);
  const glisse = useRef(null);
  const aFocaliser = useRef(null);

  const { entreprise } = useEntreprise(ouvert);

  /// Réglages par défaut de l'éditeur (modèle, couleur, conditions…).
  const profil = useMemo(
    () => emetteur?.data || { nom: session.tenant?.name || "" },
    [emetteur, session.tenant?.name],
  );

  /// L'identité qu'avait l'ancien profil de l'éditeur : proposée pour
  /// préremplir la fiche partagée tant qu'elle n'existe pas.
  const repliIdentite = useMemo(() => {
    const d = emetteur?.data;
    if (!d) return null;
    const garde = Object.fromEntries(IDENTITE_ANCIENNE.filter((k) => d[k]).map((k) => [k, d[k]]));
    return Object.keys(garde).length > 1 ? garde : null;
  }, [emetteur]);

  /// L'émetteur tel qu'il paraît sur la facture : la fiche de l'entreprise,
  /// sa signature dessinée dans l'application Signature.
  const emetteurDoc = useMemo(() => {
    const base = { nom: session.tenant?.name || "", ...(entreprise || repliIdentite || {}) };
    const signature = signatures.find((x) => x.id === base.signatureId);
    return {
      ...base,
      signatureImage: signature ? imageSignature(signature.data) : emetteur?.data?.signatureImage || "",
    };
  }, [entreprise, repliIdentite, signatures, session.tenant?.name, emetteur]);

  const minuteurMessage = useRef(null);
  const flash = (texte, ton = "ok", action = null) => {
    setMessage({ texte, ton, action });
    window.clearTimeout(minuteurMessage.current);
    minuteurMessage.current = window.setTimeout(() => setMessage(null), ton === "erreur" ? 12000 : action ? 9000 : 6000);
  };

  // ---- Chargement ---------------------------------------------------------

  const charger = useCallback(async () => {
    const [docs, regs, profils, recs, sigs] = await Promise.all([
      donnees.lire("facturation", "factures").catch(() => []),
      donnees.lire("facturation", "reglements").catch(() => []),
      donnees.lire("emetteur").catch(() => []),
      donnees.lire("recurrences").catch(() => []),
      chargerSignatures(),
    ]);
    setDocuments(docs);
    setReglements(regs);
    setEmetteur(profils[0] || null);
    setRecurrences(recs);
    setSignatures(sigs);
    return { docs, profil: profils[0] || null };
  }, []);

  /// Ouvre une fiche de la Facturation dans l'éditeur.
  const ouvrirFiche = useCallback((fiche, reglages) => {
    setFacture(depuisFacturation(fiche.data, reglages));
    setFicheId(fiche.id);
    setFicheOrigine(fiche);
    setModifie(false);
    setTentative(false);
    setPanneau(null);
  }, []);

  /// Changer de facture alors que celle-ci a des modifications : on demande.
  const confirmerAbandon = async () =>
    !modifie || modal.confirm({
      title: "Abandonner les modifications ?",
      message: `Les changements apportés à ${facture.numero || "cette facture"} ne sont pas enregistrés.`,
      confirmLabel: "Abandonner",
      danger: true,
    });

  const traiterDemande = useCallback(async (demande, docs, reglages) => {
    if (!demande) return false;
    if (demande.id) {
      const liste = docs || (await donnees.lire("facturation", "factures"));
      const fiche = liste.find((d) => d.id === demande.id);
      if (fiche) { ouvrirFiche(fiche, reglages); return true; }
    }
    if (demande.client) {
      const c = demande.client;
      const base = factureVide(reglages);
      setFacture({
        ...base,
        numero: numeroSuivant(docs || documents, base.date),
        clientId: c.id,
        clientNom: c.data?.nom || "",
        clientEntreprise: c.data?.entreprise || "",
        clientEmail: c.data?.email || "",
        clientVille: c.data?.ville || "",
        clientTelephone: c.data?.telephone || "",
      });
      setFicheId(null);
      setFicheOrigine(null);
      setModifie(true);
      return true;
    }
    return false;
  }, [documents, ouvrirFiche]);

  useEffect(() => {
    if (!ouvert || charge) return;
    setCharge(true);
    charger().then(async ({ docs, profil: p }) => {
      const reglages = p?.data || {};
      if (await traiterDemande(prendreDemande(), docs, reglages)) return;
      // Le travail en cours survit à une fermeture de fenêtre ou à un
      // rechargement de page : on le reprend tel quel.
      const brouillon = lireBrouillon(cle);
      if (brouillon?.facture) {
        setFacture(brouillon.facture);
        setFicheId(brouillon.ficheId || null);
        setFicheOrigine(brouillon.ficheOrigine || null);
        setModifie(!!brouillon.modifie);
        if (brouillon.modifie) setBrouillonLocal(brouillon.le || null);
        return;
      }
      const base = factureVide(reglages);
      setFacture({ ...base, numero: numeroSuivant(docs, base.date) });
    }).catch((e) => flash(e.message, "erreur"));
  }, [ouvert, charge, charger, traiterDemande, cle]);

  // Une demande venue d'une autre app (la Facturation, le CRM) alors que
  // la fenêtre est ouverte : on ne jette pas un travail en cours sans le dire.
  const confirmerAbandonRef = useRef(confirmerAbandon);
  confirmerAbandonRef.current = confirmerAbandon;
  useEffect(() => surDemande(async (d) => {
    if (await confirmerAbandonRef.current()) traiterDemande(d, null, profil);
  }), [traiterDemande, profil]);

  // Sauvegarde du travail en cours sur ce poste, une demi-seconde après la
  // dernière frappe.
  useEffect(() => {
    if (!charge) return undefined;
    const t = window.setTimeout(() => {
      try {
        const le = new Date().toISOString();
        localStorage.setItem(cle, JSON.stringify({ facture, ficheId, ficheOrigine, modifie, le }));
        if (modifie) setBrouillonLocal(le);
      } catch {
        /* stockage plein ou interdit : le travail reste à l'écran */
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [facture, ficheId, ficheOrigine, modifie, charge, cle]);

  // L'aperçu suit la largeur de sa colonne.
  useEffect(() => {
    const zone = zoneApercu.current;
    if (!zone) return undefined;
    const mesurer = () => setEchelle(Math.max(0.2, Math.min(1, (zone.clientWidth - 56) / LARGEUR_PAGE)));
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(zone);
    return () => obs.disconnect();
  }, [ouvert]);

  // Niveau de stock des articles venus du catalogue.
  const articlesSuivis = facture.lignes.map((l) => l.articleId).filter(Boolean).join(",");
  useEffect(() => {
    if (!ouvert || !articlesSuivis) return;
    const manquants = articlesSuivis.split(",").filter((id) => !(id in stocks));
    if (!manquants.length) return;
    Promise.all(manquants.map((id) => referentiel.stockDe(id).catch(() => null)))
      .then((niveaux) => setStocks((s) => ({ ...s, ...Object.fromEntries(manquants.map((id, i) => [id, niveaux[i]])) })));
  }, [ouvert, articlesSuivis, stocks]);

  // Une ligne ajoutée prend le focus : on tape son nom aussitôt.
  useEffect(() => {
    if (!aFocaliser.current) return;
    const champ = coquille.current?.querySelector(`[data-ligne="${aFocaliser.current}"] .efNom`);
    aFocaliser.current = null;
    champ?.focus();
  });

  // ---- Modifications ----------------------------------------------------------

  const maj = (patch) => {
    setModifie(true);
    setFacture((f) => ({ ...f, ...(typeof patch === "function" ? patch(f) : patch) }));
  };

  const majLigne = (id, patch) =>
    maj((f) => ({ lignes: f.lignes.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  const retirerLigne = (id) => {
    const index = facture.lignes.findIndex((l) => l.id === id);
    const ligne = facture.lignes[index];
    maj((f) => ({ lignes: f.lignes.length > 1 ? f.lignes.filter((l) => l.id !== id) : [ligneVide()] }));
    if (ligne && (String(ligne.designation || "").trim() || Number(ligne.pu))) {
      flash(`« ${ligne.designation || "Article"} » retiré.`, "info", {
        libelle: "Annuler",
        faire: () => maj((f) => {
          const lignes = f.lignes.filter((l) => String(l.designation || "").trim() || Number(l.pu));
          lignes.splice(Math.min(index, lignes.length), 0, ligne);
          return { lignes };
        }),
      });
    }
  };

  const dupliquerLigne = (id) =>
    maj((f) => {
      const i = f.lignes.findIndex((l) => l.id === id);
      const copie = { ...f.lignes[i], id: idLigne() };
      aFocaliser.current = copie.id;
      return { lignes: [...f.lignes.slice(0, i + 1), copie, ...f.lignes.slice(i + 1)] };
    });

  const deplacerLigne = (de, vers) =>
    maj((f) => {
      if (vers < 0 || vers >= f.lignes.length) return {};
      const lignes = [...f.lignes];
      const [l] = lignes.splice(de, 1);
      lignes.splice(vers, 0, l);
      return { lignes };
    });

  const choisirLeClient = async () => {
    const c = await choisirClient({ titre: "Client à facturer" });
    if (!c) return;
    maj({
      clientId: c.id,
      clientNom: c.data.nom || "",
      clientEntreprise: c.data.entreprise || "",
      clientEmail: c.data.email || "",
      clientVille: c.data.ville || "",
      clientTelephone: c.data.telephone || "",
    });
  };

  const ajouterArticle = async (source) => {
    setMenu(null);
    if (source === "catalogue") {
      const p = await choisirProduit({ titre: "Ajouter un article du catalogue" });
      if (!p) return;
      const ligne = {
        id: idLigne(),
        articleId: p.id,
        designation: p.data.designation || "",
        description: p.data.reference ? `Réf. ${p.data.reference}` : "",
        qte: 1,
        pu: Number(p.data.prixVente) || 0,
        tva: Number(p.data.tva ?? 18) || 0,
      };
      // Une première ligne encore vide est remplacée plutôt que laissée.
      maj((f) => ({
        lignes: f.lignes.length === 1 && !f.lignes[0].designation && !Number(f.lignes[0].pu)
          ? [ligne]
          : [...f.lignes, ligne],
      }));
      return;
    }
    const ligne = ligneVide();
    aFocaliser.current = ligne.id;
    maj((f) => ({ lignes: [...f.lignes, ligne] }));
  };

  const changerConditions = (conditions) =>
    maj((f) => ({ conditions, echeance: echeanceSelon(conditions, f.date) }));

  const changerDate = (date) =>
    maj((f) => ({ date, echeance: f.conditions ? echeanceSelon(f.conditions, date) : f.echeance }));

  const majEcheance = (id, patch) =>
    maj((f) => ({ echeancier: f.echeancier.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const genererNumero = () => maj((f) => ({ numero: numeroSuivant(documents, f.date) }));

  const nouvelle = async () => {
    setMenu(null);
    if (!(await confirmerAbandon())) return;
    const base = factureVide(profil);
    setFacture({ ...base, numero: numeroSuivant(documents, base.date) });
    setFicheId(null);
    setFicheOrigine(null);
    setModifie(false);
    setTentative(false);
    setBrouillonLocal(null);
    try { localStorage.removeItem(cle); } catch { /* rien à faire */ }
  };

  // ---- Pièces jointes (Cloud) -------------------------------------------------

  const joindre = async () => {
    setMenu(null);
    const noeuds = await choisirFichierCloud({ titre: "Joindre des fichiers du Cloud", plusieurs: true });
    if (!noeuds) return;
    maj((f) => {
      const deja = new Set((f.pieces || []).map((p) => p.id));
      return { pieces: [...(f.pieces || []), ...noeuds.filter((n) => !deja.has(n.id)).map((n) => ({ id: n.id, nom: n.name }))] };
    });
  };

  // ---- Vérifications ------------------------------------------------------------

  const verifications = useMemo(() => verifier(facture), [facture]);
  const erreurDe = (champ) => (tentative ? verifications.find((v) => v.champ === champ)?.message : undefined);

  /// Amène l'utilisateur au premier point à corriger.
  const allerAuProbleme = (liste = verifications) => {
    setVue("formulaire");
    const champ = liste[0]?.champ;
    if (!champ) return;
    window.requestAnimationFrame(() => {
      const zone = coquille.current?.querySelector(`[data-champ="${champ}"]`);
      zone?.scrollIntoView({ block: "center", behavior: "smooth" });
      (zone?.matches("button, input, select") ? zone : zone?.querySelector("input, select, textarea, button"))?.focus({ preventScroll: true });
    });
  };

  // ---- Enregistrement et envoi ----------------------------------------------

  const enregistrer = async ({ envoi = facture.envoi } = {}) => {
    setMenu(null);
    if (occupe) return null;
    const liste = verifier({ ...facture, envoi });
    if (liste.length) {
      setTentative(true);
      flash(liste.length > 1 ? `${liste.length} points à corriger avant d'enregistrer.` : liste[0].message, "erreur");
      allerAuProbleme(liste);
      return null;
    }
    // Deux factures ne portent jamais le même numéro : la comptabilité le
    // refuserait, et le client paierait l'une pour l'autre.
    const doublon = documents.find((d) => d.id !== ficheId && d.data?.type === "facture" && d.data?.numero === facture.numero);
    if (doublon) {
      flash(`Le numéro ${facture.numero} est déjà pris.`, "erreur", { libelle: "Prendre le suivant", faire: genererNumero });
      allerAuProbleme([{ champ: "numero" }]);
      return null;
    }

    setOccupe(true);
    try {
      const statut = envoi === "brouillon" ? "brouillon" : "envoye";
      const data = versFacturation({ ...facture, statut }, ficheOrigine?.data);
      const fiche = ficheId
        ? await donnees.modifier("facturation", "factures", ficheId, data)
        : await donnees.creer("facturation", "factures", data);

      // La première facture d'une série récurrente arme la récurrence.
      if (!ficheId && facture.mode === "recurrente") {
        const { numero: _n, date: _d, echeance: _e, statut: _s, ...modeleRecurrent } = data;
        await donnees.creer("recurrences", {
          modele: modeleRecurrent,
          client: facture.clientEntreprise || facture.clientNom,
          total: chiffres(facture).total,
          devise: facture.devise,
          frequence: facture.recurrence.frequence,
          fin: facture.recurrence.fin || "",
          jourOrigine: Number(facture.date.slice(8, 10)),
          prochaine: dateSuivante(facture.date, facture.recurrence.frequence),
          derniere: facture.numero,
          actif: true,
        });
      }

      setFicheId(fiche.id);
      setFicheOrigine(fiche);
      setModifie(false);
      setTentative(false);
      setBrouillonLocal(null);
      await charger();

      if (envoi === "immediat") {
        await envoyerAuClient();
      } else {
        flash(`Facture ${facture.numero} enregistrée${statut === "brouillon" ? " en brouillon" : ""} — elle est suivie dans la Facturation.`, "ok", {
          libelle: "Ouvrir la Facturation",
          faire: () => ouvrirFenetre("facturation"),
        });
      }
      return fiche;
    } catch (e) {
      flash(e.message, "erreur");
      return null;
    } finally {
      setOccupe(false);
    }
  };

  /// Le PDF dans le modèle choisi, logo, cachet et signature compris.
  const fabriquerPdf = async () => factureEnPdf(facture, emetteurDoc, await imagesPdf(facture, emetteurDoc));

  /// Le PDF rangé dans le dossier Facturation du cloud, puis un courriel
  /// prérempli dans le Courrier, pièces jointes comprises : l'utilisateur
  /// relit avant d'envoyer, une app n'écrit jamais dans son dos.
  const envoyerAuClient = async () => {
    const blob = await fabriquerPdf();
    const dossier = await ensureRootFolder("Facturation");
    const noeud = await api.uploadFile(new File([blob], `${facture.numero}.pdf`, { type: "application/pdf" }), dossier);
    const total = montantDans(chiffres(facture).total, facture.devise);
    const signataire = emetteurDoc.signataire || session.user?.name || "";
    composerCourriel({
      a: facture.clientEmail || "",
      sujet: `Facture ${facture.numero} — ${emetteurDoc.nom || session.tenant?.name || ""}`.trim(),
      texte:
        `Bonjour${facture.clientNom ? ` ${facture.clientNom}` : ""},\n\n` +
        `Veuillez trouver ci-joint notre facture ${facture.numero} d'un montant de ${total}, ` +
        `à régler avant le ${new Date(`${facture.echeance}T00:00:00`).toLocaleDateString("fr-FR")}.\n\n` +
        `${facture.notes ? `${facture.notes}\n\n` : ""}Cordialement,\n${signataire}` +
        `${emetteurDoc.fonctionSignataire ? `\n${emetteurDoc.fonctionSignataire}` : ""}\n${emetteurDoc.nom || ""}` +
        `${emetteurDoc.telephone ? `\n${emetteurDoc.telephone}` : ""}`,
      pieces: [
        ...(noeud?.id ? [{ id: noeud.id, nom: noeud.name || `${facture.numero}.pdf` }] : []),
        ...(facture.pieces || []),
      ],
    });
    flash(`Facture ${facture.numero} prête à partir : relisez le courriel dans le Courrier, puis envoyez.`);
  };

  const telechargerPdf = async () => {
    setMenu(null);
    try {
      const url = URL.createObjectURL(await fabriquerPdf());
      const a = Object.assign(document.createElement("a"), { href: url, download: `${facture.numero || "facture"}.pdf` });
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      flash(e.message, "erreur");
    }
  };

  const pdfDansCloud = async () => {
    setMenu(null);
    try {
      const noeud = await saveAs(await fabriquerPdf(), `${facture.numero || "facture"}.pdf`, { folder: "Facturation" });
      if (noeud) flash(`PDF enregistré dans le Cloud : ${noeud.name}.`);
    } catch (e) {
      flash(e.message, "erreur");
    }
  };

  /// Imprime la page telle qu'elle s'affiche, et elle seule.
  const imprimer = () => {
    setMenu(null);
    const page = pageRef.current;
    if (!page) return;
    const cadre = document.createElement("iframe");
    cadre.setAttribute("aria-hidden", "true");
    Object.assign(cadre.style, { position: "fixed", width: "0", height: "0", border: "0" });
    document.body.appendChild(cadre);
    const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join("");
    const doc = cadre.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${facture.numero}</title>${styles}
      <style>@page { size: A4; margin: 0; } html, body { margin: 0; background: #fff; }
      .efPage { box-shadow: none !important; border: 0 !important; border-radius: 0 !important; }</style>
      </head><body>${page.outerHTML}</body></html>`);
    doc.close();
    window.setTimeout(() => {
      cadre.contentWindow.focus();
      cadre.contentWindow.print();
      window.setTimeout(() => cadre.remove(), 1000);
    }, 300);
  };

  const dupliquer = () => {
    setMenu(null);
    setFacture((f) => ({
      ...f,
      numero: numeroSuivant(documents, today()),
      date: today(),
      echeance: echeanceSelon(f.conditions, today()),
      lignes: f.lignes.map((l) => ({ ...l, id: idLigne() })),
    }));
    setFicheId(null);
    setFicheOrigine(null);
    setModifie(true);
    flash("Copie prête : c'est une nouvelle facture, avec son propre numéro.");
  };

  // ---- Raccourcis clavier ---------------------------------------------------------

  const surTouche = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      if (pleinEcran) { setPleinEcran(false); return; }
      if (panneau) { setPanneau(null); return; }
    }
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      // Ctrl+S range sans rien envoyer : une nouvelle facture en
      // brouillon, une facture existante dans son état actuel.
      enregistrer({ envoi: ficheOrigine?.data?.statut === "envoye" ? "envoyee" : "brouillon" });
    } else if (mod && e.key === "Enter") {
      e.preventDefault();
      enregistrer();
    } else if (mod && e.key.toLowerCase() === "p") {
      e.preventDefault();
      imprimer();
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // Réordonner au clavier la ligne où l'on se trouve.
      const ligne = e.target.closest?.("[data-ligne]");
      if (!ligne) return;
      e.preventDefault();
      const i = facture.lignes.findIndex((l) => l.id === ligne.dataset.ligne);
      deplacerLigne(i, i + (e.key === "ArrowUp" ? -1 : 1));
      aFocaliserChamp(ligne.dataset.ligne, e.target.getAttribute("aria-label"));
    }
  };

  const aFocaliserChamp = (idLigneCible, label) => {
    window.requestAnimationFrame(() => {
      coquille.current?.querySelector(`[data-ligne="${idLigneCible}"] [aria-label="${label}"]`)?.focus();
    });
  };

  // ---- Factures récurrentes ---------------------------------------------------

  const dues = useMemo(() => recurrencesDues(recurrences), [recurrences]);

  /// Prépare, en brouillon, les factures des récurrences arrivées à
  /// échéance — à relire et envoyer depuis la Facturation ou d'ici.
  const genererRecurrentes = async (liste = dues) => {
    setOccupe(true);
    let docs = documents;
    let n = 0;
    try {
      for (const r of liste) {
        const d = r.data;
        let prochaine = d.prochaine;
        // Une récurrence en retard de plusieurs périodes rattrape chacune.
        while (prochaine <= today() && (!d.fin || prochaine <= d.fin)) {
          const numero = numeroSuivant(docs, prochaine);
          const cree = await donnees.creer("facturation", "factures", {
            ...d.modele,
            numero,
            date: prochaine,
            echeance: echeanceSelon(d.modele.conditions || "net30", prochaine),
            statut: "brouillon",
          });
          docs = [...docs, cree];
          n += 1;
          prochaine = dateSuivante(prochaine, d.frequence, d.jourOrigine);
        }
        await donnees.modifier("recurrences", r.id, { ...d, prochaine, derniere: docs[docs.length - 1]?.data?.numero || d.derniere });
      }
      await charger();
      flash(n ? `${n} facture${n > 1 ? "s" : ""} récurrente${n > 1 ? "s" : ""} préparée${n > 1 ? "s" : ""} en brouillon.` : "Aucune facture à préparer.");
    } catch (e) {
      flash(e.message, "erreur");
    } finally {
      setOccupe(false);
    }
  };

  const basculerRecurrence = async (r) => {
    await donnees.modifier("recurrences", r.id, { ...r.data, actif: r.data.actif === false });
    await charger();
  };

  const supprimerRecurrence = async (r) => {
    const ok = await modal.confirm({
      title: "Arrêter cette facturation récurrente ?",
      message: `Les factures déjà émises pour ${r.data.client || "ce client"} restent dans la Facturation.`,
      confirmLabel: "Arrêter",
      danger: true,
    });
    if (!ok) return;
    await donnees.supprimer("recurrences", r.id);
    await charger();
  };

  // ---- Design par défaut -------------------------------------------------------

  const enregistrerDesignParDefaut = async () => {
    const suite = { ...profil, modele: facture.modele, couleur: facture.couleur };
    try {
      if (emetteur) await donnees.modifier("emetteur", emetteur.id, suite);
      else await donnees.creer("emetteur", suite);
      await charger();
      flash("Ce design sera celui de vos prochaines factures.");
    } catch (e) {
      flash(e.message, "erreur");
    }
  };

  const ouvrirFicheEntreprise = () => {
    setMenu(null);
    setPanneau("profil");
  };

  // ---- Rendu ----------------------------------------------------------------------

  const c = chiffres(facture);
  const argent = (n) => montantDans(n, facture.devise);
  const mode = MODES_ENVOI.find((m) => m.id === facture.envoi) || MODES_ENVOI[0];
  const libelleEnregistrer = {
    immediat: "Enregistrer et envoyer au client",
    envoyee: "Enregistrer comme envoyée",
    brouillon: "Enregistrer le brouillon",
  }[facture.envoi];
  const sommeEcheancier = facture.echeancier.reduce((s, e) => s + (Number(e.pourcentage) || 0), 0);
  const factures = documents
    .filter((d) => d.data?.type === "facture")
    .sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)));
  const facturesVisibles = factures.filter((d) => {
    const q = recherche.trim().toLowerCase();
    if (!q) return true;
    return [d.data.numero, d.data.clientEntreprise, d.data.clientNom].some((v) => String(v || "").toLowerCase().includes(q));
  });
  const situation = situationClient(facture.clientId, documents, reglements, ficheId);
  const statutFiche = ficheOrigine?.data?.statut;
  const etatFiche = ficheOrigine ? etatPaiement(ficheOrigine, reglements) : null;
  const manquesEntreprise = [
    !emetteurDoc.adresse && "l'adresse",
    !emetteurDoc.ncc && "le NCC",
    !emetteurDoc.logo && "le logo",
  ].filter(Boolean);

  if (!ouvert) return <ModuleWindow manifest={manifest} className="efApp" />;

  return (
    <ModuleWindow manifest={manifest} className="efApp">
      <div className="efShell" ref={coquille} onKeyDown={surTouche} data-vue={vue}>
        {/* ------------------------------------------------ En-tête */}
        <header className="efEntete">
          <div className="efEnteteTitre">
            <h1>{ficheId ? `Facture ${facture.numero}` : "Créer une facture"}</h1>
            <p className="efEtat" aria-live="polite">
              {ficheId ? (
                <span className="efPuce" data-ton={etatFiche?.ton || "idle"}>
                  {statutFiche === "brouillon" ? "Brouillon" : etatFiche?.label || "Enregistrée"}
                </span>
              ) : (
                <span className="efPuce" data-ton="idle">Nouvelle</span>
              )}
              <span>
                {modifie
                  ? brouillonLocal
                    ? "Modifications gardées sur cet appareil, pas encore enregistrées"
                    : "Modifications non enregistrées"
                  : ficheId
                    ? "Enregistrée dans la Facturation"
                    : "Créez et personnalisez des factures professionnelles pour vos clients."}
              </span>
            </p>
          </div>
          <div className="efEnteteActions">
            {verifications.length && (tentative || modifie) ? (
              <button type="button" className="efVerif" data-ton="attention" onClick={() => { setTentative(true); allerAuProbleme(); }}>
                <Icon fafa="faListCheck" width={12} />
                <span>{verifications.length} point{verifications.length > 1 ? "s" : ""} à compléter</span>
              </button>
            ) : !verifications.length ? (
              <span className="efVerif" data-ton="ok">
                <Icon fafa="faCircleCheck" width={12} />
                <span>Prête</span>
              </span>
            ) : null}

            <div className="efGroupeBoutons">
              <button type="button" className="efBouton" onClick={() => setPleinEcran(true)}>
                <Icon fafa="faEye" width={13} />
                <span>Aperçu</span>
              </button>
              <button type="button" className="efBouton" data-actif={panneau === "design"} aria-pressed={panneau === "design"} onClick={() => setPanneau(panneau === "design" ? null : "design")}>
                <Icon fafa="faPenToSquare" width={13} />
                <span>Modifier le design</span>
              </button>
            </div>

            <div className="efSplit">
              <button type="button" className="efPrincipal" disabled={occupe} onClick={() => enregistrer()} title={`${MOD}+Entrée`}>
                {occupe ? "Enregistrement…" : libelleEnregistrer}
              </button>
              <button
                type="button"
                className="efPrincipal efPrincipalFleche"
                aria-label="Autres façons d'enregistrer"
                aria-haspopup="menu"
                aria-expanded={menu === "enregistrer"}
                onClick={() => setMenu(menu === "enregistrer" ? null : "enregistrer")}
              >
                <Icon fafa="faChevronDown" width={10} />
              </button>
              <Menu ouvert={menu === "enregistrer"} fermer={() => setMenu(null)} className="efMenuDroite">
                <EntreeMenu icone="faPaperPlane" onClick={() => enregistrer({ envoi: "immediat" })} aide="PDF au modèle choisi, courriel prérempli dans le Courrier">
                  Enregistrer et envoyer au client
                </EntreeMenu>
                <EntreeMenu icone="faCircleCheck" onClick={() => enregistrer({ envoi: "envoyee" })} aide="Remise en main propre ou par un autre canal">
                  Enregistrer comme envoyée
                </EntreeMenu>
                <EntreeMenu icone="faFloppyDisk" onClick={() => enregistrer({ envoi: "brouillon" })} raccourci={`${MOD}+S`}>
                  Enregistrer en brouillon
                </EntreeMenu>
                <hr />
                <EntreeMenu icone="faFilePdf" onClick={telechargerPdf}>Télécharger le PDF</EntreeMenu>
                <EntreeMenu icone="faCloudArrowUp" onClick={pdfDansCloud} aide="Choisir le dossier dans le gestionnaire de fichiers">
                  Enregistrer le PDF dans le Cloud…
                </EntreeMenu>
                <EntreeMenu icone="faPrint" onClick={imprimer} raccourci={`${MOD}+P`}>Imprimer</EntreeMenu>
                <EntreeMenu icone="faClone" onClick={dupliquer}>Dupliquer en nouvelle facture</EntreeMenu>
              </Menu>
            </div>

            <div className="efPlusZone">
              <button
                type="button"
                className="efBouton efCarre"
                aria-label="Plus d'actions"
                aria-haspopup="menu"
                aria-expanded={menu === "plus"}
                onClick={() => setMenu(menu === "plus" ? null : "plus")}
              >
                <Icon fafa="faEllipsisVertical" width={13} />
                {dues.length ? <span className="efPastille">{dues.length}</span> : null}
              </button>
              <Menu ouvert={menu === "plus"} fermer={() => setMenu(null)} className="efMenuDroite">
                <EntreeMenu icone="faFileCirclePlus" onClick={nouvelle}>Nouvelle facture</EntreeMenu>
                <EntreeMenu icone="faFolderOpen" onClick={() => { setMenu(null); setRecherche(""); setPanneau("ouvrir"); }}>
                  Ouvrir une facture existante
                </EntreeMenu>
                <EntreeMenu
                  icone="faRotate"
                  onClick={() => { setMenu(null); setPanneau("recurrences"); }}
                  aide={dues.length ? `${dues.length} à préparer aujourd'hui` : `${recurrences.length} en cours`}
                >
                  Factures récurrentes
                </EntreeMenu>
                <EntreeMenu icone="faIdCard" onClick={ouvrirFicheEntreprise} aide="Logo, cachet, signature, NCC, coordonnées bancaires">
                  Fiche de l'entreprise
                </EntreeMenu>
                <hr />
                <EntreeMenu icone="faFileInvoice" onClick={() => { setMenu(null); ouvrirFenetre("facturation"); }} aide="Règlements, relances, état de paiement">
                  Ouvrir la Facturation
                </EntreeMenu>
                <EntreeMenu icone="faKeyboard" onClick={() => { setMenu(null); setPanneau("raccourcis"); }}>
                  Raccourcis clavier
                </EntreeMenu>
              </Menu>
            </div>
          </div>
        </header>

        {message ? (
          <div className="efMessage" data-ton={message.ton} role={message.ton === "erreur" ? "alert" : "status"}>
            <Icon fafa={message.ton === "erreur" ? "faCircleExclamation" : message.ton === "info" ? "faCircleInfo" : "faCircleCheck"} width={13} />
            <span>{message.texte}</span>
            {message.action ? (
              <button type="button" className="efLien" onClick={() => { message.action.faire(); setMessage(null); }}>
                {message.action.libelle}
              </button>
            ) : null}
            <button type="button" aria-label="Fermer le message" onClick={() => setMessage(null)}><Icon fafa="faXmark" width={11} /></button>
          </div>
        ) : null}

        {dues.length && panneau !== "recurrences" ? (
          <div className="efMessage" data-ton="info">
            <Icon fafa="faRotate" width={13} />
            <span>{dues.length} facture{dues.length > 1 ? "s" : ""} récurrente{dues.length > 1 ? "s" : ""} à préparer aujourd'hui.</span>
            <button type="button" className="efLien" disabled={occupe} onClick={() => genererRecurrentes()}>Préparer maintenant</button>
          </div>
        ) : null}

        {!entreprise && charge ? (
          <div className="efMessage" data-ton="info">
            <Icon fafa="faIdCard" width={13} />
            <span>
              {estAdmin
                ? "Complétez la fiche de l'entreprise : logo, adresse, NCC et RIB figureront sur toutes vos factures."
                : "La fiche de l'entreprise n'est pas encore remplie : demandez-le à un administrateur."}
            </span>
            {estAdmin ? <button type="button" className="efLien" onClick={ouvrirFicheEntreprise}>Compléter</button> : null}
          </div>
        ) : null}

        {/* Bascule Formulaire / Aperçu, quand la fenêtre est trop étroite pour les deux. */}
        <div className="efBascule2" role="tablist" aria-label="Affichage">
          <button type="button" role="tab" aria-selected={vue === "formulaire"} onClick={() => setVue("formulaire")}>
            <Icon fafa="faPenToSquare" width={12} /> Formulaire
          </button>
          <button type="button" role="tab" aria-selected={vue === "apercu"} onClick={() => setVue("apercu")}>
            <Icon fafa="faEye" width={12} /> Aperçu
          </button>
        </div>

        <div className="efCorps">
          {/* ------------------------------------------------ Formulaire */}
          <div className="efFormulaire cosScroll">
            <section className="efSection" aria-labelledby="ef-t-client">
              <h2 id="ef-t-client">Informations client</h2>
              <div className="efGrille2">
                <div className="efClientBloc" data-champ="client">
                  <button type="button" className="efClient" data-erreur={!!erreurDe("client") || undefined} onClick={choisirLeClient} aria-describedby={erreurDe("client") ? "ef-err-client" : undefined}>
                    {facture.clientNom || facture.clientEntreprise ? (
                      <>
                        <span className="efAvatar" style={{ background: couleurDe(facture) }}>
                          {initiales(facture.clientEntreprise || facture.clientNom)}
                        </span>
                        <span className="efClientTexte">
                          <b>{facture.clientEntreprise || facture.clientNom}</b>
                          <small>{facture.clientEmail || facture.clientNom || "Sans adresse e-mail"}</small>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="efAvatar efAvatarVide"><Icon fafa="faUserPlus" width={13} /></span>
                        <span className="efClientTexte">
                          <b>Choisir un client</b>
                          <small>Depuis le fichier clients du CRM</small>
                        </span>
                      </>
                    )}
                    <Icon fafa="faChevronDown" width={11} />
                  </button>
                  {erreurDe("client") ? <span className="efChampErreur" id="ef-err-client" role="alert">{erreurDe("client")}</span> : null}
                  {situation?.nb ? (
                    <span className="efSituation" data-ton={situation.retard ? "retard" : "info"}>
                      <Icon fafa={situation.retard ? "faTriangleExclamation" : "faCircleInfo"} width={11} />
                      {situation.nb} facture{situation.nb > 1 ? "s" : ""} non soldée{situation.nb > 1 ? "s" : ""} · {argent(situation.reste)}
                      {situation.retard ? ` · ${situation.retard} en retard` : ""}
                    </span>
                  ) : null}
                </div>
                <Champ label="Modèle de facture" icone="faChevronDown">
                  <select value={facture.modele} onChange={(e) => maj({ modele: e.target.value, couleur: "" })}>
                    {MODELES.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                  </select>
                </Champ>
              </div>

              <div className="efSegments" role="radiogroup" aria-label="Type de facturation">
                {ONGLETS_MODE.map((o) => (
                  <button
                    type="button"
                    role="radio"
                    key={o.id}
                    aria-checked={facture.mode === o.id}
                    onClick={() => maj({ mode: o.id })}
                  >
                    <Icon fafa={o.icone} width={13} />
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>

              {facture.mode === "fractionne" ? (
                <div className="efBloc" data-champ="echeancier" data-erreur={!!erreurDe("echeancier") || undefined}>
                  <div className="efBlocTete">
                    <b>Échéancier</b>
                    <span data-ok={Math.round(sommeEcheancier * 100) === 10000}>{sommeEcheancier} % sur 100 %</span>
                  </div>
                  {facture.echeancier.map((e, i) => (
                    <div key={e.id} className="efEcheanceLigne">
                      <input
                        aria-label={`Libellé de l'échéance ${i + 1}`}
                        value={e.libelle}
                        placeholder={`Échéance ${i + 1}`}
                        onChange={(ev) => majEcheance(e.id, { libelle: ev.target.value })}
                      />
                      <span className="efSuffixe">
                        <Nombre
                          max="100"
                          aria-label={`Pourcentage de l'échéance ${i + 1}`}
                          value={e.pourcentage}
                          onChange={(ev) => majEcheance(e.id, { pourcentage: ev.target.value })}
                        />
                        %
                      </span>
                      <input type="date" aria-label={`Date de l'échéance ${i + 1}`} value={e.date} onChange={(ev) => majEcheance(e.id, { date: ev.target.value })} />
                      <b>{argent((c.total * (Number(e.pourcentage) || 0)) / 100)}</b>
                      <button
                        type="button"
                        className="efIconeBouton"
                        aria-label={`Retirer l'échéance ${i + 1}`}
                        disabled={facture.echeancier.length <= 2}
                        onClick={() => maj((f) => ({ echeancier: f.echeancier.filter((x) => x.id !== e.id) }))}
                      >
                        <Icon fafa="faXmark" width={11} />
                      </button>
                    </div>
                  ))}
                  <div className="efBlocPied">
                    <button
                      type="button"
                      className="efLien"
                      onClick={() => maj((f) => ({
                        echeancier: [...f.echeancier, { id: idLigne(), libelle: "", pourcentage: Math.max(0, 100 - sommeEcheancier), date: f.echeance }],
                      }))}
                    >
                      + Ajouter une échéance
                    </button>
                    {Math.round(sommeEcheancier * 100) !== 10000 ? (
                      <button
                        type="button"
                        className="efLien"
                        onClick={() => maj((f) => {
                          const n = f.echeancier.length;
                          const part = Math.floor((100 / n) * 100) / 100;
                          return { echeancier: f.echeancier.map((e, i) => ({ ...e, pourcentage: i === n - 1 ? Math.round((100 - part * (n - 1)) * 100) / 100 : part })) };
                        })}
                      >
                        Répartir à parts égales
                      </button>
                    ) : null}
                  </div>
                  {erreurDe("echeancier") ? <span className="efChampErreur" role="alert">{erreurDe("echeancier")}</span> : null}
                </div>
              ) : null}

              {facture.mode === "recurrente" ? (
                <div className="efBloc">
                  <div className="efGrille2">
                    <Champ label="Fréquence" icone="faChevronDown">
                      <select
                        value={facture.recurrence.frequence}
                        onChange={(e) => maj((f) => ({ recurrence: { ...f.recurrence, frequence: e.target.value } }))}
                      >
                        {FREQUENCES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                    </Champ>
                    <Champ label="Jusqu'au (facultatif)" icone="faCalendar" champ="recurrence" erreur={erreurDe("recurrence")}>
                      <input
                        type="date"
                        value={facture.recurrence.fin}
                        onChange={(e) => maj((f) => ({ recurrence: { ...f.recurrence, fin: e.target.value } }))}
                      />
                    </Champ>
                  </div>
                  <div className="efAide">
                    <Icon fafa="faCircleInfo" width={12} />
                    <span>
                      Cette facture est la première de la série. Les suivantes sont préparées en brouillon
                      à chaque échéance, à relire avant envoi — prochaine le{" "}
                      {new Date(`${dateSuivante(facture.date, facture.recurrence.frequence)}T00:00:00`).toLocaleDateString("fr-FR")}.
                    </span>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="efSection" aria-labelledby="ef-t-details">
              <h2 id="ef-t-details">Détails de facturation</h2>
              <div className="efGrille2">
                <Champ
                  label="Numéro de facture"
                  champ="numero"
                  erreur={erreurDe("numero")}
                  action={<button type="button" className="efGenerer" onClick={genererNumero}>Générer</button>}
                >
                  <input value={facture.numero} onChange={(e) => maj({ numero: e.target.value })} spellCheck={false} />
                </Champ>
                <Champ label="Date de facture" icone="faCalendar" champ="date" erreur={erreurDe("date")}>
                  <input type="date" value={facture.date} onChange={(e) => changerDate(e.target.value)} />
                </Champ>
                <Champ label="Échéance" icone="faCalendar" champ="echeance" erreur={erreurDe("echeance")}>
                  <input type="date" value={facture.echeance} min={facture.date} onChange={(e) => maj({ echeance: e.target.value, conditions: "" })} />
                </Champ>
                <Champ label="Conditions de paiement" icone="faChevronDown">
                  <select value={facture.conditions} onChange={(e) => changerConditions(e.target.value)}>
                    {!facture.conditions ? <option value="">Personnalisées</option> : null}
                    {CONDITIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </Champ>
              </div>
            </section>

            <section className="efSection" aria-labelledby="ef-t-articles">
              <h2 id="ef-t-articles">
                Articles de la facture
                <small>{facture.lignes.filter((l) => String(l.designation || "").trim()).length || ""}</small>
              </h2>
              <div className="efArticles" data-champ="articles" data-erreur={!!erreurDe("articles") || undefined} role="table" aria-label="Articles">
                <div className="efArticlesTete" role="row">
                  <span role="columnheader">Article</span>
                  <span role="columnheader">Quantité</span>
                  <span role="columnheader">Prix unitaire</span>
                  <span role="columnheader">Taxe</span>
                  <span role="columnheader">Montant</span>
                </div>
                {facture.lignes.map((l, i) => {
                  const tuile = l.articleId ? { couleur: "#0F766E", icone: "faBox" } : TUILES[i % TUILES.length];
                  const stock = l.articleId ? stocks[l.articleId] : null;
                  const auDela = stock !== null && stock !== undefined && stock > 0 && Number(l.qte) > stock;
                  const sansNom = tentative && !String(l.designation || "").trim() && Number(l.pu) > 0;
                  return (
                    <div
                      key={l.id}
                      className="efArticle"
                      role="row"
                      data-ligne={l.id}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (glisse.current !== null && glisse.current !== i) deplacerLigne(glisse.current, i);
                        glisse.current = null;
                      }}
                    >
                      <span
                        className="efPoignee"
                        draggable
                        title="Glisser pour réordonner (ou Alt + ↑ ↓)"
                        onDragStart={() => { glisse.current = i; }}
                      >
                        <Icon fafa="faGripVertical" width={10} />
                      </span>
                      <span className="efTuile" style={{ color: tuile.couleur, background: `${tuile.couleur}1a` }}>
                        <Icon fafa={tuile.icone} width={13} />
                      </span>
                      <span className="efArticleNom">
                        <input
                          className="efNom"
                          aria-label="Nom de l'article"
                          aria-invalid={sansNom || undefined}
                          placeholder="Nom de l'article"
                          value={l.designation}
                          onChange={(e) => majLigne(l.id, { designation: e.target.value })}
                          onKeyDown={(e) => {
                            // Entrée sur la dernière ligne : une nouvelle ligne, comme dans un tableur.
                            if (e.key === "Enter" && i === facture.lignes.length - 1 && String(l.designation || "").trim()) {
                              e.preventDefault();
                              ajouterArticle("libre");
                            }
                          }}
                        />
                        <input
                          className="efDescription"
                          aria-label="Description"
                          placeholder="Description (facultative)"
                          value={l.description || ""}
                          onChange={(e) => majLigne(l.id, { description: e.target.value })}
                        />
                        {stock !== null && stock !== undefined && stock > 0 ? (
                          <span className="efStock" data-alerte={auDela || undefined}>
                            <Icon fafa={auDela ? "faTriangleExclamation" : "faBoxOpen"} width={10} />
                            {auDela ? `Seulement ${stock} en stock` : `${stock} en stock`}
                          </span>
                        ) : null}
                      </span>
                      <Nombre
                        className="efPilule"
                        aria-label="Quantité"
                        value={l.qte}
                        onChange={(e) => majLigne(l.id, { qte: e.target.value })}
                      />
                      <Nombre
                        className="efPilule"
                        aria-label="Prix unitaire"
                        value={l.pu}
                        onChange={(e) => majLigne(l.id, { pu: e.target.value })}
                      />
                      <span className="efPilule efPiluleSuffixe">
                        <Nombre
                          aria-label="Taux de taxe"
                          value={l.tva}
                          onChange={(e) => majLigne(l.id, { tva: e.target.value })}
                        />
                        %
                      </span>
                      <b className="efMontant">{argent((Number(l.qte) || 0) * (Number(l.pu) || 0))}</b>
                      <span className="efLigneActions">
                        <button type="button" className="efIconeBouton" aria-label="Dupliquer l'article" title="Dupliquer" onClick={() => dupliquerLigne(l.id)}>
                          <Icon fafa="faCopy" width={10} />
                        </button>
                        <button type="button" className="efIconeBouton efRetirer" aria-label="Retirer l'article" title="Retirer" onClick={() => retirerLigne(l.id)}>
                          <Icon fafa="faXmark" width={11} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
              {erreurDe("articles") ? <span className="efChampErreur" role="alert">{erreurDe("articles")}</span> : null}
              <div className="efAjouterZone">
                <button type="button" className="efAjouter" aria-haspopup="menu" aria-expanded={menu === "article"} onClick={() => setMenu(menu === "article" ? null : "article")}>
                  <Icon fafa="faPlus" width={12} />
                  <span>Ajouter un article</span>
                </button>
                <Menu ouvert={menu === "article"} fermer={() => setMenu(null)} className="efMenuCentre">
                  <EntreeMenu icone="faBoxesStacked" onClick={() => ajouterArticle("catalogue")} aide="Désignation, prix, TVA et stock repris du Stock">
                    Depuis le catalogue
                  </EntreeMenu>
                  <EntreeMenu icone="faPen" onClick={() => ajouterArticle("libre")} aide="Une prestation, un service, un article ponctuel">
                    Article libre
                  </EntreeMenu>
                </Menu>
              </div>
            </section>

            <section className="efSection" aria-labelledby="ef-t-paiement">
              <h2 id="ef-t-paiement">Paramètres de paiement</h2>
              <div className="efGrille2">
                <Champ label="Mode d'envoi" icone="faChevronDown">
                  <select value={facture.envoi} onChange={(e) => maj({ envoi: e.target.value })}>
                    {MODES_ENVOI.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </Champ>
                <Champ label="Moyen de paiement" icone="faChevronDown">
                  <select value={facture.moyenPaiement} onChange={(e) => maj({ moyenPaiement: e.target.value })}>
                    {MOYENS_PAIEMENT.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </Champ>
              </div>
              <div className="efAvis">
                <Icon fafa="faCircleExclamation" width={13} />
                <span>
                  {mode.aide}
                  {facture.envoi === "immediat" && !facture.clientEmail ? " Ce client n'a pas d'adresse e-mail : vous la saisirez dans le Courrier." : ""}
                </span>
              </div>

              <div className="efGrille3">
                <Champ label="Remise (%)">
                  <Nombre max="100" value={facture.remise} onChange={(e) => maj({ remise: e.target.value })} />
                </Champ>
                <Champ label={`Livraison (${facture.devise === "XOF" ? "F" : facture.devise})`}>
                  <Nombre value={facture.livraison} onChange={(e) => maj({ livraison: e.target.value })} />
                </Champ>
                <Champ label="Devise" icone="faChevronDown">
                  <select value={facture.devise} onChange={(e) => maj({ devise: e.target.value })}>
                    <option value="XOF">Franc CFA (XOF)</option>
                    <option value="EUR">Euro (EUR)</option>
                    <option value="USD">Dollar (USD)</option>
                  </select>
                </Champ>
              </div>
              <Champ label="Notes au client">
                <textarea rows={2} value={facture.notes} onChange={(e) => maj({ notes: e.target.value })} />
              </Champ>

              <div className="efPieces">
                <div className="efPiecesTete">
                  <b>Pièces jointes</b>
                  <small>Envoyées avec la facture : bon de commande, contrat, devis signé…</small>
                </div>
                {(facture.pieces || []).length ? (
                  <ul>
                    {facture.pieces.map((p) => (
                      <li key={p.id}>
                        <Icon fafa="faPaperclip" width={11} />
                        <span title={p.nom}>{p.nom}</span>
                        <button
                          type="button"
                          className="efIconeBouton"
                          aria-label={`Retirer ${p.nom}`}
                          onClick={() => maj((f) => ({ pieces: f.pieces.filter((x) => x.id !== p.id) }))}
                        >
                          <Icon fafa="faXmark" width={10} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <button type="button" className="efBouton" onClick={joindre}>
                  <Icon fafa="faCloud" width={12} />
                  <span>Joindre depuis le Cloud</span>
                </button>
              </div>
            </section>

            <div className="efPiedFormulaire">
              <div className="efTotalRappel">
                <span>Total TTC</span>
                <b>{argent(c.total)}</b>
                {Number(facture.remise) ? <small>dont remise −{argent(c.remise)}</small> : null}
              </div>
              <button type="button" className="efBouton" onClick={nouvelle}>
                <Icon fafa="faRotateLeft" width={12} />
                <span>Réinitialiser</span>
              </button>
              <button type="button" className="efPrincipal" disabled={occupe} onClick={() => enregistrer()}>
                {occupe ? "Enregistrement…" : libelleEnregistrer}
              </button>
            </div>
          </div>

          {/* ------------------------------------------------ Aperçu */}
          <div className="efApercuZone cosScroll" ref={zoneApercu}>
            {manquesEntreprise.length && estAdmin ? (
              <button type="button" className="efApercuConseil" onClick={ouvrirFicheEntreprise}>
                <Icon fafa="faWandMagicSparkles" width={11} />
                <span>Ajoutez {manquesEntreprise.join(", ")} à la fiche de l'entreprise</span>
              </button>
            ) : null}
            <div className="efApercuCadre" style={{ width: LARGEUR_PAGE * echelle, height: HAUTEUR_PAGE * echelle }}>
              <div style={{ transform: `scale(${echelle})`, transformOrigin: "top left" }}>
                <Apercu ref={pageRef} facture={facture} emetteur={emetteurDoc} />
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------ Panneaux */}
        {panneau ? <div className="efVoile" onMouseDown={() => setPanneau(null)} /> : null}

        {panneau === "design" ? (
          <Volet titre="Design de la facture" onFermer={() => setPanneau(null)}>
            <h4>Modèle</h4>
            <div className="efModeles" role="radiogroup" aria-label="Modèle">
              {MODELES.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  role="radio"
                  className="efModele"
                  aria-checked={facture.modele === m.id}
                  onClick={() => maj({ modele: m.id, couleur: "" })}
                >
                  <span className="efVignette">
                    <span style={{ transform: "scale(0.16)", transformOrigin: "top left" }}>
                      <Apercu facture={{ ...facture, modele: m.id, couleur: facture.modele === m.id ? facture.couleur : "" }} emetteur={emetteurDoc} />
                    </span>
                  </span>
                  <b>{m.nom}</b>
                  <small>{m.description}</small>
                </button>
              ))}
            </div>

            <h4>Couleur</h4>
            <div className="efPalette" role="radiogroup" aria-label="Couleur">
              {PALETTE.map((p) => (
                <button
                  type="button"
                  key={p}
                  role="radio"
                  className="efPastilleCouleur"
                  style={{ background: p }}
                  aria-label={`Couleur ${p}`}
                  aria-checked={couleurDe(facture).toLowerCase() === p.toLowerCase()}
                  onClick={() => maj({ couleur: p })}
                />
              ))}
              <label className="efPastilleCouleur efCouleurLibre" title="Couleur personnalisée">
                <Icon fafa="faEyeDropper" width={11} />
                <input type="color" aria-label="Couleur personnalisée" value={couleurDe(facture)} onChange={(e) => maj({ couleur: e.target.value })} />
              </label>
            </div>

            <h4>Afficher</h4>
            {[
              ["afficherLogo", "Le logo de l'entreprise"],
              ["afficherSignature", "La signature et le cachet"],
              ["montantEnLettres", "Le montant total en lettres"],
            ].map(([champ, libelle]) => (
              <label key={champ} className="efBascule">
                <input type="checkbox" checked={facture[champ] !== false} onChange={(e) => maj({ [champ]: e.target.checked })} />
                <span>{libelle}</span>
              </label>
            ))}

            <button type="button" className="efBouton efLarge" onClick={enregistrerDesignParDefaut}>
              <Icon fafa="faStar" width={12} />
              <span>Utiliser ce design par défaut</span>
            </button>
            {manquesEntreprise.length ? (
              <div className="efAide">
                <Icon fafa="faCircleInfo" width={12} />
                <span>
                  Logo, cachet, signature et coordonnées viennent de la{" "}
                  <button type="button" className="efLien" onClick={ouvrirFicheEntreprise}>fiche de l'entreprise</button>.
                </span>
              </div>
            ) : null}
          </Volet>
        ) : null}

        {panneau === "profil" ? (
          <Volet
            titre="Fiche de l'entreprise"
            large
            onFermer={() => setPanneau(null)}
            actions={(
              <button type="button" className="efLien" onClick={() => { setPanneau(null); ouvrirParametres("entreprise"); }}>
                Ouvrir dans les Paramètres
              </button>
            )}
          >
            <p className="efAideTexte">
              Partagée par toutes les applications de l'espace : ce que vous changez ici apparaît
              aussi sur les devis, les bons de commande et dans les Paramètres.
            </p>
            <FicheEntreprise
              compact
              repli={repliIdentite}
              onEnregistre={() => {
                chargerSignatures().then(setSignatures);
                flash("Fiche de l'entreprise enregistrée : l'aperçu est à jour.");
              }}
            />
          </Volet>
        ) : null}

        {panneau === "ouvrir" ? (
          <Volet titre="Ouvrir une facture" onFermer={() => setPanneau(null)}>
            <Champ label="Rechercher" icone="faMagnifyingGlass">
              <input value={recherche} placeholder="Numéro ou client" onChange={(e) => setRecherche(e.target.value)} />
            </Champ>
            {facturesVisibles.length ? facturesVisibles.slice(0, 80).map((d) => {
              const etat = etatPaiement(d, reglements);
              return (
                <button
                  type="button"
                  key={d.id}
                  className="efListeLigne"
                  data-actif={d.id === ficheId}
                  onClick={async () => { if (d.id === ficheId || await confirmerAbandon()) ouvrirFiche(d, profil); }}
                >
                  <span>
                    <b>{d.data.numero}</b>
                    <small>{d.data.clientEntreprise || d.data.clientNom || "—"} · {new Date(`${d.data.date}T00:00:00`).toLocaleDateString("fr-FR")}</small>
                  </span>
                  <span className="efListeDroite">
                    <span className="efListeMontant">{montantDans(chiffres(depuisFacturation(d.data)).total, d.data.devise)}</span>
                    <span className="efPuce" data-ton={etat.ton}>{etat.label}</span>
                  </span>
                </button>
              );
            }) : <p className="efAideTexte">Aucune facture{recherche ? " ne correspond" : " pour l'instant"}.</p>}
          </Volet>
        ) : null}

        {panneau === "recurrences" ? (
          <Volet titre="Factures récurrentes" onFermer={() => setPanneau(null)}>
            {dues.length ? (
              <button type="button" className="efPrincipal efLarge" disabled={occupe} onClick={() => genererRecurrentes()}>
                Préparer les {dues.length} facture{dues.length > 1 ? "s" : ""} du jour
              </button>
            ) : null}
            {recurrences.length ? recurrences.map((r) => {
              const due = dues.some((x) => x.id === r.id);
              return (
                <div key={r.id} className="efRecurrence" data-inactif={r.data.actif === false}>
                  <div>
                    <b>{r.data.client || "Client"}</b>
                    <small>
                      {montantDans(r.data.total, r.data.devise)} · {FREQUENCES.find((x) => x.id === r.data.frequence)?.label.toLowerCase()}
                      {r.data.actif === false ? " · suspendue" : ` · prochaine le ${new Date(`${r.data.prochaine}T00:00:00`).toLocaleDateString("fr-FR")}`}
                    </small>
                    {due && r.data.actif !== false ? <span className="efBadge">À préparer</span> : null}
                  </div>
                  <div className="efRecurrenceActions">
                    {due && r.data.actif !== false ? (
                      <button type="button" className="efBouton" disabled={occupe} onClick={() => genererRecurrentes([r])}>Préparer</button>
                    ) : null}
                    <button type="button" className="efIconeBouton" aria-label={r.data.actif === false ? "Reprendre" : "Suspendre"} title={r.data.actif === false ? "Reprendre" : "Suspendre"} onClick={() => basculerRecurrence(r)}>
                      <Icon fafa={r.data.actif === false ? "faPlay" : "faPause"} width={11} />
                    </button>
                    <button type="button" className="efIconeBouton" aria-label="Arrêter" title="Arrêter" onClick={() => supprimerRecurrence(r)}>
                      <Icon fafa="faTrashCan" width={11} />
                    </button>
                  </div>
                </div>
              );
            }) : (
              <div className="efAide">
                <Icon fafa="faCircleInfo" width={12} />
                <span>Aucune facture récurrente. Choisissez « Facture récurrente » au-dessus du formulaire : la première facture arme la série.</span>
              </div>
            )}
          </Volet>
        ) : null}

        {panneau === "raccourcis" ? (
          <Volet titre="Raccourcis clavier" onFermer={() => setPanneau(null)}>
            <dl className="efRaccourcis">
              {[
                [`${MOD} + Entrée`, libelleEnregistrer],
                [`${MOD} + S`, "Enregistrer sans envoyer"],
                [`${MOD} + P`, "Imprimer la facture"],
                ["Alt + ↑ / ↓", "Déplacer l'article où se trouve le curseur"],
                ["Entrée", "Sur le nom du dernier article : ajouter une ligne"],
                ["Échap", "Fermer le volet ou l'aperçu"],
              ].map(([k, v]) => (
                <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
              ))}
            </dl>
          </Volet>
        ) : null}

        {pleinEcran ? (
          <div className="efPleinEcran" role="dialog" aria-modal="true" aria-label="Aperçu de la facture">
            <div className="efPleinEcranBarre">
              <span>Aperçu · {facture.numero}</span>
              <span className="efEspace" />
              <button type="button" className="efBouton" onClick={telechargerPdf}><Icon fafa="faFilePdf" width={12} /><span>PDF</span></button>
              <button type="button" className="efBouton" onClick={imprimer}><Icon fafa="faPrint" width={12} /><span>Imprimer</span></button>
              <button type="button" className="efBouton efCarre" aria-label="Fermer l'aperçu" autoFocus onClick={() => setPleinEcran(false)}><Icon fafa="faXmark" width={13} /></button>
            </div>
            <div className="efPleinEcranPage cosScroll">
              <Apercu facture={facture} emetteur={emetteurDoc} />
            </div>
          </div>
        ) : null}
      </div>
    </ModuleWindow>
  );
}
