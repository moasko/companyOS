// Stock — la fiche d'un article : vue d'ensemble, fiche, historique.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../../utils/general";
import { api } from "../../../../api/client";
import { modal } from "../../../modalRequest";
import { saveToCloud } from "../../../cloud";
import { choisirImage, redimensionnerImage } from "../../../image";
import { suivreLien } from "../../../notifications";
import { etatFenetre } from "../../../windows";
import { Auteur } from "../../../Auteur";
import { UNITES, chemin } from "../domaine";
import * as R from "../regles";
import { Bouton, Carte, Entete, Etiquette, Kpi, Vignette, nombre, useS } from "../commun";
import { saisirMouvement } from "./FormMouvement";

// La vignette voyage dans l'enregistrement (limite serveur : 64 Ko de JSON).
// À 180 px et qualité 0,7, une photo pèse 8 à 12 Ko ; l'original part dans
// le Cloud.
const VIGNETTE_COTE = 180;
const VIGNETTE_QUALITE = 0.7;
const VIGNETTE_MAX = 40000;

const VIDE = {
  reference: "",
  designation: "",
  description: "",
  marque: "",
  codeBarre: "",
  categorieId: "",
  unite: "pièce",
  prixAchat: 0,
  prixVente: 0,
  tva: 18,
  seuil: 5,
  emplacement: "",
  fournisseurId: "",
  vignette: "",
  imageNodeId: "",
  suiviLot: false,
  stockSecurite: 0,
  delaiFournisseur: 7,
  qteCommande: 1,
  stockMax: 0,
};

export const Article = () => {
  const s = useS();
  const { t, intention, articles } = s;
  const nouveau = intention?.id === "nouveau";
  const article = articles.find((a) => a.id === intention?.id) || null;
  const [onglet, setOnglet] = useState(nouveau ? "fiche" : intention?.onglet || "vue");

  if (!nouveau && !article) {
    return (
      <div className="stoVue">
        <Entete titre={t("navArticles")} retour={{ section: "articles", label: t("navArticles") }} />
        <div className="stoConteneur"><p className="stoRien">{t("articleIntrouvable")}</p></div>
      </div>
    );
  }

  const d = article?.data || {};
  return (
    <div className="stoVue">
      <Entete
        retour={{ section: "articles", label: t("navArticles") }}
        titre={nouveau ? t("nouvelArticle") : d.designation}
        sous={nouveau ? "" : [d.reference, d.codeBarre && `${t("codeBarre")} ${d.codeBarre}`, chemin(s.categories, d.categorieId), d.suiviLot && t("suiviParLot")].filter(Boolean).join(" · ")}
      >
        {!nouveau ? (
          <>
            <Bouton icone="faTag" onClick={() => s.aller("etiquettes", { ids: [article.id] })}>{t("imprimerEtiquette")}</Bouton>
            <Bouton icone="faRightLeft" onClick={() => saisirMouvement(s, { articleId: article.id, sens: "transfert" })}>{t("transferer")}</Bouton>
            <Bouton variante="principal" icone="faPlus" onClick={() => saisirMouvement(s, { articleId: article.id })}>{t("entreeSortie")}</Bouton>
          </>
        ) : null}
      </Entete>
      <div className="stoConteneur">
        {!nouveau ? (
          <div className="stoOnglets" role="tablist">
            {["vue", "fiche", "historique"].map((o) => (
              <button key={o} type="button" role="tab" aria-selected={onglet === o} onClick={() => setOnglet(o)}>{t(`onglet_${o}`)}</button>
            ))}
          </div>
        ) : null}
        {onglet === "vue" && article ? <VueEnsemble article={article} /> : null}
        {onglet === "fiche" ? <Fiche article={article} /> : null}
        {onglet === "historique" && article ? <Historique article={article} /> : null}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Vue d'ensemble
// ---------------------------------------------------------------------------

const VueEnsemble = ({ article }) => {
  const s = useS();
  const { t, q, m, date, mouvements, stocks, parEntrepot, reserves, enCommande, couts, entrepots, documents, commandes, enregistrerRecord, occupe } = s;
  const d = article.data;
  const stock = stocks[article.id] || 0;
  const reserve = reserves[article.id] || 0;
  const conso = R.consommations(mouvements)[article.id] || 0;
  const point = R.pointDeCommande(article, conso);
  const cout = couts.get(article.id) || 0;
  const pvHt = (Number(d.prixVente) || 0) / (1 + (Number(d.tva) || 0) / 100);
  const marge = pvHt ? ((pvHt - cout) / pvHt) * 100 : 0;
  const lots = R.lotsEnStock(article.id, mouvements, stock);
  const courbe = useMemo(() => R.historiqueNiveau(article.id, mouvements), [article.id, mouvements]);
  const maxCourbe = Math.max(1, point, ...courbe.map((x) => x.q));
  const ventesCaisse = mouvements.filter((x) => x.data.articleId === article.id && String(x.data.origine || "").startsWith("caisse:") && x.data.date >= courbe[0].jour);
  const facturesEnCours = documents.filter((x) => (x.data.lignes || []).some((l) => l.articleId === article.id) && ["envoye", "accepte"].includes(x.data.statut));
  const commandesEnCours = commandes.filter((c) => !["brouillon", "annulee", "recue"].includes(c.data.statut) && (c.data.lignes || []).some((l) => l.articleId === article.id));

  const [p, setP] = useState(() => R.parametresReappro(article));
  const pointSimule = R.pointDeCommande({ data: { ...d, stockSecurite: p.securite, delaiFournisseur: p.delai, seuil: p.seuil } }, conso);
  const change = JSON.stringify(p) !== JSON.stringify(R.parametresReappro(article));
  const sauverReappro = () =>
    enregistrerRecord("articles", article.id, { ...d, stockSecurite: p.securite, delaiFournisseur: p.delai, qteCommande: p.multiple, stockMax: p.max, seuil: p.seuil });

  const lien = (app, params) => (etatFenetre(app) ? suivreLien({ lien: { app, params } }) : null);

  return (
    <>
      <section className="stoKpis stoKpis5">
        <Kpi label={t("enStock")} valeur={`${q(stock)}`} aide={t("uniteEntrepots", { unite: d.unite || "", n: Object.values(parEntrepot[article.id] || {}).filter((x) => x).length })} ton={stock <= 0 ? "rouge" : ""} />
        <Kpi label={t("disponible")} valeur={q(stock - reserve)} aide={reserve ? t("reserveD", { q: q(reserve) }) : t("rienReserve")} />
        <Kpi label={t("couverture")} valeur={conso ? t("jours", { n: Math.max(0, Math.floor((stock - reserve) / conso)) }) : "—"} aide={conso ? t("consoD", { q: q(conso) }) : t("pasDeVentes")} />
        <Kpi label={t("pmp")} valeur={m(cout)} aide={t("valeurD", { v: m(stock * cout) })} />
        <Kpi label={t("marge")} valeur={pvHt ? `${q(Math.round(marge * 10) / 10)} %` : "—"} aide={t("margeD", { pv: m(d.prixVente), tva: d.tva || 0 })} ton={pvHt && marge <= 0 ? "rouge" : ""} />
      </section>

      <div className="stoGrille">
        <div className="stoLarge">
          <Carte titre={t("lotsTitre")} aide={t("lotsAide")}>
            {lots.length ? (
              <div className="stoTableau" role="table">
                <div className="stoLigneT stoEnteteT stoColsLots" role="row">
                  <span>{t("lot")}</span><span>{t("peremption")}</span><span className="stoMt">{t("quantite")}</span><span>{t("lieu")}</span><span>{t("etat")}</span>
                </div>
                {lots.map((l) => (
                  <div key={l.lot || "sans"} className="stoLigneT stoColsLots" role="row">
                    <b className="stoCode">{l.lot || t("sansLot")}</b>
                    <span>{l.peremption ? date(l.peremption) : "—"}</span>
                    <b className="stoMt">{q(l.qte)}</b>
                    <span className="stoDoux">{[s.nomEntrepot(l.entrepotId), l.emplacement].filter(Boolean).join(" · ")}</span>
                    <span>
                      {l.jours == null ? null : l.jours < 0 ? (
                        <Etiquette ton="rupture">{t("perime")}</Etiquette>
                      ) : l.jours <= 30 ? (
                        <Etiquette ton="rupture">{t("expireDans", { n: l.jours })}</Etiquette>
                      ) : l === lots.find((x) => x.lot) ? (
                        <Etiquette ton="alerte">{t("aEcoulerDabord")}</Etiquette>
                      ) : (
                        <Etiquette ton="ok">{t("lotOk")}</Etiquette>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="stoRien">{d.suiviLot ? t("aucunLot") : t("pasSuiviLot")}</p>
            )}
          </Carte>

          <Carte titre={t("parEntrepot")}>
            <ul className="stoEntrepots">
              {entrepots.map((e) => {
                const x = parEntrepot[article.id]?.[e.id] || 0;
                return (
                  <li key={e.id || "p"}>
                    <span><b>{e.nom}</b><b className="stoMt">{q(x)} {d.unite}</b></span>
                    <span className="stoPiste"><span style={{ width: `${stock > 0 ? Math.max(0, (x / stock) * 100) : 0}%` }} /></span>
                  </li>
                );
              })}
            </ul>
          </Carte>

          <Carte titre={t("courbeTitre")} aide={t("courbeAide", { point: q(point) })}>
            <div className="stoCourbe" role="img" aria-label={t("courbeTitre")}>
              {point ? <span className="stoCourbePoint" style={{ bottom: `${(point / maxCourbe) * 100}%` }} /> : null}
              {courbe.map((x) => (
                <span key={x.jour} title={`${date(x.jour)} : ${q(x.q)}`} data-bas={x.q <= point ? "true" : "false"} style={{ height: `${Math.max(1, (Math.max(0, x.q) / maxCourbe) * 100)}%` }} />
              ))}
            </div>
            <div className="stoCourbeAxe"><span>{date(courbe[0].jour)}</span><span>{date(courbe[courbe.length - 1].jour)}</span></div>
          </Carte>
        </div>

        <aside className="stoColonne">
          <Carte titre={t("reapproTitre")} ton="accent">
            <div className="stoParametres">
              {[
                ["securite", t("pSecurite"), t("pSecuriteD")],
                ["delai", t("pDelai"), t("pDelaiD")],
                ["multiple", t("pMultiple"), t("pMultipleD")],
                ["max", t("pMax"), t("pMaxD")],
                ["seuil", t("pSeuil"), t("pSeuilD")],
              ].map(([k, l, aide]) => (
                <label key={k}>
                  <span><span>{l}</span><small>{aide}</small></span>
                  <input inputMode="numeric" value={p[k] || ""} placeholder="—" onChange={(e) => setP((x) => ({ ...x, [k]: nombre(e.target.value) }))} />
                </label>
              ))}
            </div>
            <div className="stoEncadre">
              <b>{t("pointCalc", { n: q(pointSimule) })}</b>
              <span>{conso ? t("pointCalcD", { conso: q(conso), delai: p.delai, securite: q(p.securite || conso * 2) }) : t("pointSeuilD")}</span>
              {enCommande[article.id] ? <span>{t("dejaEnCommande", { q: q(enCommande[article.id]) })}</span> : null}
            </div>
            <div className="stoActionsForm">
              {change ? <Bouton variante="principal" disabled={occupe} onClick={sauverReappro}>{t("enregistrer")}</Bouton> : null}
              <Bouton onClick={() => s.aller("reappro")}>{t("navReappro")}</Bouton>
            </div>
          </Carte>

          <Carte titre={t("prixMarge")}>
            <ul className="stoListeValeurs">
              <li><span>{t("prixAchatFiche")}</span><b>{m(d.prixAchat)}</b></li>
              <li><span>{t("pmp")}</span><b>{m(cout)}</b></li>
              <li><span>{t("prixVente")}</span><b>{m(pvHt)} {t("ht")} · {m(d.prixVente)} {t("ttc")}</b></li>
              <li><span>{t("margeUnitaire")}</span><b>{m(pvHt - cout)}</b></li>
              <li><span>{t("sorties30")}</span><b>{q(conso * 30)}</b></li>
            </ul>
          </Carte>

          <Carte titre={t("autresApps")}>
            <ul className="stoListeValeurs">
              <li><span>{t("ventesCaisse")}</span><b>{q(ventesCaisse.reduce((x, y) => x + (Number(y.data.quantite) || 0), 0))}</b></li>
              <li>
                <span>{t("facturesEnCours")}</span>
                {facturesEnCours.length ? <button type="button" className="stoLien" onClick={() => lien("facturation", { facture: facturesEnCours[0].id })}>{facturesEnCours.length} →</button> : <b>0</b>}
              </li>
              <li>
                <span>{t("commandesEnCours")}</span>
                {commandesEnCours.length ? <button type="button" className="stoLien" onClick={() => lien("achats", {})}>{commandesEnCours.map((c) => c.data.numero).join(", ")} →</button> : <b>0</b>}
              </li>
            </ul>
          </Carte>
        </aside>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Fiche
// ---------------------------------------------------------------------------

const Fiche = ({ article }) => {
  const s = useS();
  const { t, m, articles, categories, fournisseurs, mouvements, enregistrerRecord, occupe, tache, aller, rafraichir, intention } = s;
  const prochaineReference = () => {
    const max = articles.reduce((acc, a) => {
      const n = /^ART-(\d+)$/.exec(a.data.reference || "");
      return n ? Math.max(acc, Number(n[1])) : acc;
    }, 0);
    return `ART-${String(max + 1).padStart(3, "0")}`;
  };
  const [v, setV] = useState(() => (article ? { ...VIDE, ...article.data } : { ...VIDE, reference: prochaineReference(), categorieId: intention?.categorieId || "" }));
  const set = (k, num) => (e) => setV((x) => ({ ...x, [k]: num ? nombre(e.target.value) : e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const pvHt = (Number(v.prixVente) || 0) / (1 + (Number(v.tva) || 0) / 100);

  const enregistrer = async () => {
    if (!v.designation.trim()) {
      modal.alert({ title: t("appNom"), message: t("designationRequise"), tone: "warning" });
      return;
    }
    // Une référence en double casse les recherches, les imports et les
    // inventaires : on la refuse à la saisie.
    const ref = v.reference.trim();
    if (ref && articles.some((a) => a.id !== article?.id && (a.data.reference || "").toLowerCase() === ref.toLowerCase())) {
      modal.alert({ title: t("appNom"), message: t("referencePrise", { ref }), tone: "warning" });
      return;
    }
    const rec = await enregistrerRecord("articles", article?.id, { ...v, reference: ref });
    if (rec && !article) aller("article", { id: rec.id });
  };

  const image = async () => {
    const fichier = await choisirImage();
    if (!fichier) return;
    await tache(async () => {
      const vignette = await redimensionnerImage(fichier, { cote: VIGNETTE_COTE, qualite: VIGNETTE_QUALITE });
      if (vignette.length > VIGNETTE_MAX) throw new Error(t("imageLourde"));
      let imageNodeId = v.imageNodeId;
      try {
        const node = await saveToCloud(fichier, `${v.reference || "produit"}-${fichier.name}`, { folder: "Stock" });
        imageNodeId = node?.id || imageNodeId;
      } catch {
        /* l'original n'a pas pu être archivé : la vignette suffit */
      }
      setV((x) => ({ ...x, vignette, imageNodeId }));
    });
  };

  const archiver = () => enregistrerRecord("articles", article.id, { ...article.data, archive: !article.data.archive });

  const supprimer = async () => {
    const lies = mouvements.filter((x) => x.data.articleId === article.id);
    if (lies.length) {
      // Un article qui a un historique s'archive : supprimer ses mouvements
      // réécrirait le passé du stock et de sa valeur.
      const ok = await modal.confirm({ title: t("supprimerArticle"), message: t("supprimerAvecHistorique", { n: lies.length }), confirmLabel: t("archiver") });
      if (ok) await archiver();
      return;
    }
    const ok = await modal.confirm({ title: t("supprimerArticle"), message: t("supprimerConfirm", { nom: article.data.designation }), confirmLabel: t("supprimer"), danger: true });
    if (!ok) return;
    await tache(async () => {
      await api.records.remove("stock", "articles", article.id);
      await rafraichir();
      aller("articles");
    });
  };

  const champ = (k, label, opts = {}) => (
    <label className={opts.large ? "stoChampLarge" : ""}>
      <span>{label}</span>
      <input inputMode={opts.num ? "decimal" : undefined} value={v[k] ?? ""} placeholder={opts.placeholder} onChange={set(k, opts.num)} />
    </label>
  );

  return (
    <div className="stoGrille">
      <div className="stoLarge">
        <Carte titre={t("identite")}>
          <div className="stoChamps">
            {champ("designation", `${t("designation")} *`, { large: true })}
            {champ("reference", t("reference"))}
            {champ("codeBarre", t("codeBarre"))}
            {champ("marque", t("marque"))}
            <label>
              <span>{t("unite")}</span>
              <select value={v.unite} onChange={set("unite")}>
                {UNITES.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label>
              <span>{t("categorie")}</span>
              <select value={v.categorieId} onChange={set("categorieId")}>
                <option value="">{t("sansCategorie")}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{chemin(categories, c.id)}</option>)}
              </select>
            </label>
            <label>
              <span>{t("fournisseur")}</span>
              <select value={v.fournisseurId} onChange={set("fournisseurId")}>
                <option value="">{t("aucun")}</option>
                {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.data.nom}</option>)}
              </select>
            </label>
            {champ("emplacement", t("emplacementHabituel"), { placeholder: "B1-02" })}
            <label className="stoCase stoChampLarge">
              <input type="checkbox" checked={!!v.suiviLot} onChange={set("suiviLot")} />
              <span>{t("suiviLotLabel")}</span>
            </label>
            <label className="stoChampLarge">
              <span>{t("description")}</span>
              <textarea rows={3} value={v.description} onChange={set("description")} />
            </label>
          </div>
        </Carte>
        <Carte titre={t("prixMarge")}>
          <div className="stoChamps">
            {champ("prixAchat", t("prixAchatFiche"), { num: true })}
            {champ("prixVente", t("prixVenteTtc"), { num: true })}
            {champ("tva", t("tva"), { num: true })}
            {champ("seuil", t("pSeuil"), { num: true })}
          </div>
          {v.prixVente ? (
            <p className="stoMarge" data-negatif={pvHt <= v.prixAchat ? "true" : "false"}>
              {t("margeLigne", { montant: m(pvHt - v.prixAchat), pct: pvHt ? Math.round(((pvHt - v.prixAchat) / pvHt) * 100) : 0 })}
            </p>
          ) : null}
        </Carte>
      </div>
      <aside className="stoColonne">
        <Carte titre={t("image")}>
          <div className="stoImage">
            {v.vignette ? <img src={v.vignette} alt={v.designation} /> : <Vignette article={{ data: v }} taille={120} />}
            <div className="stoActionsForm">
              <Bouton icone="faImage" onClick={image} disabled={occupe}>{v.vignette ? t("changerImage") : t("ajouterImage")}</Bouton>
              {v.vignette ? <Bouton onClick={() => setV((x) => ({ ...x, vignette: "", imageNodeId: "" }))}>{t("retirer")}</Bouton> : null}
            </div>
          </div>
        </Carte>
        <Carte>
          <div className="stoActionsForm stoColonneBoutons">
            <Bouton variante="principal" icone="faFloppyDisk" disabled={occupe} onClick={enregistrer}>{t("enregistrer")}</Bouton>
            {article ? <Bouton icone="faBoxArchive" disabled={occupe} onClick={archiver}>{article.data.archive ? t("desarchiver") : t("archiver")}</Bouton> : null}
            {article ? <Bouton variante="danger" disabled={occupe} onClick={supprimer}>{t("supprimer")}</Bouton> : null}
          </div>
          {article ? <Auteur record={article} /> : null}
        </Carte>
      </aside>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

const Historique = ({ article }) => {
  const { t, q, date, mouvements, nomEntrepot, supprimerMouvement, peutAdministrer } = useS();
  const liste = mouvements
    .filter((x) => x.data.articleId === article.id)
    .sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  return (
    <Carte>
      {liste.length ? (
        <div className="stoTableau" role="table">
          <div className="stoLigneT stoEnteteT stoColsHistoA" role="row">
            <span>{t("date")}</span><span>{t("type")}</span><span className="stoMt">{t("quantite")}</span><span>{t("lieu")}</span><span>{t("lot")}</span><span>{t("motif")}</span><span />
          </div>
          {liste.map((x) => (
            <div key={x.id} className="stoLigneT stoColsHistoA" role="row">
              <span className="stoDoux">{date(x.data.date)}</span>
              <span><Etiquette ton={x.data.sens}>{t(`sens_${x.data.sens}`)}</Etiquette></span>
              <b className="stoMt">{x.data.sens === "entree" ? "+ " : x.data.sens === "sortie" ? "− " : ""}{q(x.data.quantite)}</b>
              <span className="stoEllipse stoDoux">{x.data.sens === "transfert" ? `${nomEntrepot(x.data.de)} → ${nomEntrepot(x.data.vers)}` : [nomEntrepot(x.data.entrepotId), x.data.emplacement].filter(Boolean).join(" · ")}</span>
              <span className="stoCode">{x.data.lot || ""}</span>
              <span className="stoEllipse stoDoux">{[x.data.motif, x.auteur?.name].filter(Boolean).join(" · ") || "—"}</span>
              {peutAdministrer && !x.data.origine ? (
                <button type="button" className="stoIcone" aria-label={t("supprimer")} onClick={() => supprimerMouvement(x)}><Icon fafa="faXmark" width={11} /></button>
              ) : <span />}
            </div>
          ))}
        </div>
      ) : (
        <p className="stoRien">{t("aucunMouvement")}</p>
      )}
      <p className="stoAide">{t("historiqueAide")}</p>
    </Carte>
  );
};

