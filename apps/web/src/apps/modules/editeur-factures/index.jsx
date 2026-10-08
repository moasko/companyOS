import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { composerCourriel } from "../../courrielRequest";
import { choisirClient, choisirProduit } from "../../referentiel";
import { accesDonnees } from "../../donnees";
import { ensureRootFolder } from "../../cloud";
import { ouvrirFenetre } from "../../windows";
import { ID_EDITEUR, prendreDemande, surDemande } from "../../editeurFacturesRequest";
import { montantDans } from "../../../utils/monnaie";
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
  problemes,
  recurrencesDues,
  today,
  versFacturation,
} from "./domaine";
import { MODELES, PALETTE, couleurDe } from "./modeles";
import { Apercu } from "./Apercu";
import { factureEnPdf } from "./pdf";
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
// client. L'éditeur, lui, garde seulement le profil de l'entreprise
// (`emetteur`) et les factures récurrentes (`recurrences`).
// ---------------------------------------------------------------------------

export const manifest = {
  id: ID_EDITEUR,
  slug: "editeur-factures",
  name: "Éditeur de factures",
  icon: "editeur-factures",
  version: "1.0.0",
  nouveautes: [
    { version: "1.0.0", texte: "Six modèles, aperçu en direct, paiement fractionné, factures récurrentes et envoi au client en PDF." },
  ],
  capacites: {
    lit: ["crm:clients", "stock:articles", "facturation:factures", "facturation:reglements"],
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

/// Réduit une image (logo, signature) avant de la ranger : une fiche ne
/// dépasse pas 64 Ko, et un logo n'a pas besoin de plus de 240 pixels.
const reduireImage = (fichier, taille = 240) =>
  new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error("Lecture de l'image impossible."));
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Ce fichier n'est pas une image lisible."));
      img.onload = () => {
        const echelle = Math.min(1, taille / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * echelle);
        canvas.height = Math.round(img.height * echelle);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(fichier);
  });

// ---------------------------------------------------------------------------
// Petits composants de formulaire, à l'image de la maquette : l'étiquette
// en petit au-dessus de la valeur, dans un même cadre.
// ---------------------------------------------------------------------------

const Champ = ({ label, icone, children, action }) => (
  <label className="efChamp">
    <span className="efChampLabel">{label}</span>
    <span className="efChampValeur">
      {children}
      {action}
      {icone ? <Icon fafa={icone} width={13} /> : null}
    </span>
  </label>
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

const EntreeMenu = ({ icone, children, onClick, aide, desactive }) => (
  <button type="button" role="menuitem" className="efMenuEntree" disabled={desactive} onClick={onClick}>
    {icone ? <Icon fafa={icone} width={13} /> : <span />}
    <span>
      {children}
      {aide ? <small>{aide}</small> : null}
    </span>
  </button>
);

// ---------------------------------------------------------------------------
// L'application
// ---------------------------------------------------------------------------

function EditeurFactures() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const cle = cleBrouillon(session.tenant?.id);

  const [facture, setFacture] = useState(() => factureVide());
  const [ficheId, setFicheId] = useState(null);
  const [ficheOrigine, setFicheOrigine] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [emetteur, setEmetteur] = useState(null);
  const [recurrences, setRecurrences] = useState([]);
  const [charge, setCharge] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null);
  const [menu, setMenu] = useState(null);
  const [panneau, setPanneau] = useState(null);
  const [pleinEcran, setPleinEcran] = useState(false);
  const [echelle, setEchelle] = useState(0.6);

  const zoneApercu = useRef(null);
  const pageRef = useRef(null);
  const glisse = useRef(null);
  const modifieRef = useRef(false);

  const profil = useMemo(
    () => emetteur?.data || { nom: session.tenant?.name || "" },
    [emetteur, session.tenant?.name],
  );

  const minuteurMessage = useRef(null);
  const flash = (texte, ton = "ok") => {
    setMessage({ texte, ton });
    window.clearTimeout(minuteurMessage.current);
    minuteurMessage.current = window.setTimeout(() => setMessage(null), ton === "erreur" ? 12000 : 7000);
  };

  // ---- Chargement ---------------------------------------------------------

  const charger = useCallback(async () => {
    const [docs, profils, recs] = await Promise.all([
      donnees.lire("facturation", "factures").catch(() => []),
      donnees.lire("emetteur").catch(() => []),
      donnees.lire("recurrences").catch(() => []),
    ]);
    setDocuments(docs);
    setEmetteur(profils[0] || null);
    setRecurrences(recs);
    return { docs, profil: profils[0] || null };
  }, []);

  /// Ouvre une fiche de la Facturation dans l'éditeur.
  const ouvrirFiche = useCallback((fiche, reglages) => {
    setFacture(depuisFacturation(fiche.data, reglages));
    setFicheId(fiche.id);
    setFicheOrigine(fiche);
    modifieRef.current = false;
    setPanneau(null);
  }, []);

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
        return;
      }
      const base = factureVide(reglages);
      setFacture({ ...base, numero: numeroSuivant(docs, base.date) });
    }).catch((e) => flash(e.message, "erreur"));
  }, [ouvert, charge, charger, traiterDemande, cle]);

  useEffect(() => surDemande((d) => { traiterDemande(d, null, profil); }), [traiterDemande, profil]);

  // Sauvegarde du travail en cours, une demi-seconde après la dernière frappe.
  useEffect(() => {
    if (!charge) return undefined;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(cle, JSON.stringify({ facture, ficheId, ficheOrigine }));
      } catch {
        /* stockage plein ou interdit : le travail reste à l'écran */
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [facture, ficheId, ficheOrigine, charge, cle]);

  // L'aperçu suit la largeur de sa colonne.
  useEffect(() => {
    const zone = zoneApercu.current;
    if (!zone) return undefined;
    const mesurer = () => setEchelle(Math.min(1, (zone.clientWidth - 56) / LARGEUR_PAGE));
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(zone);
    return () => obs.disconnect();
  }, [ouvert]);

  // ---- Modifications ----------------------------------------------------------

  const maj = (patch) => {
    modifieRef.current = true;
    setFacture((f) => ({ ...f, ...(typeof patch === "function" ? patch(f) : patch) }));
  };

  const majLigne = (id, patch) =>
    maj((f) => ({ lignes: f.lignes.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  const retirerLigne = (id) =>
    maj((f) => ({ lignes: f.lignes.length > 1 ? f.lignes.filter((l) => l.id !== id) : [ligneVide()] }));

  const deplacerLigne = (de, vers) =>
    maj((f) => {
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
    maj((f) => ({ lignes: [...f.lignes, ligneVide()] }));
  };

  const changerConditions = (conditions) =>
    maj((f) => ({ conditions, echeance: echeanceSelon(conditions, f.date) }));

  const changerDate = (date) =>
    maj((f) => ({ date, echeance: f.conditions ? echeanceSelon(f.conditions, date) : f.echeance }));

  const majEcheance = (id, patch) =>
    maj((f) => ({ echeancier: f.echeancier.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const genererNumero = () => maj((f) => ({ numero: numeroSuivant(documents, f.date) }));

  const reinitialiser = async () => {
    const ok = !modifieRef.current || await modal.confirm({
      title: "Repartir d'une facture vierge ?",
      message: "Les modifications non enregistrées seront perdues.",
      confirmLabel: "Réinitialiser",
      danger: true,
    });
    if (!ok) return;
    const base = factureVide(profil);
    setFacture({ ...base, numero: numeroSuivant(documents, base.date) });
    setFicheId(null);
    setFicheOrigine(null);
    modifieRef.current = false;
    try { localStorage.removeItem(cle); } catch { /* rien à faire */ }
    setMenu(null);
  };

  // ---- Enregistrement et envoi ----------------------------------------------

  const enregistrer = async ({ envoi = facture.envoi } = {}) => {
    setMenu(null);
    const liste = problemes(facture);
    if (liste.length) {
      modal.alert({ title: "La facture n'est pas prête", message: liste.join("\n"), tone: "info" });
      return null;
    }
    // Deux factures ne portent jamais le même numéro : la comptabilité le
    // refuserait, et le client paierait l'une pour l'autre.
    const doublon = documents.find((d) => d.id !== ficheId && d.data?.type === "facture" && d.data?.numero === facture.numero);
    if (doublon) {
      modal.alert({
        title: `Le numéro ${facture.numero} est déjà pris`,
        message: "Cliquez sur « Générer » pour prendre le numéro suivant de la séquence.",
        tone: "info",
      });
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
      modifieRef.current = false;
      await charger();

      if (envoi === "immediat") {
        await envoyerAuClient(fiche);
      } else {
        flash(`Facture ${facture.numero} enregistrée${statut === "brouillon" ? " en brouillon" : ""} — elle est suivie dans la Facturation.`);
      }
      return fiche;
    } catch (e) {
      flash(e.message, "erreur");
      return null;
    } finally {
      setOccupe(false);
    }
  };

  /// Le PDF dans le modèle choisi, rangé dans le dossier Facturation du
  /// cloud, puis un courriel prérempli dans le Courrier : l'utilisateur
  /// relit avant d'envoyer, une app n'écrit jamais dans son dos.
  const envoyerAuClient = async () => {
    const blob = factureEnPdf(facture, profil);
    const dossier = await ensureRootFolder("Facturation");
    const noeud = await api.uploadFile(new File([blob], `${facture.numero}.pdf`, { type: "application/pdf" }), dossier);
    const total = montantDans(chiffres(facture).total, facture.devise);
    composerCourriel({
      a: facture.clientEmail || "",
      sujet: `Facture ${facture.numero} — ${profil.nom || session.tenant?.name || ""}`.trim(),
      texte:
        `Bonjour${facture.clientNom ? ` ${facture.clientNom}` : ""},\n\n` +
        `Veuillez trouver ci-joint notre facture ${facture.numero} d'un montant de ${total}, ` +
        `à régler avant le ${new Date(`${facture.echeance}T00:00:00`).toLocaleDateString("fr-FR")}.\n\n` +
        `${facture.notes ? `${facture.notes}\n\n` : ""}Cordialement,\n${session.user?.name || ""}\n${profil.nom || ""}`,
      pieces: noeud?.id ? [{ id: noeud.id, nom: noeud.name || `${facture.numero}.pdf` }] : [],
    });
    flash(`Facture ${facture.numero} enregistrée et prête à partir : vérifiez le courriel, puis envoyez.`);
  };

  const telechargerPdf = () => {
    setMenu(null);
    const url = URL.createObjectURL(factureEnPdf(facture, profil));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${facture.numero || "facture"}.pdf` });
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
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
    modifieRef.current = true;
    flash("Copie prête : c'est une nouvelle facture, avec son propre numéro.");
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

  // ---- Profil de l'entreprise ---------------------------------------------------

  const [profilEdite, setProfilEdite] = useState(null);
  const ouvrirProfil = () => {
    setMenu(null);
    setProfilEdite({ pays: "Côte d'Ivoire", ...profil, nom: profil.nom || session.tenant?.name || "" });
    setPanneau("profil");
  };

  const enregistrerProfil = async () => {
    setOccupe(true);
    try {
      if (emetteur) await donnees.modifier("emetteur", emetteur.id, profilEdite);
      else await donnees.creer("emetteur", profilEdite);
      await charger();
      setPanneau(null);
      flash("Profil de l'entreprise enregistré : il s'applique à toutes vos factures.");
    } catch (e) {
      flash(e.message, "erreur");
    } finally {
      setOccupe(false);
    }
  };

  const chargerImage = (champ) => async (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = "";
    if (!fichier) return;
    try {
      const image = await reduireImage(fichier, champ === "logo" ? 240 : 320);
      setProfilEdite((p) => ({ ...p, [champ]: image }));
    } catch (err) {
      flash(err.message, "erreur");
    }
  };

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
  const [recherche, setRecherche] = useState("");
  const facturesVisibles = factures.filter((d) => {
    const q = recherche.trim().toLowerCase();
    if (!q) return true;
    return [d.data.numero, d.data.clientEntreprise, d.data.clientNom].some((v) => String(v || "").toLowerCase().includes(q));
  });

  if (!ouvert) return <ModuleWindow manifest={manifest} className="efApp" />;

  return (
    <ModuleWindow manifest={manifest} className="efApp">
      <div className="efShell">
        {/* ------------------------------------------------ En-tête */}
        <header className="efEntete">
          <div className="efEnteteTitre">
            <h1>{ficheId ? `Modifier la facture ${facture.numero}` : "Créer une facture"}</h1>
            <p>Créez et personnalisez des factures professionnelles pour vos clients.</p>
          </div>
          <div className="efEnteteActions">
            <div className="efGroupeBoutons">
              <button type="button" className="efBouton" onClick={() => setPleinEcran(true)}>
                <Icon fafa="faEye" width={13} />
                <span>Aperçu</span>
              </button>
              <button type="button" className="efBouton" data-actif={panneau === "design"} onClick={() => setPanneau(panneau === "design" ? null : "design")}>
                <Icon fafa="faPenToSquare" width={13} />
                <span>Modifier le design</span>
              </button>
            </div>

            <div className="efSplit">
              <button type="button" className="efPrincipal" disabled={occupe} onClick={() => enregistrer()}>
                {occupe ? "Enregistrement…" : libelleEnregistrer}
              </button>
              <button
                type="button"
                className="efPrincipal efPrincipalFleche"
                aria-label="Autres façons d'enregistrer"
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
                <EntreeMenu icone="faFloppyDisk" onClick={() => enregistrer({ envoi: "brouillon" })}>
                  Enregistrer en brouillon
                </EntreeMenu>
                <hr />
                <EntreeMenu icone="faFilePdf" onClick={telechargerPdf}>Télécharger le PDF</EntreeMenu>
                <EntreeMenu icone="faPrint" onClick={imprimer}>Imprimer</EntreeMenu>
                <EntreeMenu icone="faClone" onClick={dupliquer}>Dupliquer en nouvelle facture</EntreeMenu>
              </Menu>
            </div>

            <div className="efPlusZone">
              <button
                type="button"
                className="efBouton efCarre"
                aria-label="Plus d'actions"
                aria-expanded={menu === "plus"}
                onClick={() => setMenu(menu === "plus" ? null : "plus")}
              >
                <Icon fafa="faEllipsisVertical" width={13} />
                {dues.length ? <span className="efPastille">{dues.length}</span> : null}
              </button>
              <Menu ouvert={menu === "plus"} fermer={() => setMenu(null)} className="efMenuDroite">
                <EntreeMenu icone="faFileCirclePlus" onClick={reinitialiser}>Nouvelle facture</EntreeMenu>
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
                <EntreeMenu icone="faBuilding" onClick={ouvrirProfil} aide="Logo, adresse, NCC, coordonnées bancaires">
                  Profil de l'entreprise
                </EntreeMenu>
                <hr />
                <EntreeMenu icone="faFileInvoice" onClick={() => { setMenu(null); ouvrirFenetre("facturation"); }} aide="Règlements, relances, état de paiement">
                  Ouvrir la Facturation
                </EntreeMenu>
              </Menu>
            </div>
          </div>
        </header>

        {message ? (
          <div className="efMessage" data-ton={message.ton} role="status">
            <Icon fafa={message.ton === "erreur" ? "faCircleExclamation" : "faCircleCheck"} width={13} />
            <span>{message.texte}</span>
            <button type="button" aria-label="Fermer" onClick={() => setMessage(null)}><Icon fafa="faXmark" width={11} /></button>
          </div>
        ) : null}

        {dues.length && panneau !== "recurrences" ? (
          <div className="efMessage" data-ton="info">
            <Icon fafa="faRotate" width={13} />
            <span>{dues.length} facture{dues.length > 1 ? "s" : ""} récurrente{dues.length > 1 ? "s" : ""} à préparer aujourd'hui.</span>
            <button type="button" className="efLien" disabled={occupe} onClick={() => genererRecurrentes()}>Préparer maintenant</button>
          </div>
        ) : null}

        <div className="efCorps">
          {/* ------------------------------------------------ Formulaire */}
          <div className="efFormulaire cosScroll">
            <section className="efSection">
              <h2>Informations client</h2>
              <div className="efGrille2">
                <button type="button" className="efClient" onClick={choisirLeClient}>
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
                <Champ label="Modèle de facture" icone="faChevronDown">
                  <select value={facture.modele} onChange={(e) => maj({ modele: e.target.value })}>
                    {MODELES.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
                  </select>
                </Champ>
              </div>

              <div className="efSegments" role="tablist" aria-label="Type de facturation">
                {ONGLETS_MODE.map((o) => (
                  <button
                    type="button"
                    role="tab"
                    key={o.id}
                    aria-selected={facture.mode === o.id}
                    onClick={() => maj({ mode: o.id })}
                  >
                    <Icon fafa={o.icone} width={13} />
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>

              {facture.mode === "fractionne" ? (
                <div className="efBloc">
                  <div className="efBlocTete">
                    <b>Échéancier</b>
                    <span data-ok={Math.round(sommeEcheancier * 100) === 10000}>{sommeEcheancier} % sur 100 %</span>
                  </div>
                  {facture.echeancier.map((e, i) => (
                    <div key={e.id} className="efEcheanceLigne">
                      <input
                        aria-label="Libellé de l'échéance"
                        value={e.libelle}
                        placeholder={`Échéance ${i + 1}`}
                        onChange={(ev) => majEcheance(e.id, { libelle: ev.target.value })}
                      />
                      <span className="efSuffixe">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          aria-label="Pourcentage"
                          value={e.pourcentage}
                          onChange={(ev) => majEcheance(e.id, { pourcentage: ev.target.value })}
                        />
                        %
                      </span>
                      <input type="date" aria-label="Date de l'échéance" value={e.date} onChange={(ev) => majEcheance(e.id, { date: ev.target.value })} />
                      <b>{argent((c.total * (Number(e.pourcentage) || 0)) / 100)}</b>
                      <button
                        type="button"
                        className="efIconeBouton"
                        aria-label="Retirer l'échéance"
                        disabled={facture.echeancier.length <= 2}
                        onClick={() => maj((f) => ({ echeancier: f.echeancier.filter((x) => x.id !== e.id) }))}
                      >
                        <Icon fafa="faXmark" width={11} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="efLien"
                    onClick={() => maj((f) => ({
                      echeancier: [...f.echeancier, { id: idLigne(), libelle: "", pourcentage: Math.max(0, 100 - sommeEcheancier), date: f.echeance }],
                    }))}
                  >
                    + Ajouter une échéance
                  </button>
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
                    <Champ label="Jusqu'au (facultatif)" icone="faCalendar">
                      <input
                        type="date"
                        value={facture.recurrence.fin}
                        onChange={(e) => maj((f) => ({ recurrence: { ...f.recurrence, fin: e.target.value } }))}
                      />
                    </Champ>
                  </div>
                  <div className="efAide">
                    <Icon fafa="faCircleInfo" width={12} />
                    Cette facture est la première de la série. Les suivantes sont préparées en brouillon
                    à chaque échéance, à relire avant envoi — prochaine le{" "}
                    {new Date(`${dateSuivante(facture.date, facture.recurrence.frequence)}T00:00:00`).toLocaleDateString("fr-FR")}.
                  </div>
                </div>
              ) : null}
            </section>

            <section className="efSection">
              <h2>Détails de facturation</h2>
              <div className="efGrille2">
                <Champ
                  label="Numéro de facture"
                  action={<button type="button" className="efGenerer" onClick={genererNumero}>Générer</button>}
                >
                  <input value={facture.numero} onChange={(e) => maj({ numero: e.target.value })} />
                </Champ>
                <Champ label="Date de facture" icone="faCalendar">
                  <input type="date" value={facture.date} onChange={(e) => changerDate(e.target.value)} />
                </Champ>
                <Champ label="Échéance" icone="faCalendar">
                  <input type="date" value={facture.echeance} onChange={(e) => maj({ echeance: e.target.value, conditions: "" })} />
                </Champ>
                <Champ label="Conditions de paiement" icone="faChevronDown">
                  <select value={facture.conditions} onChange={(e) => changerConditions(e.target.value)}>
                    {!facture.conditions ? <option value="">Personnalisées</option> : null}
                    {CONDITIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </Champ>
              </div>
            </section>

            <section className="efSection">
              <h2>Articles de la facture</h2>
              <div className="efArticles">
                <div className="efArticlesTete">
                  <span>Article</span>
                  <span>Quantité</span>
                  <span>Prix unitaire</span>
                  <span>Taxe</span>
                  <span>Montant</span>
                </div>
                {facture.lignes.map((l, i) => {
                  const tuile = l.articleId ? { couleur: "#0F766E", icone: "faBox" } : TUILES[i % TUILES.length];
                  return (
                    <div
                      key={l.id}
                      className="efArticle"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (glisse.current !== null && glisse.current !== i) deplacerLigne(glisse.current, i);
                        glisse.current = null;
                      }}
                    >
                      <span
                        className="efPoignee"
                        draggable
                        title="Glisser pour réordonner"
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
                          placeholder="Nom de l'article"
                          value={l.designation}
                          onChange={(e) => majLigne(l.id, { designation: e.target.value })}
                        />
                        <input
                          className="efDescription"
                          aria-label="Description"
                          placeholder="Description (facultative)"
                          value={l.description || ""}
                          onChange={(e) => majLigne(l.id, { description: e.target.value })}
                        />
                      </span>
                      <input
                        className="efPilule"
                        type="number"
                        min="0"
                        step="any"
                        aria-label="Quantité"
                        value={l.qte}
                        onChange={(e) => majLigne(l.id, { qte: e.target.value })}
                      />
                      <input
                        className="efPilule"
                        type="number"
                        min="0"
                        step="any"
                        aria-label="Prix unitaire"
                        value={l.pu}
                        onChange={(e) => majLigne(l.id, { pu: e.target.value })}
                      />
                      <span className="efPilule efPiluleSuffixe">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          aria-label="Taux de taxe"
                          value={l.tva}
                          onChange={(e) => majLigne(l.id, { tva: e.target.value })}
                        />
                        %
                      </span>
                      <b className="efMontant">{argent((Number(l.qte) || 0) * (Number(l.pu) || 0))}</b>
                      <button type="button" className="efIconeBouton efRetirer" aria-label="Retirer l'article" onClick={() => retirerLigne(l.id)}>
                        <Icon fafa="faXmark" width={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="efAjouterZone">
                <button type="button" className="efAjouter" onClick={() => setMenu(menu === "article" ? null : "article")}>
                  <Icon fafa="faPlus" width={12} />
                  <span>Ajouter un article</span>
                </button>
                <Menu ouvert={menu === "article"} fermer={() => setMenu(null)} className="efMenuCentre">
                  <EntreeMenu icone="faBoxesStacked" onClick={() => ajouterArticle("catalogue")} aide="Désignation, prix et TVA repris du Stock">
                    Depuis le catalogue
                  </EntreeMenu>
                  <EntreeMenu icone="faPen" onClick={() => ajouterArticle("libre")} aide="Une prestation, un service, un article ponctuel">
                    Article libre
                  </EntreeMenu>
                </Menu>
              </div>
            </section>

            <section className="efSection">
              <h2>Paramètres de paiement</h2>
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
                <span>{mode.aide}</span>
              </div>

              <div className="efGrille3">
                <Champ label="Remise (%)">
                  <input type="number" min="0" max="100" step="any" value={facture.remise} onChange={(e) => maj({ remise: e.target.value })} />
                </Champ>
                <Champ label={`Livraison (${facture.devise === "XOF" ? "F" : facture.devise})`}>
                  <input type="number" min="0" step="any" value={facture.livraison} onChange={(e) => maj({ livraison: e.target.value })} />
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

              <div className="efPiedFormulaire">
                <span className="efTotalRappel">Total : <b>{argent(c.total)}</b></span>
                <button type="button" className="efBouton" onClick={reinitialiser}>
                  <Icon fafa="faRotateLeft" width={12} />
                  <span>Réinitialiser</span>
                </button>
              </div>
            </section>
          </div>

          {/* ------------------------------------------------ Aperçu */}
          <div className="efApercuZone cosScroll" ref={zoneApercu}>
            <div className="efApercuCadre" style={{ width: LARGEUR_PAGE * echelle, height: HAUTEUR_PAGE * echelle }}>
              <div style={{ transform: `scale(${echelle})`, transformOrigin: "top left" }}>
                <Apercu ref={pageRef} facture={facture} emetteur={profil} />
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------ Panneaux */}
        {panneau ? <div className="efVoile" onMouseDown={() => setPanneau(null)} /> : null}

        {panneau === "design" ? (
          <aside className="efPanneau" aria-label="Design de la facture">
            <div className="efPanneauTete">
              <h3>Design de la facture</h3>
              <button type="button" className="efIconeBouton" aria-label="Fermer" onClick={() => setPanneau(null)}><Icon fafa="faXmark" width={12} /></button>
            </div>
            <div className="efPanneauCorps cosScroll">
              <h4>Modèle</h4>
              <div className="efModeles">
                {MODELES.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    className="efModele"
                    aria-pressed={facture.modele === m.id}
                    onClick={() => maj({ modele: m.id, couleur: "" })}
                  >
                    <span className="efVignette">
                      <span style={{ transform: "scale(0.16)", transformOrigin: "top left" }}>
                        <Apercu facture={{ ...facture, modele: m.id, couleur: facture.modele === m.id ? facture.couleur : "" }} emetteur={profil} />
                      </span>
                    </span>
                    <b>{m.nom}</b>
                    <small>{m.description}</small>
                  </button>
                ))}
              </div>

              <h4>Couleur</h4>
              <div className="efPalette">
                {PALETTE.map((p) => (
                  <button
                    type="button"
                    key={p}
                    className="efPastilleCouleur"
                    style={{ background: p }}
                    aria-label={`Couleur ${p}`}
                    aria-pressed={couleurDe(facture).toLowerCase() === p.toLowerCase()}
                    onClick={() => maj({ couleur: p })}
                  />
                ))}
                <label className="efPastilleCouleur efCouleurLibre" title="Couleur personnalisée">
                  <Icon fafa="faEyeDropper" width={11} />
                  <input type="color" value={couleurDe(facture)} onChange={(e) => maj({ couleur: e.target.value })} />
                </label>
              </div>

              <h4>Afficher</h4>
              {[
                ["afficherLogo", "Le logo de l'entreprise"],
                ["afficherSignature", "La signature"],
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
              {!profil.logo || !profil.adresse ? (
                <div className="efAide">
                  <Icon fafa="faCircleInfo" width={12} />
                  <span>
                    Ajoutez votre logo, votre adresse et vos coordonnées de paiement dans le{" "}
                    <button type="button" className="efLien" onClick={ouvrirProfil}>profil de l'entreprise</button>.
                  </span>
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}

        {panneau === "profil" && profilEdite ? (
          <aside className="efPanneau" aria-label="Profil de l'entreprise">
            <div className="efPanneauTete">
              <h3>Profil de l'entreprise</h3>
              <button type="button" className="efIconeBouton" aria-label="Fermer" onClick={() => setPanneau(null)}><Icon fafa="faXmark" width={12} /></button>
            </div>
            <div className="efPanneauCorps cosScroll">
              <div className="efLogoZone">
                {profilEdite.logo ? <img src={profilEdite.logo} alt="Logo" /> : <span className="efLogoVide">{initiales(profilEdite.nom)}</span>}
                <div>
                  <label className="efBouton">
                    <Icon fafa="faImage" width={12} />
                    <span>{profilEdite.logo ? "Changer le logo" : "Ajouter un logo"}</span>
                    <input type="file" accept="image/*" hidden onChange={chargerImage("logo")} />
                  </label>
                  {profilEdite.logo ? (
                    <button type="button" className="efLien" onClick={() => setProfilEdite((p) => ({ ...p, logo: "" }))}>Retirer</button>
                  ) : null}
                </div>
              </div>
              {[
                ["nom", "Raison sociale"],
                ["adresse", "Adresse"],
                ["ville", "Ville"],
                ["pays", "Pays"],
                ["email", "E-mail"],
                ["telephone", "Téléphone"],
                ["ncc", "NCC (compte contribuable)"],
                ["rccm", "RCCM"],
              ].map(([champ, libelle]) => (
                <Champ key={champ} label={libelle}>
                  <input value={profilEdite[champ] || ""} onChange={(e) => setProfilEdite((p) => ({ ...p, [champ]: e.target.value }))} />
                </Champ>
              ))}
              <h4>Paiement</h4>
              {[
                ["banque", "Banque"],
                ["titulaire", "Titulaire du compte"],
                ["iban", "RIB / IBAN"],
                ["mobileOperateur", "Opérateur Mobile Money (Orange, MTN, Wave…)"],
                ["mobileNumero", "Numéro Mobile Money"],
              ].map(([champ, libelle]) => (
                <Champ key={champ} label={libelle}>
                  <input value={profilEdite[champ] || ""} onChange={(e) => setProfilEdite((p) => ({ ...p, [champ]: e.target.value }))} />
                </Champ>
              ))}
              <h4>Signature et mentions</h4>
              <Champ label="Nom du signataire">
                <input value={profilEdite.signataire || ""} onChange={(e) => setProfilEdite((p) => ({ ...p, signataire: e.target.value }))} />
              </Champ>
              <div className="efLogoZone">
                {profilEdite.signatureImage ? <img src={profilEdite.signatureImage} alt="Signature" /> : null}
                <label className="efBouton">
                  <Icon fafa="faSignature" width={12} />
                  <span>{profilEdite.signatureImage ? "Changer la signature" : "Image de signature (facultative)"}</span>
                  <input type="file" accept="image/*" hidden onChange={chargerImage("signatureImage")} />
                </label>
                {profilEdite.signatureImage ? (
                  <button type="button" className="efLien" onClick={() => setProfilEdite((p) => ({ ...p, signatureImage: "" }))}>Retirer</button>
                ) : null}
              </div>
              <Champ label="Mentions en pied de page">
                <textarea rows={2} value={profilEdite.mentions || ""} placeholder="Capital, régime fiscal, pénalités de retard…" onChange={(e) => setProfilEdite((p) => ({ ...p, mentions: e.target.value }))} />
              </Champ>
              <button type="button" className="efPrincipal efLarge" disabled={occupe} onClick={enregistrerProfil}>
                Enregistrer le profil
              </button>
            </div>
          </aside>
        ) : null}

        {panneau === "ouvrir" ? (
          <aside className="efPanneau" aria-label="Ouvrir une facture">
            <div className="efPanneauTete">
              <h3>Ouvrir une facture</h3>
              <button type="button" className="efIconeBouton" aria-label="Fermer" onClick={() => setPanneau(null)}><Icon fafa="faXmark" width={12} /></button>
            </div>
            <div className="efPanneauCorps cosScroll">
              <Champ label="Rechercher" icone="faMagnifyingGlass">
                <input autoFocus value={recherche} placeholder="Numéro ou client" onChange={(e) => setRecherche(e.target.value)} />
              </Champ>
              {facturesVisibles.length ? facturesVisibles.slice(0, 80).map((d) => (
                <button type="button" key={d.id} className="efListeLigne" data-actif={d.id === ficheId} onClick={() => ouvrirFiche(d, profil)}>
                  <span>
                    <b>{d.data.numero}</b>
                    <small>{d.data.clientEntreprise || d.data.clientNom || "—"} · {new Date(`${d.data.date}T00:00:00`).toLocaleDateString("fr-FR")}</small>
                  </span>
                  <span className="efListeMontant">{montantDans(chiffres(depuisFacturation(d.data)).total, d.data.devise)}</span>
                </button>
              )) : <p className="efAide">Aucune facture{recherche ? " ne correspond" : " pour l'instant"}.</p>}
            </div>
          </aside>
        ) : null}

        {panneau === "recurrences" ? (
          <aside className="efPanneau" aria-label="Factures récurrentes">
            <div className="efPanneauTete">
              <h3>Factures récurrentes</h3>
              <button type="button" className="efIconeBouton" aria-label="Fermer" onClick={() => setPanneau(null)}><Icon fafa="faXmark" width={12} /></button>
            </div>
            <div className="efPanneauCorps cosScroll">
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
                      <button type="button" className="efIconeBouton" title={r.data.actif === false ? "Reprendre" : "Suspendre"} onClick={() => basculerRecurrence(r)}>
                        <Icon fafa={r.data.actif === false ? "faPlay" : "faPause"} width={11} />
                      </button>
                      <button type="button" className="efIconeBouton" title="Arrêter" onClick={() => supprimerRecurrence(r)}>
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
            </div>
          </aside>
        ) : null}

        {pleinEcran ? (
          <div className="efPleinEcran" role="dialog" aria-label="Aperçu de la facture">
            <div className="efPleinEcranBarre">
              <span>Aperçu · {facture.numero}</span>
              <span className="efEspace" />
              <button type="button" className="efBouton" onClick={telechargerPdf}><Icon fafa="faFilePdf" width={12} /><span>PDF</span></button>
              <button type="button" className="efBouton" onClick={imprimer}><Icon fafa="faPrint" width={12} /><span>Imprimer</span></button>
              <button type="button" className="efBouton efCarre" aria-label="Fermer l'aperçu" onClick={() => setPleinEcran(false)}><Icon fafa="faXmark" width={13} /></button>
            </div>
            <div className="efPleinEcranPage cosScroll">
              <Apercu facture={facture} emetteur={profil} />
            </div>
          </div>
        ) : null}
      </div>
    </ModuleWindow>
  );
}
