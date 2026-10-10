// Les formulaires du CRM, ouverts dans la fenêtre modale du système.
//
// Chacun rend ses valeurs par `onValider` ; c'est l'appelant qui écrit.
// Ils vivent hors de la fenêtre du CRM (dans l'hôte des modales) : leurs
// styles sont donc globaux, préfixés `crmForm`.

import React, { useMemo, useState } from "react";
import { ETAPES, ETAPES_OUVERTES, STATUTS, plusJours, today } from "../domaine";
import { MOTIFS_PERTE, SOURCES, doublons, echeanceDans } from "../regles";

const ROLES = ["decideur", "influenceur", "utilisateur", "facturation", "technique", "autre"];

const Champ = ({ libelle, children, plein }) => (
  <label className="crmFormLigne" data-plein={plein ? "1" : undefined}>
    <span>{libelle}</span>
    {children}
  </label>
);

const Actions = ({ t, onValider, desactive, libelle }) => (
  <div className="crmFormActions">
    <button type="button" className="cosmPrimary handcr" onClick={onValider} disabled={desactive}>
      {libelle || t("enregistrer")}
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Compte
// ---------------------------------------------------------------------------

export const FormCompte = ({ t, defaut = {}, clients = [], membres = [], onValider, onOuvrir }) => {
  const [d, setD] = useState({
    entreprise: "", nom: "", email: "", telephone: "", ville: "", adresse: "",
    secteur: "", statut: "prospect", source: "", responsableId: "", notes: "",
    ...defaut,
    etiquettesTexte: (defaut.etiquettes || []).join(", "),
  });
  const [forcer, setForcer] = useState(false);
  const maj = (cle) => (e) => setD((x) => ({ ...x, [cle]: e.target.value }));
  const proches = useMemo(
    () => (defaut.id ? [] : doublons({ data: d }, clients)).slice(0, 1),
    [d.email, d.telephone, d.entreprise, d.nom], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const valide = (d.entreprise || d.nom).trim().length > 0;
  const soumettre = () => {
    if (!valide) return;
    if (proches.length && !forcer) return setForcer(true);
    const { etiquettesTexte, id: _id, ...reste } = d;
    onValider({
      ...reste,
      etiquettes: etiquettesTexte.split(",").map((x) => x.trim()).filter(Boolean),
    });
  };
  return (
    <div className="crmForm">
      <div className="crmFormGrille">
        <Champ libelle={t("entreprise")}><input value={d.entreprise} onChange={maj("entreprise")} autoFocus /></Champ>
        <Champ libelle={t("contactPrincipal")}><input value={d.nom} onChange={maj("nom")} /></Champ>
        <Champ libelle={t("telephone")}><input type="tel" value={d.telephone} onChange={maj("telephone")} /></Champ>
        <Champ libelle={t("email")}><input type="email" value={d.email} onChange={maj("email")} /></Champ>
        <Champ libelle={t("ville")}><input value={d.ville} onChange={maj("ville")} /></Champ>
        <Champ libelle={t("secteur")}><input value={d.secteur} onChange={maj("secteur")} /></Champ>
        <Champ libelle={t("adresse")} plein><input value={d.adresse} onChange={maj("adresse")} /></Champ>
        <Champ libelle={t("statut")}>
          <select value={d.statut} onChange={maj("statut")}>
            {Object.keys(STATUTS).map((s) => <option key={s} value={s}>{t(`statut_${s}`)}</option>)}
          </select>
        </Champ>
        <Champ libelle={t("source")}>
          <select value={d.source} onChange={maj("source")}>
            <option value="">—</option>
            {SOURCES.map((s) => <option key={s} value={s}>{t(`source_${s}`)}</option>)}
          </select>
        </Champ>
        <Champ libelle={t("responsable")}>
          <select value={d.responsableId} onChange={maj("responsableId")}>
            <option value="">{t("personne")}</option>
            {membres.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Champ>
        <Champ libelle={t("etiquettes")}><input value={d.etiquettesTexte} onChange={maj("etiquettesTexte")} placeholder="VIP, Abidjan" /></Champ>
        <Champ libelle={t("notes")} plein><textarea rows={3} value={d.notes} onChange={maj("notes")} /></Champ>
      </div>
      {proches.length ? (
        <div className="crmFormAlerte" role="status">
          <strong>{t("doublonPossible")}</strong>{" "}
          {t("doublonDetail", {
            nom: proches[0].client.data.entreprise || proches[0].client.data.nom,
            raisons: proches[0].raisons.map((r) => t(`raison_${r}`)).join(", "),
          })}
          {onOuvrir ? (
            <button type="button" className="crmFormLien" onClick={() => onOuvrir(proches[0].client)}>
              {t("ouvrirExistant")}
            </button>
          ) : null}
        </div>
      ) : null}
      <Actions
        t={t}
        onValider={soumettre}
        desactive={!valide}
        libelle={proches.length && forcer ? t("creerQuandMeme") : undefined}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Affaire
// ---------------------------------------------------------------------------

export const FormAffaire = ({ t, defaut = {}, clients = [], contacts = [], membres = [], onValider }) => {
  const [d, setD] = useState({
    libelle: "", clientId: "", contactId: "", montant: "", etape: "contact",
    probabilite: "", dateCloture: plusJours(30), responsableId: "", notes: "",
    ...defaut,
  });
  const maj = (cle) => (e) => setD((x) => ({ ...x, [cle]: e.target.value }));
  const contactsCompte = contacts.filter((c) => c.data.clientId === d.clientId);
  const valide = d.libelle.trim() && d.clientId;
  return (
    <div className="crmForm">
      <div className="crmFormGrille">
        <Champ libelle={t("libelle")} plein><input value={d.libelle} onChange={maj("libelle")} autoFocus /></Champ>
        <Champ libelle={t("compte")}>
          <select value={d.clientId} onChange={maj("clientId")}>
            <option value="">{t("choisirCompte")}</option>
            {[...clients]
              .sort((a, b) => (a.data.entreprise || a.data.nom || "").localeCompare(b.data.entreprise || b.data.nom || ""))
              .map((c) => <option key={c.id} value={c.id}>{c.data.entreprise || c.data.nom}</option>)}
          </select>
        </Champ>
        <Champ libelle={t("contactPrincipal")}>
          <select value={d.contactId} onChange={maj("contactId")}>
            <option value="">—</option>
            {contactsCompte.map((c) => <option key={c.id} value={c.id}>{[c.data.prenom, c.data.nom].filter(Boolean).join(" ")}</option>)}
          </select>
        </Champ>
        <Champ libelle={t("montant")}><input type="number" min="0" step="1000" value={d.montant} onChange={maj("montant")} /></Champ>
        <Champ libelle={t("colEtape")}>
          <select value={d.etape} onChange={maj("etape")}>
            {Object.keys(ETAPES).map((e) => <option key={e} value={e}>{t(`etape_${e}`)}</option>)}
          </select>
        </Champ>
        <Champ libelle={t("probabilite")}>
          <input type="number" min="0" max="100" value={d.probabilite} onChange={maj("probabilite")} placeholder={t("probabiliteAuto", { n: ETAPES[d.etape]?.probabilite ?? 0 })} />
        </Champ>
        <Champ libelle={t("dateCloture")}><input type="date" value={d.dateCloture} onChange={maj("dateCloture")} /></Champ>
        <Champ libelle={t("responsable")}>
          <select value={d.responsableId} onChange={maj("responsableId")}>
            <option value="">{t("personne")}</option>
            {membres.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Champ>
        {d.etape === "perdue" ? (
          <Champ libelle={t("motifPerteTitre")}>
            <select value={d.motifPerte || ""} onChange={maj("motifPerte")}>
              <option value="">—</option>
              {MOTIFS_PERTE.map((m) => <option key={m} value={m}>{t(`motif_${m}`)}</option>)}
            </select>
          </Champ>
        ) : null}
        <Champ libelle={t("notes")} plein><textarea rows={3} value={d.notes} onChange={maj("notes")} /></Champ>
      </div>
      <Actions
        t={t}
        desactive={!valide}
        onValider={() => valide && onValider({ ...d, libelle: d.libelle.trim(), montant: Number(d.montant) || 0 })}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export const FormContact = ({ t, defaut = {}, onValider }) => {
  const [d, setD] = useState({ prenom: "", nom: "", poste: "", role: "utilisateur", email: "", telephone: "", ...defaut });
  const maj = (cle) => (e) => setD((x) => ({ ...x, [cle]: e.target.value }));
  const valide = (d.nom || d.prenom).trim();
  return (
    <div className="crmForm">
      <div className="crmFormGrille">
        <Champ libelle={t("prenom")}><input value={d.prenom} onChange={maj("prenom")} autoFocus /></Champ>
        <Champ libelle={t("nomContact")}><input value={d.nom} onChange={maj("nom")} /></Champ>
        <Champ libelle={t("poste")}><input value={d.poste} onChange={maj("poste")} /></Champ>
        <Champ libelle={t("role")}>
          <select value={d.role} onChange={maj("role")}>
            {ROLES.map((r) => <option key={r} value={r}>{t(`role_${r}`)}</option>)}
          </select>
        </Champ>
        <Champ libelle={t("telephone")}><input type="tel" value={d.telephone} onChange={maj("telephone")} /></Champ>
        <Champ libelle={t("email")}><input type="email" value={d.email} onChange={maj("email")} /></Champ>
      </div>
      <Actions t={t} desactive={!valide} onValider={() => valide && onValider(d)} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Activité et compte rendu d'appel
// ---------------------------------------------------------------------------

/// Après un appel : résultat, compte rendu, prochaine action — et, si
/// l'affaire a avancé, sa nouvelle étape. Trois touchers sur un téléphone.
export const FormCompteRendu = ({ t, affaires = [], defaut = {}, onValider }) => {
  const [resultat, setResultat] = useState("joint");
  const [resume, setResume] = useState("");
  const [suite, setSuite] = useState("");
  const [quand, setQuand] = useState(plusJours(1));
  const [opportuniteId, setOpportuniteId] = useState(defaut.opportuniteId || affaires[0]?.id || "");
  const [etape, setEtape] = useState("");
  const raccourcis = [
    [t("demain"), plusJours(1)],
    ["+3 j", plusJours(3)],
    ["+7 j", plusJours(7)],
  ];
  return (
    <div className="crmForm">
      <div className="crmFormSeg" role="group" aria-label={t("resultat")}>
        {["joint", "messagerie", "absent"].map((r) => (
          <button key={r} type="button" data-on={resultat === r ? "1" : undefined} onClick={() => setResultat(r)}>
            {t(`res_${r}`)}
          </button>
        ))}
      </div>
      <Champ libelle={t("compteRendu")} plein>
        <textarea rows={3} value={resume} onChange={(e) => setResume(e.target.value)} autoFocus />
      </Champ>
      <Champ libelle={t("prochaineAction")} plein>
        <input value={suite} onChange={(e) => setSuite(e.target.value)} placeholder={t("prochaineActionAide")} />
      </Champ>
      <div className="crmFormPuces">
        {raccourcis.map(([lib, date]) => (
          <button key={lib} type="button" data-on={quand === date ? "1" : undefined} onClick={() => setQuand(date)}>{lib}</button>
        ))}
        <input type="date" value={quand} onChange={(e) => setQuand(e.target.value)} aria-label={t("quand")} />
      </div>
      {affaires.length ? (
        <div className="crmFormGrille">
          <Champ libelle={t("affaireLiee")}>
            <select value={opportuniteId} onChange={(e) => setOpportuniteId(e.target.value)}>
              <option value="">{t("aucuneAffaireLiee")}</option>
              {affaires.map((o) => <option key={o.id} value={o.id}>{o.data.libelle}</option>)}
            </select>
          </Champ>
          <Champ libelle={t("passerEtape")}>
            <select value={etape} onChange={(e) => setEtape(e.target.value)} disabled={!opportuniteId}>
              <option value="">{t("garderEtape")}</option>
              {ETAPES_OUVERTES.map((e) => <option key={e} value={e}>{t(`etape_${e}`)}</option>)}
            </select>
          </Champ>
        </div>
      ) : null}
      <Actions
        t={t}
        desactive={!resume.trim() && resultat === "joint"}
        onValider={() => onValider({ resultat, resume: resume.trim(), suite: suite.trim(), quand, opportuniteId, etape })}
      />
    </div>
  );
};

/// Une activité saisie à la main (type, date, échéance).
export const FormActivite = ({ t, affaires = [], defaut = {}, onValider }) => {
  const [d, setD] = useState({ type: "appel", resume: "", date: today(), echeance: plusJours(1), opportuniteId: "", ...defaut });
  const maj = (cle) => (e) => setD((x) => ({ ...x, [cle]: e.target.value }));
  return (
    <div className="crmForm">
      <div className="crmFormGrille">
        <Champ libelle={t("type")}>
          <select value={d.type} onChange={maj("type")}>
            {["appel", "reunion", "email", "note", "tache"].map((x) => <option key={x} value={x}>{t(`act_${x}`)}</option>)}
          </select>
        </Champ>
        {d.type === "tache" ? (
          <Champ libelle={t("echeance")}><input type="date" value={d.echeance} onChange={maj("echeance")} /></Champ>
        ) : (
          <Champ libelle={t("date")}><input type="date" value={d.date} onChange={maj("date")} /></Champ>
        )}
        <Champ libelle={t("resume")} plein><textarea rows={3} value={d.resume} onChange={maj("resume")} autoFocus /></Champ>
        {affaires.length ? (
          <Champ libelle={t("affaireLiee")} plein>
            <select value={d.opportuniteId} onChange={maj("opportuniteId")}>
              <option value="">{t("aucuneAffaireLiee")}</option>
              {affaires.map((o) => <option key={o.id} value={o.id}>{o.data.libelle}</option>)}
            </select>
          </Champ>
        ) : null}
      </div>
      <Actions t={t} desactive={!d.resume.trim()} onValider={() => d.resume.trim() && onValider(d)} />
    </div>
  );
};

/// Reporter une tâche : raccourcis ou date, ou une expression (« lundi »).
export const FormReporter = ({ t, onValider }) => {
  const [texte, setTexte] = useState("");
  const date = echeanceDans(texte) || (/^\d{4}-\d{2}-\d{2}$/.test(texte) ? texte : null);
  return (
    <div className="crmForm">
      <div className="crmFormPuces">
        {[[t("demain"), plusJours(1)], ["+3 j", plusJours(3)], ["+7 j", plusJours(7)], ["+30 j", plusJours(30)]].map(([lib, d]) => (
          <button key={lib} type="button" onClick={() => onValider(d)}>{lib}</button>
        ))}
        <input type="date" onChange={(e) => e.target.value && onValider(e.target.value)} aria-label={t("echeance")} />
      </div>
      <Champ libelle={t("quand")} plein>
        <input value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="lundi, dans 2 semaines, le 15…" />
      </Champ>
      <Actions t={t} desactive={!date} onValider={() => date && onValider(date)} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Perte, gain, rendez-vous, liste de campagne
// ---------------------------------------------------------------------------

export const FormMotifPerte = ({ t, onValider }) => (
  <div className="crmForm">
    <p className="crmFormAide">{t("motifPerteAide")}</p>
    <div className="crmFormChoix">
      {MOTIFS_PERTE.map((m) => (
        <button key={m} type="button" onClick={() => onValider(m)}>{t(`motif_${m}`)}</button>
      ))}
    </div>
  </div>
);

export const FormGagnee = ({ t, onValider }) => (
  <div className="crmForm">
    <p className="crmFormAide">{t("gagneeAide")}</p>
    <div className="crmFormChoix">
      <button type="button" onClick={() => onValider("facture")}>{t("gagneeFacture")}</button>
      <button type="button" onClick={() => onValider("projet")}>{t("gagneeProjet")}</button>
      <button type="button" onClick={() => onValider(null)}>{t("gagneeRien")}</button>
    </div>
  </div>
);

export const FormRdv = ({ t, defaut = {}, onValider }) => {
  const [d, setD] = useState({ titre: "", date: plusJours(1), heure: "10:00", lieu: "", ...defaut });
  const maj = (cle) => (e) => setD((x) => ({ ...x, [cle]: e.target.value }));
  return (
    <div className="crmForm">
      <div className="crmFormGrille">
        <Champ libelle={t("rdvObjet")} plein><input value={d.titre} onChange={maj("titre")} autoFocus /></Champ>
        <Champ libelle={t("date")}><input type="date" value={d.date} onChange={maj("date")} /></Champ>
        <Champ libelle={t("heure")}><input type="time" value={d.heure} onChange={maj("heure")} /></Champ>
        <Champ libelle={t("lieu")} plein><input value={d.lieu} onChange={maj("lieu")} /></Champ>
      </div>
      <Actions t={t} desactive={!d.titre.trim() || !d.date} onValider={() => onValider(d)} />
    </div>
  );
};

export const FormEtiquette = ({ t, existantes = [], onValider }) => {
  const [tag, setTag] = useState("");
  return (
    <div className="crmForm">
      <p className="crmFormAide">{t("etiquetteAide")}</p>
      {existantes.length ? (
        <div className="crmFormChoix">
          {existantes.map((e) => <button key={e} type="button" onClick={() => onValider(e)}>{e}</button>)}
        </div>
      ) : null}
      <Champ libelle={t("etiquette")} plein>
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="VIP" onKeyDown={(e) => e.key === "Enter" && tag.trim() && onValider(tag.trim())} />
      </Champ>
      <Actions t={t} desactive={!tag.trim()} onValider={() => onValider(tag.trim())} />
    </div>
  );
};

export const FormVue = ({ t, membres = [], defaut = {}, onValider }) => {
  const [d, setD] = useState({ nom: "", statut: "", ville: "", secteur: "", responsableId: "", etiquette: "", caMin: "", sansContact: "", ...defaut });
  const maj = (cle) => (e) => setD((x) => ({ ...x, [cle]: e.target.value }));
  return (
    <div className="crmForm">
      <div className="crmFormGrille">
        <Champ libelle={t("vueNom")} plein><input value={d.nom} onChange={maj("nom")} autoFocus /></Champ>
        <Champ libelle={t("statut")}>
          <select value={d.statut} onChange={maj("statut")}>
            <option value="">{t("tous")}</option>
            {Object.keys(STATUTS).map((s) => <option key={s} value={s}>{t(`statut_${s}`)}</option>)}
          </select>
        </Champ>
        <Champ libelle={t("responsable")}>
          <select value={d.responsableId} onChange={maj("responsableId")}>
            <option value="">{t("tous")}</option>
            {membres.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Champ>
        <Champ libelle={t("ville")}><input value={d.ville} onChange={maj("ville")} /></Champ>
        <Champ libelle={t("secteur")}><input value={d.secteur} onChange={maj("secteur")} /></Champ>
        <Champ libelle={t("etiquette")}><input value={d.etiquette} onChange={maj("etiquette")} /></Champ>
        <Champ libelle={t("caMin")}><input type="number" min="0" value={d.caMin} onChange={maj("caMin")} /></Champ>
        <Champ libelle={t("sansContactJours")}><input type="number" min="0" value={d.sansContact} onChange={maj("sansContact")} /></Champ>
      </div>
      <Actions t={t} desactive={!d.nom.trim()} onValider={() => {
        const { nom, ...criteres } = d;
        onValider({ nom: nom.trim(), criteres: Object.fromEntries(Object.entries(criteres).filter(([, v]) => v !== "")) });
      }} />
    </div>
  );
};
