// Stock — inventaire tournant.
//
// Une session (INV-0001) se crée sur un entrepôt et une portée : les
// articles de classe A à compter, une catégorie, ou tout. On saisit les
// quantités comptées, l'écart se valorise au fil de la saisie ; valider
// impose les niveaux constatés (mouvements « inventaire ») et propose
// l'écriture des écarts à la Comptabilité (6031 / 311).

import React, { useEffect, useMemo, useState } from "react";
import { modal } from "../../../modalRequest";
import { rapportPdf } from "../../comptabilite/pdf";
import { branche, chemin } from "../domaine";
import { FREQUENCES, aCompter, aujourdhui, ecartsInventaire, lignesInventaire, mouvementsInventaire, prochainNumero } from "../regles";
import { Bouton, Carte, Entete, Etiquette, Kpi, nombre, ranger, useS } from "../commun";

const CAUSES = ["casse", "vol", "erreur", "peremption", "autre"];

const FormNouvel = ({ s, close }) => {
  const { t, entrepots, categories, taches, articles } = s;
  const [v, setV] = useState({
    entrepotId: s.entrepotActif !== "*" ? s.entrepotActif : entrepots[0]?.id ?? "",
    portee: taches.compter.length ? "aCompter" : "tout",
    categorieId: categories[0]?.id || "",
  });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const actifs = articles.filter((a) => !a.data.archive);
  const nombreDe = {
    aCompter: taches.compter.length,
    categorie: v.categorieId ? actifs.filter((a) => branche(categories, v.categorieId).includes(a.data.categorieId)).length : 0,
    tout: actifs.length,
  };
  return (
    <div className="stoForm">
      <label>
        <span>{t("entrepot")}</span>
        <select value={v.entrepotId} onChange={set("entrepotId")}>
          {entrepots.map((e) => <option key={e.id || "p"} value={e.id}>{e.nom}</option>)}
        </select>
      </label>
      <fieldset className="stoChoixPortee">
        <legend>{t("portee")}</legend>
        {["aCompter", "categorie", "tout"].map((k) => (
          <label key={k} className="stoCase">
            <input type="radio" name="portee" checked={v.portee === k} onChange={() => setV((x) => ({ ...x, portee: k }))} disabled={k === "categorie" && !categories.length} />
            <span>{t(`portee_${k}`, { n: nombreDe[k] })}</span>
          </label>
        ))}
      </fieldset>
      {v.portee === "categorie" ? (
        <label>
          <span>{t("categorie")}</span>
          <select value={v.categorieId} onChange={set("categorieId")}>
            {categories.map((c) => <option key={c.id} value={c.id}>{chemin(categories, c.id)}</option>)}
          </select>
        </label>
      ) : null}
      <div className="stoActionsForm">
        <Bouton onClick={() => close(null)}>{t("annuler")}</Bouton>
        <Bouton variante="principal" disabled={!nombreDe[v.portee]} onClick={() => close(v)}>{t("commencer")}</Bouton>
      </div>
    </div>
  );
};

export const Inventaires = () => {
  const s = useS();
  const { t, intention } = s;
  const [ouvert, setOuvert] = useState(intention?.id || null);
  const inv = s.inventaires.find((i) => i.id === ouvert);

  const nouvel = async () => {
    const v = await modal.open({ title: t("nouvelInventaire"), render: ({ close }) => <FormNouvel s={s} close={close} /> });
    if (!v) return;
    const actifs = s.articles.filter((a) => !a.data.archive);
    const choix =
      v.portee === "aCompter"
        ? s.taches.compter
        : v.portee === "categorie"
          ? actifs.filter((a) => branche(s.categories, v.categorieId).includes(a.data.categorieId))
          : actifs;
    const rec = await s.enregistrerRecord("inventaires", null, {
      numero: prochainNumero(s.inventaires, "INV"),
      date: aujourdhui(),
      entrepotId: v.entrepotId,
      portee: v.portee,
      categorieId: v.portee === "categorie" ? v.categorieId : "",
      statut: "ouvert",
      par: s.session.user?.name || s.session.user?.email || "",
      lignes: lignesInventaire(choix, s.mouvements, v.entrepotId),
    });
    if (rec) setOuvert(rec.id);
  };

  // Arrivée depuis « À faire » : on propose directement la création.
  useEffect(() => {
    if (intention?.nouveau) nouvel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (inv) return <Session inv={inv} fermer={() => setOuvert(null)} />;
  return <Liste ouvrir={setOuvert} nouvel={nouvel} />;
};

const Liste = ({ ouvrir, nouvel }) => {
  const s = useS();
  const { t, q, m, date, inventaires, articles, mouvements, abc, stocks, nomEntrepot } = s;
  const tries = [...inventaires].sort((a, b) => String(b.data.numero).localeCompare(String(a.data.numero)));
  const enStock = articles.filter((a) => !a.data.archive && (stocks[a.id] || 0) > 0);
  const planning = useMemo(() => {
    const dus = new Set(aCompter(enStock, mouvements, abc.classes).map((a) => a.id));
    return ["A", "B", "C"].map((k) => {
      const dans = enStock.filter((a) => (abc.classes[a.id] || "C") === k);
      return { classe: k, n: dans.length, dus: dans.filter((a) => dus.has(a.id)).length, jours: FREQUENCES[k] };
    });
  }, [enStock, mouvements, abc]);

  return (
    <div className="stoVue">
      <Entete titre={t("navInventaires")} sous={t("sousInventaires", { n: inventaires.length })}>
        <Bouton variante="principal" icone="faClipboardCheck" onClick={nouvel}>{t("nouvelInventaire")}</Bouton>
      </Entete>
      <div className="stoConteneur">
        <div className="stoGrille">
          <div className="stoLarge">
            <Carte titre={t("sessions")}>
              {tries.length ? (
                <div className="stoTableau" role="table">
                  <div className="stoLigneT stoEnteteT stoColsInv" role="row">
                    <span>{t("numero")}</span>
                    <span>{t("date")}</span>
                    <span>{t("entrepot")}</span>
                    <span className="stoMt">{t("comptes")}</span>
                    <span className="stoMt">{t("ecartValorise")}</span>
                    <span>{t("statut")}</span>
                  </div>
                  {tries.map((i) => {
                    const e = ecartsInventaire(i.data.lignes || [], articles, mouvements);
                    const valeur = i.data.statut === "valide" ? i.data.valeurEcart || 0 : e.valeur;
                    return (
                      <button type="button" key={i.id} className="stoLigneT stoColsInv" role="row" onClick={() => ouvrir(i.id)}>
                        <b>{i.data.numero}</b>
                        <span className="stoDoux">{date(i.data.date)}</span>
                        <span className="stoEllipse">{nomEntrepot(i.data.entrepotId)}</span>
                        <span className="stoMt">{q(e.comptes)} / {q(e.total)}</span>
                        <span className="stoMt" data-ton={valeur < 0 ? "rouge" : valeur > 0 ? "vert" : ""}>{m(valeur)}</span>
                        <span><Etiquette ton={i.data.statut === "valide" ? "ok" : "bleu"}>{t(`statut_${i.data.statut}`)}</Etiquette></span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="stoRien">{t("aucunInventaire")}</p>
              )}
            </Carte>
          </div>
          <aside className="stoColonne">
            <Carte titre={t("planning")} aide={t("planningAide")}>
              <ul className="stoAbc">
                {planning.map((p) => (
                  <li key={p.classe}>
                    <b className="stoClasse" data-classe={p.classe}>{p.classe}</b>
                    <span>
                      <b>{t("planningLigne", { n: p.dus, total: p.n })}</b>
                      <small>{t("frequence", { n: p.jours })}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </Carte>
          </aside>
        </div>
      </div>
    </div>
  );
};

const Session = ({ inv, fermer }) => {
  const s = useS();
  const { t, q, m, date, articles, mouvements, categories, entrepots, nomEntrepot, parEntrepot, enregistrerRecord, enregistrerMouvements, supprimerRecord, tache, entreprise, occupe } = s;
  const d = inv.data;
  const ouvertEncore = d.statut !== "valide";
  const [lignes, setLignes] = useState(d.lignes || []);
  const [filtre, setFiltre] = useState("tous");
  const [modifie, setModifie] = useState(false);
  const parId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const e = useMemo(() => ecartsInventaire(lignes, articles, mouvements), [lignes, articles, mouvements]);
  const emplacementDe = (a) => a?.data.emplacement || "";

  const changer = (i, cle, val) => {
    setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, [cle]: val } : l)));
    setModifie(true);
  };

  const enregistrer = async () => {
    const r = await enregistrerRecord("inventaires", inv.id, { ...d, lignes: lignes.map((l) => ({ ...l, compte: l.compte === "" || l.compte == null ? null : nombre(l.compte) })) });
    if (r) setModifie(false);
  };

  const valider = async () => {
    // L'attendu est relu au moment de valider : une vente passée pendant le
    // comptage ne doit pas apparaître comme une perte.
    const fraiches = lignes.map((l) => ({
      ...l,
      compte: l.compte === "" || l.compte == null ? null : nombre(l.compte),
      attendu: parEntrepot[l.articleId]?.[d.entrepotId || ""] || 0,
    }));
    const r = ecartsInventaire(fraiches, articles, mouvements);
    const ok = await modal.confirm({
      title: t("validerTitre", { numero: d.numero }),
      message: t("validerMessage", { n: r.comptes, e: r.avecEcart, montant: m(r.valeur) }),
      detail: r.comptes < r.total ? t("validerNonComptes", { n: r.total - r.comptes }) : t("validerCompta"),
      confirmLabel: t("valider"),
    });
    if (!ok) return;
    const fini = { ...d, lignes: fraiches, statut: "valide", valideLe: aujourdhui(), valeurEcart: r.valeur };
    const mvts = mouvementsInventaire(fini, inv.id);
    const fait = await enregistrerMouvements(mvts, { verifier: false });
    if (!fait) return;
    await enregistrerRecord("inventaires", inv.id, fini);
    setLignes(fraiches);
    setModifie(false);
  };

  const supprimer = async () => {
    const ok = await modal.confirm({ title: t("supprimerInvTitre", { numero: d.numero }), message: t("supprimerInvMessage"), confirmLabel: t("supprimer"), danger: true });
    if (ok && (await supprimerRecord("inventaires", inv.id))) fermer();
  };

  const feuille = () =>
    tache(() => {
      const blob = rapportPdf({
        titre: t("feuilleTitre", { numero: d.numero }),
        sousTitre: `${nomEntrepot(d.entrepotId)} — ${date(d.date)}`,
        entreprise,
        colonnes: [
          { label: t("reference"), largeur: 0.14 },
          { label: t("designation"), largeur: 0.38 },
          { label: t("emplacement"), largeur: 0.14 },
          { label: t("attendu"), largeur: 0.11, align: "right" },
          { label: t("compte"), largeur: 0.11, align: "right" },
          { label: t("ecart"), largeur: 0.12, align: "right" },
        ],
        lignes: lignes.map((l) => {
          const a = parId.get(l.articleId);
          const compte = l.compte === "" || l.compte == null ? "" : nombre(l.compte);
          return { cellules: [a?.data.reference || "", a?.data.designation || "", emplacementDe(a), String(l.attendu), compte === "" ? "______" : String(compte), compte === "" ? "" : String(compte - l.attendu)] };
        }),
        notes: [t("feuilleNote")],
      });
      return ranger(blob, `${d.numero}.pdf`, t);
    });

  const visibles = lignes
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => {
      const compte = l.compte === "" || l.compte == null ? null : nombre(l.compte);
      if (filtre === "aCompter") return compte === null;
      if (filtre === "ecarts") return compte !== null && compte !== Number(l.attendu);
      return true;
    });
  const pct = e.total ? Math.round((e.comptes / e.total) * 100) : 0;

  return (
    <div className="stoVue">
      <Entete
        titre={`${d.numero} · ${nomEntrepot(d.entrepotId)}`}
        sous={[date(d.date), d.portee === "categorie" ? chemin(categories, d.categorieId) : t(`portee_${d.portee}`, { n: lignes.length }), d.par].filter(Boolean).join(" · ")}
        retour={{ section: "inventaires", label: t("navInventaires") }}
      >
        <Bouton icone="faFilePdf" onClick={feuille}>{t("feuilleComptage")}</Bouton>
        {ouvertEncore ? (
          <>
            <Bouton icone="faTrash" onClick={supprimer}>{t("supprimer")}</Bouton>
            <Bouton onClick={enregistrer} disabled={!modifie || occupe}>{t("enregistrer")}</Bouton>
            <Bouton variante="principal" icone="faCheck" onClick={valider} disabled={!e.comptes || occupe}>{t("valider")}</Bouton>
          </>
        ) : (
          <Etiquette ton="ok">{t("valideLe", { date: date(d.valideLe) })}</Etiquette>
        )}
      </Entete>
      <div className="stoConteneur">
        <section className="stoKpis">
          <Kpi label={t("progression")} valeur={`${pct} %`} aide={t("comptesSur", { n: e.comptes, total: e.total })} />
          <Kpi label={t("lignesEcart")} valeur={String(e.avecEcart)} ton={e.avecEcart ? "orange" : ""} />
          <Kpi label={t("ecartValorise")} valeur={m(ouvertEncore ? e.valeur : d.valeurEcart || 0)} ton={(ouvertEncore ? e.valeur : d.valeurEcart) < 0 ? "rouge" : ""} aide={t("auPmp")} />
          <Kpi label={t("entrepot")} valeur={nomEntrepot(d.entrepotId)} aide={(entrepots.find((x) => x.id === (d.entrepotId || ""))?.emplacements || []).length ? t("emplacementsN", { n: entrepots.find((x) => x.id === (d.entrepotId || "")).emplacements.length }) : ""} />
        </section>
        <div className="stoProgression" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>

        {!ouvertEncore && d.valeurEcart ? (
          <div className="stoEncadre">
            <b>{t("comptaTitre")}</b>
            <span>{t("comptaTexte", { montant: m(Math.abs(d.valeurEcart)), sens: d.valeurEcart < 0 ? t("perte") : t("excedent") })}</span>
          </div>
        ) : null}

        <div className="stoFiltres">
          {["tous", "aCompter", "ecarts"].map((k) => (
            <button key={k} type="button" aria-pressed={filtre === k} onClick={() => setFiltre(k)}>{t(`filtreInv_${k}`)}</button>
          ))}
        </div>
        <Carte>
          <div className="stoTableau" role="table">
            <div className="stoLigneT stoEnteteT stoColsComptage" role="row">
              <span>{t("article")}</span>
              <span>{t("emplacement")}</span>
              <span className="stoMt">{t("attendu")}</span>
              <span className="stoMt">{t("compte")}</span>
              <span className="stoMt">{t("ecart")}</span>
              <span className="stoMt">{t("valeur")}</span>
              <span>{t("cause")}</span>
            </div>
            {visibles.map(({ l, i }) => {
              const a = parId.get(l.articleId);
              const x = e.detail[i];
              return (
                <div key={l.articleId} className="stoLigneT stoColsComptage" role="row">
                  <span className="stoQui">
                    <b className="stoEllipse">{a?.data.designation || t("articleSupprime")}</b>
                    <small className="stoDoux">{a?.data.reference}</small>
                  </span>
                  <span className="stoDoux stoEllipse">{emplacementDe(a) || "—"}</span>
                  <span className="stoMt">{q(l.attendu)}</span>
                  <span className="stoMt">
                    {ouvertEncore ? (
                      <input className="stoQte" inputMode="decimal" value={l.compte ?? ""} onChange={(ev) => changer(i, "compte", ev.target.value)} aria-label={`${t("compte")} ${a?.data.designation || ""}`} />
                    ) : (
                      <b>{l.compte == null ? "—" : q(l.compte)}</b>
                    )}
                  </span>
                  <b className="stoMt" data-ton={x.ecart < 0 ? "rouge" : x.ecart > 0 ? "vert" : ""}>{x.ecart == null ? "" : `${x.ecart > 0 ? "+" : ""}${q(x.ecart)}`}</b>
                  <span className="stoMt stoDoux">{x.ecart ? m(x.valeur) : ""}</span>
                  <span>
                    {x.ecart ? (
                      ouvertEncore ? (
                        <select value={l.cause || ""} onChange={(ev) => changer(i, "cause", ev.target.value)} aria-label={t("cause")}>
                          <option value="">—</option>
                          {CAUSES.map((c) => <option key={c} value={t(`cause_${c}`)}>{t(`cause_${c}`)}</option>)}
                        </select>
                      ) : (
                        <span className="stoDoux">{l.cause || "—"}</span>
                      )
                    ) : null}
                  </span>
                </div>
              );
            })}
            {!visibles.length ? <p className="stoRien">{t("aucuneLigne")}</p> : null}
          </div>
        </Carte>
      </div>
    </div>
  );
};
