// Campagnes — les contacts (ceux du CRM), leurs étiquettes, leur
// engagement, et l'import d'un fichier CSV.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../../utils/general";
import { api } from "../../../../api/client";
import { modal } from "../../../modalRequest";
import { notifier, suivreLien } from "../../../notifications";
import { blobDuFichier, choisirFichierCloud } from "../../../ChoisirFichier";
import * as D from "@companyos/shared/campagnes";
import { adresseValide } from "@companyos/shared/courrier";
import { Bouton, Carte, Entete, Etiquette, Onglets, Recherche, useC } from "../commun";

const FILTRES = ["tous", "engages", "inactifs", "rebonds", "desinscrits", "aConfirmer", "sansEmail"];

export const Contacts = () => {
  const s = useC();
  const { t, n, dateCourte, clients, engagement, contexte, intention, peutEcrire, tache, rafraichir } = s;
  const [filtre, setFiltre] = useState(intention?.filtre || "tous");
  const [liste, setListe] = useState(""); // statut CRM ou étiquette
  const [recherche, setRecherche] = useState("");
  const [choisis, setChoisis] = useState(() => new Set());
  const [importer, setImporter] = useState(!!intention?.importer);
  const [limite, setLimite] = useState(100);
  const etiquettes = useMemo(() => D.etiquettesDe(clients), [clients]);

  const garde = {
    tous: () => true,
    engages: (c) => (engagement[c.id]?.score || 0) >= 3,
    inactifs: (c) => D.estInactif(engagement[c.id]),
    rebonds: (c) => c.data.emailRebond,
    desinscrits: (c) => c.data.emailDesinscrit,
    aConfirmer: (c) => c.data.emailAConfirmer,
    sansEmail: (c) => !adresseValide(c.data.email),
  };
  const dansListe = (c) => !liste || (liste.startsWith("statut:") ? c.data.statut === liste.slice(7) : (c.data.etiquettes || []).includes(liste.slice(4)));
  const q = recherche.trim().toLowerCase();
  const visibles = clients
    .filter(dansListe)
    .filter(garde[filtre])
    .filter((c) => !q || [c.data.nom, c.data.entreprise, c.data.email, c.data.ville].some((v) => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => String(a.data.entreprise || a.data.nom).localeCompare(String(b.data.entreprise || b.data.nom)));

  const options = FILTRES.map((id) => ({ id, label: t(`contacts_${id}`), nb: clients.filter(dansListe).filter(garde[id]).length }));

  const ecrire = async (fiches) => {
    for (const f of fiches) await api.records.update("crm", "clients", f.id, f.data);
    await rafraichir();
  };

  const ajouterEtiquette = async () => {
    const tag = await modal.prompt({ title: t("ajouterEtiquette"), label: t("etiquette"), placeholder: "VIP", confirmLabel: t("ajouter") });
    if (!tag?.trim()) return;
    await tache(() => ecrire(clients.filter((c) => choisis.has(c.id)).map((c) => ({ id: c.id, data: { ...c.data, etiquettes: [...new Set([...(c.data.etiquettes || []), tag.trim()])] } }))));
    setChoisis(new Set());
  };

  const retirerEtiquette = async (tag) => {
    await tache(() => ecrire(clients.filter((c) => choisis.has(c.id) && (c.data.etiquettes || []).includes(tag)).map((c) => ({ id: c.id, data: { ...c.data, etiquettes: c.data.etiquettes.filter((e) => e !== tag) } }))));
  };

  const reactiver = async (c) => {
    const ok = await modal.confirm({ title: t("reactiverTitre"), message: t("reactiverMessage", { email: c.data.email }), detail: c.data.emailRebondRaison || "", confirmLabel: t("reactiver") });
    if (!ok) return;
    const { emailRebond: _r, emailRebondLe: _l, emailRebondRaison: _m, ...reste } = c.data;
    await tache(() => ecrire([{ id: c.id, data: reste }]));
  };

  const origine = (src) => (["formulaire", "import", "crm"].includes(src) ? t(`origine_${src}`) : src);
  const basculer = (id) => setChoisis((x) => { const y = new Set(x); if (y.has(id)) y.delete(id); else y.add(id); return y; });
  const tousCoches = visibles.length && visibles.slice(0, limite).every((c) => choisis.has(c.id));

  return (
    <div className="cmpVue">
      <Entete titre={t("navContacts")} sous={t("sousContacts")}>
        <Recherche valeur={recherche} onChanger={setRecherche} placeholder={t("rechercherContact")} />
        <Bouton icone="faFileArrowDown" onClick={() => exporterContacts(visibles, engagement, t)}>{t("exporter")}</Bouton>
        <Bouton variante="principal" icone="faFileImport" disabled={!peutEcrire} onClick={() => setImporter(true)}>{t("importerFichier")}</Bouton>
      </Entete>
      <div className="cmpConteneur">
        {importer ? <AssistantImport fermer={() => setImporter(false)} /> : null}

        <div className="cmpAvecListes">
          <aside className="cmpListes" aria-label={t("listes")}>
            <span className="cmpNavGroupe">{t("listes")}</span>
            {[["", t("tousContacts"), clients.length], ...["actif", "prospect", "inactif"].map((x) => [`statut:${x}`, t(`crm_${x}`), clients.filter((c) => c.data.statut === x).length])].map(([id, label, nb]) => (
              <button key={id || "tous"} type="button" aria-pressed={liste === id} onClick={() => setListe(id)}><span>{label}</span><small>{n(nb)}</small></button>
            ))}
            <span className="cmpNavGroupe">{t("etiquettes")}</span>
            {etiquettes.length ? etiquettes.map((e) => (
              <button key={e} type="button" aria-pressed={liste === `tag:${e}`} onClick={() => setListe(`tag:${e}`)}><span># {e}</span><small>{n(clients.filter((c) => (c.data.etiquettes || []).includes(e)).length)}</small></button>
            )) : <p className="cmpAide">{t("aucuneEtiquette")}</p>}
          </aside>

          <div className="cmpLarge">
            <Onglets options={options} valeur={filtre} onChoisir={(f) => { setFiltre(f); setLimite(100); }} label={t("filtrer")} />
            {choisis.size ? (
              <div className="cmpSelection">
                <b>{t("nChoisis", { n: n(choisis.size) })}</b>
                <Bouton icone="faTag" disabled={!peutEcrire} onClick={ajouterEtiquette}>{t("ajouterEtiquette")}</Bouton>
                {liste.startsWith("tag:") ? <Bouton disabled={!peutEcrire} onClick={() => retirerEtiquette(liste.slice(4))}>{t("retirerEtiquette", { e: liste.slice(4) })}</Bouton> : null}
                <button type="button" className="cmpLien" onClick={() => setChoisis(new Set())}>{t("toutDecocher")}</button>
              </div>
            ) : null}
            <Carte>
              <div className="cmpTableau" role="table">
                <div className="cmpLigneT cmpEnteteT cmpColsContacts" role="row">
                  <input type="checkbox" aria-label={t("toutCocher")} checked={!!tousCoches} onChange={() => setChoisis(tousCoches ? new Set() : new Set(visibles.slice(0, limite).map((c) => c.id)))} />
                  <span>{t("contact")}</span><span>{t("email")}</span><span>{t("engagement")}</span><span>{t("consentement")}</span><span>{t("dernierAchat")}</span><span />
                </div>
                {visibles.slice(0, limite).map((c) => {
                  const d = c.data;
                  const e = engagement[c.id];
                  const score = e?.score ?? null;
                  const achat = contexte.derniereFacture?.[c.id];
                  return (
                    <div key={c.id} className="cmpLigneT cmpColsContacts" role="row">
                      <input type="checkbox" aria-label={d.entreprise || d.nom} checked={choisis.has(c.id)} onChange={() => basculer(c.id)} />
                      <span className="cmpQui">
                        <b className="cmpEllipse">{d.entreprise || d.nom}</b>
                        <small className="cmpDoux cmpEllipse">{[d.entreprise ? d.nom : "", d.ville, t(`crm_${d.statut || "actif"}`), ...(d.etiquettes || []).map((x) => `#${x}`)].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className="cmpEllipse">
                        {d.email || <span className="cmpDoux">—</span>}
                        {d.emailRebond ? <Etiquette ton="rouge">{t("rebond")}</Etiquette> : d.emailDesinscrit ? <Etiquette>{t("desinscrit")}</Etiquette> : d.emailAConfirmer ? <Etiquette ton="orange">{t("nonConfirme")}</Etiquette> : null}
                      </span>
                      <span className="cmpEtoiles" aria-label={score === null ? t("jamaisEcrit") : t("scoreSur5", { n: score })} title={e ? t("engagementDetail", { e: e.envoyes, o: e.ouverts, c: e.cliques }) : ""}>
                        {score === null ? <span className="cmpDoux">—</span> : "★★★★★".slice(0, score).padEnd(5, "☆")}
                      </span>
                      <small className="cmpDoux">{d.consentement ? t("consentementDe", { source: origine(d.consentement.source), date: dateCourte(d.consentement.confirmeLe || d.consentement.le) }) : origine(d.source || "crm")}</small>
                      <small className="cmpDoux">{achat ? dateCourte(achat) : "—"}</small>
                      <span className="cmpActionsLigne">
                        {d.emailRebond && peutEcrire ? <button type="button" className="cmpLien" onClick={() => reactiver(c)}>{t("reactiver")}</button> : null}
                        <button type="button" className="cmpIcone" title={t("ficheCRM")} aria-label={t("ficheCRM")} onClick={() => suivreLien({ lien: { app: "crm", params: { client: c.id } } })}><Icon fafa="faArrowUpRightFromSquare" width={11} /></button>
                      </span>
                    </div>
                  );
                })}
                {!visibles.length ? <p className="cmpRien">{clients.length ? t("aucunResultat") : t("aucunContact")}</p> : null}
              </div>
              {visibles.length > limite ? <div className="cmpCartePied"><button type="button" className="cmpLien" onClick={() => setLimite(limite + 200)}>{t("afficherPlus", { n: n(visibles.length - limite) })}</button></div> : null}
            </Carte>
          </div>
        </div>
      </div>
    </div>
  );
};

const exporterContacts = (clients, engagement, t) => {
  const cellule = (v) => { const x = String(v ?? ""); return /[";\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const lignes = [[t("entreprise"), t("nom"), t("email"), t("telephone"), t("ville"), t("etiquettes"), t("engagement"), t("consentement"), t("statut")]];
  for (const c of clients) {
    const d = c.data;
    lignes.push([d.entreprise, d.nom, d.email, d.telephone, d.ville, (d.etiquettes || []).join(", "), engagement[c.id]?.score ?? "", d.consentement?.source || "", d.emailRebond ? t("rebond") : d.emailDesinscrit ? t("desinscrit") : ""]);
  }
  const url = URL.createObjectURL(new Blob([`﻿${lignes.map((l) => l.map(cellule).join(";")).join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
  Object.assign(document.createElement("a"), { href: url, download: "contacts.csv" }).click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
};

// ---------------------------------------------------------------------------
// L'assistant d'import
// ---------------------------------------------------------------------------

const AssistantImport = ({ fermer }) => {
  const { t, n, clients, langue, tache, rafraichir } = useC();
  const [fichier, setFichier] = useState(null); // { nom, entetes, lignes, separateur }
  const [colonnes, setColonnes] = useState([]);
  const [etape, setEtape] = useState(1);
  const [etiquette, setEtiquette] = useState("");
  const [source, setSource] = useState("");
  const [consenti, setConsenti] = useState(false);
  const [progres, setProgres] = useState(null);

  const lire = (nom, texte) => {
    const csv = D.lireCsv(texte);
    if (!csv.entetes.length || !csv.lignes.length) {
      modal.alert({ title: t("fichierVide"), message: t("fichierVideMessage"), tone: "info" });
      return;
    }
    setFichier({ nom, ...csv });
    setColonnes(D.devinerColonnes(csv.entetes));
    setEtiquette(nom.replace(/\.[a-z0-9]+$/i, "").slice(0, 40));
    setEtape(2);
  };
  const depuisOrdinateur = () => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".csv,text/csv,text/plain" });
    input.onchange = async () => { const f = input.files?.[0]; if (f) lire(f.name, await f.text()); };
    input.click();
  };
  const depuisCloud = async () => {
    const node = await choisirFichierCloud({ titre: t("choisirCsv"), filtre: [".csv", ".txt"] });
    if (!node) return;
    const blob = await blobDuFichier(node);
    lire(node.name, await blob.text());
  };

  const plan = useMemo(() => (fichier ? D.planImport({ lignes: fichier.lignes, colonnes, clients, etiquettes: etiquette ? [etiquette] : [], consentement: consenti ? { source: source || "import", le: new Date().toISOString(), fichier: fichier.nom } : null }) : null), [fichier, colonnes, clients, etiquette, consenti, source]);
  const emailMappe = colonnes.includes("email");

  const importer = () =>
    tache(async () => {
      const total = plan.nouveaux.length + plan.misAJour.length;
      let fait = 0;
      setProgres({ fait, total });
      for (const data of plan.nouveaux) { await api.records.create("crm", "clients", data); setProgres({ fait: ++fait, total }); }
      for (const m of plan.misAJour) { await api.records.update("crm", "clients", m.id, m.data); setProgres({ fait: ++fait, total }); }
      await rafraichir();
      notifier({ titre: t("importTermine"), message: t("importTermineMessage", { a: n(plan.nouveaux.length), b: n(plan.misAJour.length) }), app: "Campagnes", ton: "success" });
      fermer();
    }, t("importImpossible"));

  return (
    <Carte titre={fichier ? t("importerNom", { nom: fichier.nom }) : t("importerFichier")} aide={fichier ? t("importInfo", { n: n(fichier.lignes.length), sep: fichier.separateur === "\t" ? "tab" : fichier.separateur }) : t("importAide")} ton="accent"
      actions={
        <>
          <ol className="cmpMiniEtapes">{[1, 2, 3].map((e) => <li key={e} data-etat={etape === e ? "actif" : etape > e ? "fait" : ""}>{e} {t(`import_${e}`)}</li>)}</ol>
          <button type="button" className="cmpIcone" aria-label={t("fermer")} onClick={fermer}><Icon fafa="faXmark" width={12} /></button>
        </>
      }
    >
      {etape === 1 ? (
        <div className="cmpImportDepart">
          <Bouton icone="faUpload" onClick={depuisOrdinateur}>{t("depuisOrdinateur")}</Bouton>
          <Bouton icone="faCloud" onClick={depuisCloud}>{t("depuisCloud")}</Bouton>
          <p className="cmpAide">{t("importRegle")}</p>
        </div>
      ) : etape === 2 ? (
        <>
          <div className="cmpColonnesImport">
            {fichier.entetes.map((e, i) => (
              <div key={`${e}-${i}`} className="cmpColonneImport">
                <small>{t("colonneN", { nom: e || `#${i + 1}` })}</small>
                <select aria-label={t("champPour", { nom: e })} value={colonnes[i] || "ignorer"} onChange={(ev) => setColonnes((c) => c.map((x, j) => (j === i ? ev.target.value : x)))}>
                  {D.CHAMPS_IMPORT.map((ch) => <option key={ch} value={ch}>{t(`champ_${ch}`)}</option>)}
                </select>
                {fichier.lignes.slice(0, 3).map((l, k) => <span key={k} className="cmpEllipse">{l[i] || "—"}</span>)}
              </div>
            ))}
          </div>
          {!emailMappe ? <p className="cmpBandeau" data-ton="rouge">{t("emailRequis")}</p> : null}
          <div className="cmpActionsForm">
            <Bouton onClick={() => setEtape(1)}>{t("retour")}</Bouton>
            <Bouton variante="principal" disabled={!emailMappe} onClick={() => setEtape(3)}>{t("continuer")}</Bouton>
          </div>
        </>
      ) : (
        <>
          <div className="cmpBilan">
            <span data-ton="vert"><b>{n(plan.nouveaux.length)}</b> {t("bilanNouveaux")}</span>
            <span data-ton="bleu"><b>{n(plan.misAJour.length)}</b> {t("bilanMisAJour")}</span>
            {plan.doublons ? <span><b>{n(plan.doublons)}</b> {t("bilanDoublons")}</span> : null}
            {plan.invalides ? <span data-ton="rouge"><b>{n(plan.invalides)}</b> {t("bilanInvalides")}</span> : null}
            {plan.desinscrits ? <span><b>{n(plan.desinscrits)}</b> {t("bilanDesinscrits")}</span> : null}
          </div>
          <div className="cmpImportOptions">
            <label className="cmpChamp"><span>{t("etiquetteImport")}</span><input value={etiquette} onChange={(e) => setEtiquette(e.target.value)} placeholder="salon-2026" /></label>
            <label className="cmpChamp"><span>{t("sourceConsentement")}</span><input value={source} onChange={(e) => setSource(e.target.value)} placeholder={langue === "en" ? "Trade show, website…" : "Salon, site web…"} /></label>
          </div>
          <label className="cmpCase cmpConsentement">
            <input type="checkbox" checked={consenti} onChange={(e) => setConsenti(e.target.checked)} />
            <span>{t("attestation")}</span>
          </label>
          {progres ? <div className="cmpProgression" role="progressbar" aria-valuenow={progres.fait} aria-valuemax={progres.total} aria-valuemin={0}><span style={{ width: `${(progres.fait / Math.max(1, progres.total)) * 100}%` }} /></div> : null}
          <div className="cmpActionsForm">
            <Bouton onClick={() => setEtape(2)}>{t("retour")}</Bouton>
            <Bouton variante="principal" icone="faFileImport" disabled={!consenti || !(plan.nouveaux.length + plan.misAJour.length) || !!progres} onClick={importer}>{t("importerN", { n: n(plan.nouveaux.length + plan.misAJour.length) })}</Bouton>
          </div>
        </>
      )}
    </Carte>
  );
};
