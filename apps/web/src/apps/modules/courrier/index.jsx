// Courrier.
//
// ─────────────────────────────────────────────────────────────────────────
// LA MESSAGERIE DE L'ENTREPRISE, RELIÉE AU RESTE DE L'OS
//
// Trois volets : dossiers et boîtes, conversations, lecture — et un
// quatrième, le correspondant tel que le connaissent le CRM, la
// Facturation, les RH et Projets. Les boîtes IMAP reliées sont relevées
// toutes les deux minutes ; on répond sous la conversation, brouillon
// enregistré tout seul, envoi annulable ou programmé.
//
// C'est aussi un **service** : n'importe quelle application appelle
// `composerCourriel({...})` (src/apps/courrielRequest.js) et cette fenêtre
// s'ouvre sur un brouillon prérempli, pièces du Cloud comprises.
// L'utilisateur relit, puis envoie — jamais d'envoi dans son dos.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { useTelephone } from "../../../utils/telephone";
import { api } from "../../../api/client";
import { EVT_COURRIER } from "../../../api/tempsReel";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { menuContextuel } from "../../menuRequest";
import { prendreBrouillon, surBrouillon } from "../../courrielRequest";
import {
  citation,
  dateListe,
  enteteTransfert,
  htmlDeTexte,
  listeAdresses,
  nomAffiche,
  repondreATous,
  sujetReponse,
  sujetTransfert,
} from "@companyos/shared/courrier";
import { Composeur } from "./Composeur";
import { Lecture } from "./Lecture";
import { Contexte } from "./Contexte";
import { Reglages } from "./Reglages";
import { DOSSIERS, initiales, quand, teinte } from "./outils";
import "./courrier.scss";
import { manifest as descriptif } from "./manifest";

export const manifest = { ...descriptif, Window: CourrierApp };

const CLE_CONTEXTE = "companyos-courrier-contexte";
const lireContexte = () => {
  try {
    return localStorage.getItem(CLE_CONTEXTE) !== "0";
  } catch {
    return true;
  }
};

const enHtmlSignature = (s) => (s ? `<p><br></p><p>--<br>${htmlDeTexte(s).replace(/^<p>|<\/p>$/g, "")}</p>` : "");

/// Le brouillon d'une autre app (forme historique : chaînes, texte brut,
/// `pieceJointeId`) en composition.
const depuisService = (b = {}) => {
  const pieces = [...(b.pieces || [])];
  if (b.pieceJointeId) pieces.push({ id: b.pieceJointeId, nom: b.pieceJointeNom || "pièce jointe" });
  return {
    a: listeAdresses(b.a || ""),
    cc: listeAdresses(b.cc || ""),
    sujet: b.sujet || "",
    html: b.html || (b.texte ? htmlDeTexte(b.texte) : ""),
    pieces: pieces.map((p) => ({ fsNodeId: p.id || p.fsNodeId, nom: p.nom, taille: p.taille || 0, type: p.type })),
  };
};

function CourrierApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const estAdmin = ["OWNER", "ADMIN"].includes(session.user?.role);
  const telephone = useTelephone();

  const [vue, setVue] = useState({ dossier: "reception", boiteId: null });
  const [filtre, setFiltre] = useState("tous");
  const [saisie, setSaisie] = useState("");
  const [recherche, setRecherche] = useState("");
  const [conversations, setConversations] = useState([]);
  const [suite, setSuite] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [compteurs, setCompteurs] = useState({ nonLus: {}, parBoite: {} });
  const [boites, setBoites] = useState([]);
  const [modeles, setModeles] = useState([]);
  const [selection, setSelection] = useState(null);
  const [fil, setFil] = useState(null);
  const [composition, setComposition] = useState(null);
  const [contexteOuvert, setContexteOuvert] = useState(lireContexte);
  const [coches, setCoches] = useState(() => new Set());
  const [navOuverte, setNavOuverte] = useState(false);
  const [releve, setReleve] = useState(false);
  const champRecherche = useRef(null);
  const jeton = useRef(0);

  // ---- Chargements --------------------------------------------------------

  const chargerBase = useCallback(async () => {
    const [b, m, c] = await Promise.all([
      api.messagerie.boites().catch(() => []),
      api.records.list("courrier", "modeles").catch(() => []),
      api.messagerie.compteurs().catch(() => null),
    ]);
    setBoites(Array.isArray(b) ? b : []);
    setModeles((m || []).sort((x, y) => (x.data.nom || "").localeCompare(y.data.nom || "")));
    if (c) setCompteurs(c);
  }, []);

  const filtres = useMemo(
    () => ({
      ...(vue.dossier === "suivis" ? { vue: "suivis" } : { dossier: vue.dossier }),
      boiteId: vue.boiteId,
      filtre: filtre === "tous" ? null : filtre,
      q: recherche,
    }),
    [vue, filtre, recherche],
  );

  const chargerListe = useCallback(
    async ({ silencieux = false } = {}) => {
      if (vue.dossier === "reglages") return;
      const mien = ++jeton.current;
      if (!silencieux) setChargement(true);
      try {
        const r = await api.messagerie.conversations(filtres);
        if (mien !== jeton.current) return;
        setConversations(r.conversations || []);
        setSuite(r.suite || null);
        setErreur("");
      } catch (e) {
        if (mien === jeton.current) setErreur(e.message);
      } finally {
        if (mien === jeton.current) setChargement(false);
      }
    },
    [filtres, vue.dossier],
  );

  const chargerFil = useCallback(async (filId) => {
    if (!filId) return setFil(null);
    try {
      const r = await api.messagerie.fil(filId);
      setFil({ filId, ...r });
    } catch {
      setFil(null);
    }
  }, []);

  useEffect(() => {
    if (ouvert) chargerBase();
  }, [ouvert, chargerBase]);
  useEffect(() => {
    if (ouvert) chargerListe();
  }, [ouvert, chargerListe]);

  // Recherche : on attend que la frappe se pose.
  useEffect(() => {
    const t = setTimeout(() => setRecherche(saisie.trim()), 300);
    return () => clearTimeout(t);
  }, [saisie]);

  // Temps réel : nouveaux courriels, ou changements faits ailleurs.
  const selRef = useRef(selection);
  selRef.current = selection;
  useEffect(() => {
    let t;
    const surCourrier = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        chargerListe({ silencieux: true });
        api.messagerie.compteurs().then(setCompteurs).catch(() => {});
        if (selRef.current) chargerFil(selRef.current);
      }, 400);
    };
    window.addEventListener(EVT_COURRIER, surCourrier);
    return () => {
      clearTimeout(t);
      window.removeEventListener(EVT_COURRIER, surCourrier);
    };
  }, [chargerListe, chargerFil]);

  // Brouillon poussé par une autre application.
  useEffect(() => {
    const appliquer = (b) => {
      if (!b) return;
      setComposition({ mode: "nouveau", cle: Date.now(), initial: depuisService(b) });
      setSelection(null);
      setFil(null);
    };
    appliquer(prendreBrouillon());
    return surBrouillon(appliquer);
  }, []);

  // Lien depuis une notification : « Awa : Devis » ouvre la conversation.
  useEffect(() => {
    const aller = async (e) => {
      if (e.detail?.app !== manifest.id || !e.detail.params?.courriel) return;
      const c = await api.messagerie.courriel(e.detail.params.courriel).catch(() => null);
      if (!c) return;
      setVue({ dossier: c.dossier === "brouillons" ? "brouillons" : c.dossier, boiteId: null });
      setComposition(null);
      setSelection(c.filId);
      chargerFil(c.filId);
    };
    window.addEventListener("companyos:lien", aller);
    return () => window.removeEventListener("companyos:lien", aller);
  }, [chargerFil]);

  const basculerContexte = () =>
    setContexteOuvert((v) => {
      try {
        localStorage.setItem(CLE_CONTEXTE, v ? "0" : "1");
      } catch {
        // préférence de session
      }
      return !v;
    });

  // ---- Sélection, actions ----------------------------------------------------

  const mesAdresses = useMemo(() => [session.user?.email, ...boites.map((b) => b.adresse)].filter(Boolean), [session.user, boites]);
  const boiteParDefaut = (boiteId) => boites.find((b) => b.id === boiteId) || boites.find((b) => b.mienne) || boites[0] || null;
  const signatureDe = (boiteId) => enHtmlSignature(boiteParDefaut(boiteId)?.signature);

  const ouvrirConversation = async (c) => {
    if (vue.dossier === "brouillons" || vue.dossier === "programmes") {
      const d = await api.messagerie.courriel(c.id).catch(() => null);
      if (!d) return;
      setSelection(null);
      setFil(null);
      setComposition({
        mode: "nouveau",
        cle: d.id,
        initial: {
          titre: d.statut === "programme" ? `Programmé ${quand(d.envoiLe)} — modifier annule la programmation` : "Brouillon",
          brouillonId: d.id,
          boiteId: d.boiteId,
          a: d.a,
          cc: d.cc,
          cci: d.cci,
          sujet: d.sujet,
          html: d.html || htmlDeTexte(d.texte),
          pieces: d.pieces || [],
          inReplyTo: d.inReplyTo,
          references: d.references,
          filId: d.filId,
          liens: d.liens,
        },
      });
      return;
    }
    setComposition(null);
    setSelection(c.filId);
    chargerFil(c.filId);
    if (c.nonLus) {
      setConversations((l) => l.map((x) => (x.filId === c.filId ? { ...x, nonLus: 0, lu: true } : x)));
      await api.messagerie.maj({ fils: [c.filId], lu: true }).catch(() => {});
      api.messagerie.compteurs().then(setCompteurs).catch(() => {});
    }
  };

  const agir = async (action, fils) => {
    const corps = {
      archiver: { dossier: "archives" },
      corbeille: { dossier: "corbeille" },
      reception: { dossier: "reception" },
      indesirable: { dossier: "indesirables" },
      nonlu: { lu: false },
      lu: { lu: true },
      suivre: { suivi: true },
      nePlusSuivre: { suivi: false },
    }[action];
    if (!corps || !fils.length) return;
    // Mise à jour immédiate de la liste ; le serveur confirme derrière.
    if (corps.dossier) {
      setConversations((l) => l.filter((x) => !fils.includes(x.filId)));
      if (fils.includes(selection)) {
        setSelection(null);
        setFil(null);
        setComposition(null);
      }
    } else {
      setConversations((l) =>
        l.map((x) => (fils.includes(x.filId) ? { ...x, ...(corps.lu !== undefined ? { nonLus: corps.lu ? 0 : 1 } : {}), ...(corps.suivi !== undefined ? { suivi: corps.suivi } : {}) } : x)),
      );
      if (action === "nonlu" && fils.includes(selection)) {
        setSelection(null);
        setFil(null);
      }
    }
    setCoches(new Set());
    try {
      await api.messagerie.maj({ fils, ...corps });
      const libelles = { archiver: "Archivé", corbeille: "Mis à la corbeille", reception: "Remis en boîte de réception", indesirable: "Classé indésirable" };
      if (libelles[action]) notifier({ titre: `${libelles[action]}${fils.length > 1 ? ` (${fils.length})` : ""}`, app: "Courrier", ton: "success" });
    } catch (e) {
      modal.alert({ title: "Action impossible", message: e.message, tone: "error" });
    } finally {
      chargerListe({ silencieux: true });
      api.messagerie.compteurs().then(setCompteurs).catch(() => {});
      if (selection && !corps.dossier) chargerFil(selection);
    }
  };

  const viderCorbeille = async () => {
    const ok = await modal.confirm({ title: "Vider la corbeille ?", message: "Les courriels de la corbeille seront supprimés définitivement de CompanyOS.", confirmLabel: "Vider", danger: true });
    if (!ok) return;
    await api.messagerie.viderCorbeille().catch((e) => modal.alert({ title: "Action impossible", message: e.message, tone: "error" }));
    setSelection(null);
    setFil(null);
    chargerListe();
    chargerBase();
  };

  // ---- Composer ---------------------------------------------------------------

  const nouveau = () => {
    setSelection(null);
    setFil(null);
    const b = boiteParDefaut(vue.boiteId);
    setComposition({ mode: "nouveau", cle: Date.now(), initial: { boiteId: b?.id || null, html: `<p><br></p>${signatureDe(b?.id)}` } });
  };

  const versMessage = (m) => ({ deNom: m.de?.nom, deEmail: m.de?.email, a: m.a, cc: m.cc, date: m.date, texte: m.texte, html: m.html, sujet: m.sujet });

  const repondre = (m, tous = false) => {
    if (!m) return;
    const recu = m.statut === "recu";
    const dest = tous ? repondreATous(versMessage(m), recu ? mesAdresses : []) : { a: recu ? [m.de] : m.a, cc: [] };
    // Répondre à un message qu'on a soi-même envoyé : on écrit à ses destinataires.
    if (!recu && tous) dest.a = m.a;
    const c = citation(versMessage(m));
    setComposition({
      mode: "reponse",
      cle: `${m.id}-${tous}-${Date.now()}`,
      initial: {
        boiteId: m.boiteId || boiteParDefaut()?.id || null,
        a: dest.a,
        cc: dest.cc,
        sujet: sujetReponse(m.sujet),
        html: `<p><br></p>${signatureDe(m.boiteId)}${c.html}`,
        inReplyTo: m.messageId || null,
        references: [...(m.references || []), m.messageId].filter(Boolean),
        filId: m.filId,
        liens: m.liens || [],
      },
    });
  };

  const transferer = (m) => {
    if (!m) return;
    const t = enteteTransfert(versMessage(m));
    setComposition({
      mode: "reponse",
      cle: `${m.id}-tr-${Date.now()}`,
      initial: {
        boiteId: m.boiteId || boiteParDefaut()?.id || null,
        a: [],
        sujet: sujetTransfert(m.sujet),
        html: `<p><br></p>${signatureDe(m.boiteId)}${t.html}`,
        pieces: (m.pieces || []).filter((p) => p.fsNodeId),
      },
    });
  };

  const apresEnvoi = (c, envoiLe) => {
    setComposition(null);
    notifier({
      titre: envoiLe ? `Envoi programmé ${quand(envoiLe)}` : "Courriel envoyé",
      message: c?.a?.map((x) => x.email).join(", "),
      app: "Courrier",
      ton: "success",
    });
    chargerListe({ silencieux: true });
    chargerBase();
    if (selection) chargerFil(selection);
  };

  // ---- Clavier ----------------------------------------------------------------

  const surTouche = (e) => {
    const cible = e.target;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName) || cible.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const i = conversations.findIndex((c) => c.filId === selection);
    const touche = e.key;
    const actuelle = conversations[i];
    const dernier = fil?.messages?.[fil.messages.length - 1];
    if (touche === "j" || touche === "ArrowDown") {
      e.preventDefault();
      const c = conversations[Math.min(conversations.length - 1, i + 1)];
      if (c) ouvrirConversation(c);
    } else if (touche === "k" || touche === "ArrowUp") {
      e.preventDefault();
      const c = conversations[Math.max(0, i - 1)];
      if (c) ouvrirConversation(c);
    } else if (touche === "c") {
      e.preventDefault();
      nouveau();
    } else if (touche === "/") {
      e.preventDefault();
      champRecherche.current?.focus();
    } else if (touche === "Escape") {
      if (composition) setComposition(null);
      else if (selection) (setSelection(null), setFil(null));
    } else if (actuelle) {
      if (touche === "e") agir(vue.dossier === "archives" ? "reception" : "archiver", [actuelle.filId]);
      else if (touche === "#" || touche === "Delete") agir("corbeille", [actuelle.filId]);
      else if (touche === "s") agir(actuelle.suivi ? "nePlusSuivre" : "suivre", [actuelle.filId]);
      else if (touche === "u") agir("nonlu", [actuelle.filId]);
      else if (touche === "r" && dernier) (e.preventDefault(), repondre(dernier));
      else if (touche === "a" && dernier) (e.preventDefault(), repondre(dernier, true));
      else if (touche === "f" && dernier) (e.preventDefault(), transferer(dernier));
    }
  };

  // ---- Rendu ------------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="crrApp">
        <div className="crrVerrou">Connectez-vous pour lire et écrire vos courriels.</div>
      </ModuleWindow>
    );
  }

  const enReglages = vue.dossier === "reglages";
  const dossierCourant = DOSSIERS.find((d) => d.id === vue.dossier);
  const titreListe = vue.boiteId ? boites.find((b) => b.id === vue.boiteId)?.nom || "Boîte" : dossierCourant?.libelle || "Courrier";
  const dernier = fil?.messages?.[fil.messages.length - 1];
  const moi = new Set(mesAdresses.map((x) => x.toLowerCase()));
  const correspondant = (() => {
    if (!fil) return null;
    for (let k = fil.messages.length - 1; k >= 0; k--) {
      const m = fil.messages[k];
      if (m.statut === "recu" && m.de?.email && !moi.has(m.de.email)) return m.de;
      const autre = (m.a || []).find((x) => !moi.has(x.email));
      if (autre) return autre;
    }
    return null;
  })();
  const conversationCourante = conversations.find((c) => c.filId === selection);
  const ecran = enReglages ? "reglages" : composition?.mode === "nouveau" ? "composer" : selection ? "lecture" : "liste";
  const compte = (id) => (id === "brouillons" ? compteurs.brouillons : id === "programmes" ? compteurs.programmes : id === "suivis" ? 0 : compteurs.nonLus?.[id] || 0);

  const changerVue = (v) => {
    setVue(v);
    setSelection(null);
    setFil(null);
    setCoches(new Set());
    setNavOuverte(false);
    if (composition?.mode === "reponse") setComposition(null);
  };

  const releverTout = async () => {
    setReleve(true);
    try {
      const cibles = vue.boiteId ? boites.filter((b) => b.id === vue.boiteId) : boites;
      let n = 0;
      for (const b of cibles) n += (await api.messagerie.synchroniser(b.id).catch(() => ({ nouveaux: 0 }))).nouveaux || 0;
      await Promise.all([chargerListe({ silencieux: true }), chargerBase()]);
      if (cibles.length) notifier({ titre: n ? `${n} nouveau${n > 1 ? "x" : ""} courriel${n > 1 ? "s" : ""}` : "Aucun nouveau courriel", app: "Courrier" });
    } finally {
      setReleve(false);
    }
  };

  const menuConversation = (c) => (e) =>
    menuContextuel(e, [
      { nom: c.nonLus ? "Marquer comme lu" : "Marquer comme non lu", icone: "faEnvelopeOpen", action: () => agir(c.nonLus ? "lu" : "nonlu", [c.filId]) },
      { nom: c.suivi ? "Ne plus suivre" : "Suivre", icone: "faStar", action: () => agir(c.suivi ? "nePlusSuivre" : "suivre", [c.filId]) },
      { separateur: true },
      vue.dossier !== "archives" && { nom: "Archiver", icone: "faBoxArchive", raccourci: "E", action: () => agir("archiver", [c.filId]) },
      vue.dossier !== "reception" && { nom: "Remettre en boîte de réception", icone: "faInbox", action: () => agir("reception", [c.filId]) },
      vue.dossier !== "indesirables" && c.statut === "recu" && { nom: "Indésirable", icone: "faBan", action: () => agir("indesirable", [c.filId]) },
      vue.dossier !== "corbeille" && { nom: "Mettre à la corbeille", icone: "faTrashCan", raccourci: "#", danger: true, action: () => agir("corbeille", [c.filId]) },
    ]);

  const toutCoche = conversations.length > 0 && coches.size === conversations.length;
  const filsCoches = [...coches];

  return (
    <ModuleWindow manifest={manifest} className="crrApp">
      <div
        className="crrShell"
        data-telephone={telephone}
        data-ecran={ecran}
        data-contexte={!!(contexteOuvert && fil && correspondant && !telephone)}
        tabIndex={-1}
        onKeyDown={surTouche}
      >
        {/* ---- Dossiers et boîtes ---- */}
        {telephone && navOuverte ? <div className="crrVoile" onClick={() => setNavOuverte(false)} /> : null}
        <nav className="crrNav cosScroll" data-ouverte={navOuverte} aria-label="Dossiers">
          <button type="button" className="crrEcrire" onClick={() => (setNavOuverte(false), nouveau())}>
            <Icon fafa="faPenToSquare" width={13} />
            <span>Écrire</span>
          </button>
          <div className="crrNavTitre">Dossiers</div>
          {DOSSIERS.map((d) => (
            <button type="button" key={d.id} className="crrNavLigne" data-actif={vue.dossier === d.id && !vue.boiteId} onClick={() => changerVue({ dossier: d.id, boiteId: null })}>
              <Icon fafa={d.icone} width={13} />
              <span className="crrNavNom">{d.libelle}</span>
              {compte(d.id) ? <span className="crrNavCompte" data-fort={d.id === "reception"}>{compte(d.id)}</span> : null}
            </button>
          ))}
          {boites.length ? (
            <>
              <div className="crrNavTitre">Boîtes</div>
              {boites.map((b) => (
                <button type="button" key={b.id} className="crrNavLigne" data-actif={vue.boiteId === b.id} title={b.erreur || b.adresse} onClick={() => changerVue({ dossier: "reception", boiteId: b.id })}>
                  <span className="crrAvatar crrAvatarMini" style={{ background: teinte(b.adresse) }}>
                    {initiales({ nom: b.nom, email: b.adresse })}
                  </span>
                  <span className="crrNavNom">{b.nom}</span>
                  {b.erreur ? <span className="crrNavErreur" title={b.erreur}>!</span> : compteurs.parBoite?.[b.id] ? <span className="crrNavCompte">{compteurs.parBoite[b.id]}</span> : null}
                </button>
              ))}
            </>
          ) : null}
          <div className="crrNavFin">
            <button type="button" className="crrNavLigne" data-actif={enReglages} onClick={() => changerVue({ dossier: "reglages", boiteId: null })}>
              <Icon fafa="faGear" width={13} />
              <span className="crrNavNom">Réglages</span>
            </button>
          </div>
        </nav>

        {enReglages ? (
          <section className="crrColonneLarge">
            <Reglages boites={boites} modeles={modeles} estAdmin={estAdmin} onRecharger={chargerBase} telephone={telephone} onRetour={() => changerVue({ dossier: "reception", boiteId: null })} />
          </section>
        ) : (
          <>
            {/* ---- Conversations ---- */}
            <section className="crrColonneListe" aria-label="Conversations">
              <div className="crrListeTete">
                {telephone ? (
                  <button type="button" className="crrIconeBtn" aria-label="Dossiers" onClick={() => setNavOuverte(true)}>
                    <Icon fafa="faBars" width={14} />
                  </button>
                ) : null}
                <h2>{titreListe}</h2>
                {vue.dossier === "corbeille" && conversations.length ? (
                  <button type="button" className="crrLienDiscret" onClick={viderCorbeille}>
                    Vider
                  </button>
                ) : null}
                <span className="crrPiedEspace" />
                {boites.length ? (
                  <button type="button" className="crrIconeBtn" title="Relever les boîtes" data-tourne={releve} disabled={releve} onClick={releverTout}>
                    <Icon fafa="faRotate" width={12} />
                  </button>
                ) : null}
              </div>
              <label className="crrRecherche">
                <Icon fafa="faMagnifyingGlass" width={12} />
                <input ref={champRecherche} value={saisie} placeholder="Rechercher (/)" aria-label="Rechercher dans le courrier" onChange={(e) => setSaisie(e.target.value)} />
                {saisie ? (
                  <button type="button" aria-label="Effacer" onClick={() => setSaisie("")}>
                    <Icon fafa="faXmark" width={10} />
                  </button>
                ) : null}
              </label>
              <div className="crrOnglets" role="tablist">
                {[
                  ["tous", "Tous"],
                  ["nonlus", "Non lus"],
                  ["pieces", "Pièces jointes"],
                ].map(([id, libelle]) => (
                  <button type="button" key={id} role="tab" aria-selected={filtre === id} data-actif={filtre === id} onClick={() => setFiltre(id)}>
                    {libelle}
                  </button>
                ))}
              </div>

              {coches.size ? (
                <div className="crrActionsGroupees">
                  <label className="crrCase">
                    <input type="checkbox" checked={toutCoche} onChange={() => setCoches(toutCoche ? new Set() : new Set(conversations.map((c) => c.filId)))} />
                  </label>
                  <span>{coches.size} sélectionnée{coches.size > 1 ? "s" : ""}</span>
                  <span className="crrPiedEspace" />
                  <button type="button" className="crrIconeBtn" title="Marquer comme lu" onClick={() => agir("lu", filsCoches)}>
                    <Icon fafa="faEnvelopeOpen" width={12} />
                  </button>
                  {vue.dossier !== "archives" ? (
                    <button type="button" className="crrIconeBtn" title="Archiver" onClick={() => agir("archiver", filsCoches)}>
                      <Icon fafa="faBoxArchive" width={12} />
                    </button>
                  ) : null}
                  <button type="button" className="crrIconeBtn" title="Mettre à la corbeille" onClick={() => agir(vue.dossier === "corbeille" ? "reception" : "corbeille", filsCoches)}>
                    <Icon fafa={vue.dossier === "corbeille" ? "faTrashArrowUp" : "faTrashCan"} width={12} />
                  </button>
                </div>
              ) : null}

              <div className="crrConversations cosScroll">
                {erreur ? <div className="crrAlerte">{erreur}</div> : null}
                {chargement && !conversations.length ? (
                  <div className="crrSquelettes">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="crrSquelette" />
                    ))}
                  </div>
                ) : null}
                {!chargement && !conversations.length && !erreur ? (
                  <div className="crrVide">
                    <Icon fafa={dossierCourant?.icone || "faInbox"} width={26} />
                    <strong>{recherche ? "Aucun résultat" : vue.dossier === "reception" ? "Boîte de réception vide" : "Rien ici"}</strong>
                    {vue.dossier === "reception" && !boites.length && !recherche ? (
                      <>
                        <span>Reliez votre adresse professionnelle pour recevoir et répondre depuis CompanyOS.</span>
                        <button type="button" className="crrEnvoyer" onClick={() => changerVue({ dossier: "reglages", boiteId: null })}>
                          Relier une boîte
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {conversations.map((c) => {
                  const envoi = ["envoyes", "brouillons", "programmes"].includes(vue.dossier) || (c.statut !== "recu" && vue.dossier !== "reception");
                  const qui = envoi ? (c.a?.length ? `À ${c.a.map((x) => nomAffiche(x)).join(", ")}` : "(sans destinataire)") : nomAffiche(c.de);
                  const personne = envoi ? c.a?.[0] || {} : c.de;
                  return (
                    <div
                      key={c.filId}
                      role="button"
                      tabIndex={0}
                      className="crrConversation"
                      data-actif={selection === c.filId}
                      data-nonlu={c.nonLus > 0}
                      data-coche={coches.has(c.filId)}
                      onClick={() => ouvrirConversation(c)}
                      onKeyDown={(e) => e.key === "Enter" && ouvrirConversation(c)}
                      onContextMenu={menuConversation(c)}
                    >
                      <button
                        type="button"
                        className="crrAvatar crrAvatarListe"
                        style={{ background: teinte(personne?.email) }}
                        aria-label={coches.has(c.filId) ? "Désélectionner" : "Sélectionner"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCoches((s) => {
                            const n = new Set(s);
                            if (n.has(c.filId)) n.delete(c.filId);
                            else n.add(c.filId);
                            return n;
                          });
                        }}
                      >
                        {coches.has(c.filId) ? <Icon fafa="faCheck" width={12} /> : initiales(personne)}
                      </button>
                      <div className="crrConversationCorps">
                        <div className="crrConversationHaut">
                          <span className="crrConversationQui">{qui}</span>
                          <span className="crrConversationDate">{c.statut === "programme" ? quand(c.envoiLe) : dateListe(c.date)}</span>
                          <button type="button" className="crrIconeBtn crrPlus" aria-label="Actions" onClick={(e) => (e.stopPropagation(), menuConversation(c)(e))}>
                            <Icon fafa="faEllipsis" width={12} />
                          </button>
                        </div>
                        <div className="crrConversationSujet">
                          {c.nonLus > 0 ? <span className="crrPoint" /> : null}
                          {c.statut === "brouillon" ? <span className="crrEtat" data-ton="brouillon">Brouillon</span> : null}
                          {c.statut === "echec" ? <span className="crrEtat" data-ton="echec">Non envoyé</span> : null}
                          {c.statut === "programme" ? <span className="crrEtat" data-ton="programme">Programmé</span> : null}
                          <span>{c.sujet || "(sans sujet)"}</span>
                        </div>
                        <div className="crrConversationExtrait">{c.extrait}</div>
                        <div className="crrConversationPuces">
                          {c.nombre > 1 ? <span className="crrMiniPuce" title="Messages dans la conversation"><Icon fafa="faComments" width={9} /> {c.nombre}</span> : null}
                          {c.avecPieces ? <span className="crrMiniPuce" title="Pièces jointes"><Icon fafa="faPaperclip" width={9} /> {c.pieces?.length || ""}</span> : null}
                          {(c.liens || []).slice(0, 2).map((l) => (
                            <span key={`${l.app}-${l.id}`} className="crrMiniPuce" data-app={l.app} title={l.libelle}>
                              <Icon fafa={l.app === "projets" ? "faTableColumns" : l.app === "agenda" ? "faCalendarDays" : l.app === "crm" ? "faUserTie" : "faLink"} width={9} />
                            </span>
                          ))}
                          <span className="crrPiedEspace" />
                          <button
                            type="button"
                            className="crrEtoile"
                            data-actif={!!c.suivi}
                            aria-label={c.suivi ? "Ne plus suivre" : "Suivre"}
                            onClick={(e) => (e.stopPropagation(), agir(c.suivi ? "nePlusSuivre" : "suivre", [c.filId]))}
                          >
                            <Icon fafa="faStar" reg={c.suivi ? undefined : true} width={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {suite ? (
                  <button
                    type="button"
                    className="crrPlusDeResultats"
                    onClick={async () => {
                      const r = await api.messagerie.conversations({ ...filtres, avant: suite });
                      setConversations((l) => [...l, ...(r.conversations || []).filter((x) => !l.some((y) => y.filId === x.filId))]);
                      setSuite(r.suite || null);
                    }}
                  >
                    Charger plus
                  </button>
                ) : null}
              </div>
              {telephone ? (
                <button type="button" className="crrFab" aria-label="Écrire" onClick={nouveau}>
                  <Icon fafa="faPenToSquare" width={16} />
                </button>
              ) : null}
            </section>

            {/* ---- Lecture / composition ---- */}
            <section className="crrColonneLecture" aria-label="Lecture">
              {composition?.mode === "nouveau" ? (
                <Composeur
                  key={composition.cle}
                  initial={composition.initial}
                  boites={boites}
                  modeles={modeles}
                  variante="plein"
                  onFerme={() => (setComposition(null), chargerListe({ silencieux: true }), chargerBase())}
                  onEnvoye={apresEnvoi}
                  onBrouillon={() => (vue.dossier === "brouillons" ? chargerListe({ silencieux: true }) : null, api.messagerie.compteurs().then(setCompteurs).catch(() => {}))}
                />
              ) : fil ? (
                <Lecture
                  fil={fil}
                  conversation={conversationCourante}
                  telephone={telephone}
                  onRetour={() => (setSelection(null), setFil(null), setComposition(null))}
                  onRepondre={(m) => repondre(m)}
                  onRepondreTous={(m) => repondre(m, true)}
                  onTransferer={transferer}
                  onSuivi={(v) => agir(v ? "suivre" : "nePlusSuivre", [fil.filId])}
                  onAction={(a) => agir(a === "archiver" ? "archiver" : a, [fil.filId])}
                  contexteOuvert={contexteOuvert}
                  onContexte={basculerContexte}
                  enfant={
                    composition?.mode === "reponse" ? (
                      <Composeur
                        key={composition.cle}
                        initial={composition.initial}
                        boites={boites}
                        modeles={modeles}
                        variante="integre"
                        onFerme={() => setComposition(null)}
                        onEnvoye={apresEnvoi}
                        onBrouillon={() => api.messagerie.compteurs().then(setCompteurs).catch(() => {})}
                      />
                    ) : dernier ? (
                      <button type="button" className="crrRepondreRapide" onClick={() => repondre(dernier)}>
                        <span className="crrAvatar crrAvatarMini" style={{ background: teinte(session.user?.email) }}>
                          {initiales({ nom: session.user?.name, email: session.user?.email })}
                        </span>
                        Répondre à {nomAffiche(dernier.statut === "recu" ? dernier.de : dernier.a?.[0] || {})}…
                      </button>
                    ) : null
                  }
                />
              ) : (
                <div className="crrAccueil">
                  <div className="crrAccueilIcone">
                    <Icon src="courrier" width={56} />
                  </div>
                  <strong>{compteurs.nonLus?.reception ? `${compteurs.nonLus.reception} message${compteurs.nonLus.reception > 1 ? "s" : ""} non lu${compteurs.nonLus.reception > 1 ? "s" : ""}` : "Tout est lu"}</strong>
                  <span>Choisissez une conversation, ou écrivez un nouveau message.</span>
                  <div className="crrRaccourcis">
                    <span><kbd>C</kbd> écrire</span>
                    <span><kbd>J</kbd>/<kbd>K</kbd> naviguer</span>
                    <span><kbd>R</kbd> répondre</span>
                    <span><kbd>E</kbd> archiver</span>
                    <span><kbd>/</kbd> rechercher</span>
                  </div>
                </div>
              )}
            </section>

            {contexteOuvert && fil && correspondant && !telephone ? (
              <Contexte personne={correspondant} conversation={conversationCourante || { filId: fil.filId }} fil={fil} onFerme={basculerContexte} onLie={() => (chargerFil(fil.filId), chargerListe({ silencieux: true }))} />
            ) : null}
          </>
        )}
      </div>
    </ModuleWindow>
  );
}
