// Paie — les éléments variables du mois.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import { choisirFichierCloud, blobDuFichier } from "../../ChoisirFichier";
import * as C from "./cycle";
import { libelleRubrique } from "./pdf";
import { Bouton, Carte, Entete, nomDe, useP } from "./commun";

const nombre = (v) => Number(String(v ?? "").replace(/[\s  ]/g, "").replace(",", ".")) || 0;
const HS = ["h15", "h50", "h75", "h100"];

/// Lit un CSV de variables : une ligne par matricule.
export const lireVariables = (texte) => {
  const lignes = texte.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lignes.length < 2) return [];
  const sep = lignes[0].includes(";") ? ";" : lignes[0].includes("\t") ? "\t" : ",";
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/["']/g, "").trim();
  const entetes = lignes[0].split(sep).map(norm);
  const col = (...noms) => entetes.findIndex((e) => noms.some((n) => e === n || e.startsWith(n)));
  const c = {
    matricule: col("matricule", "employee"),
    primes: col("primes", "prime", "bonus"),
    avance: col("avance", "advance", "retenue"),
    transport: col("transport"),
    h15: col("heures 15", "hs 15", "h15"),
    h50: col("heures 50", "hs 50", "h50"),
    h75: col("heures 75", "hs 75", "h75"),
    h100: col("heures 100", "hs 100", "h100"),
  };
  if (c.matricule < 0) return [];
  return lignes.slice(1).map((l) => {
    const v = l.split(sep).map((x) => x.replace(/^"|"$/g, "").trim());
    const out = { matricule: v[c.matricule] };
    if (c.primes >= 0 && v[c.primes] !== "") out.primes = nombre(v[c.primes]);
    if (c.avance >= 0 && v[c.avance] !== "") out.retenues = nombre(v[c.avance]);
    if (c.transport >= 0 && v[c.transport] !== "") out.indemnites = nombre(v[c.transport]);
    const hs = {};
    for (const k of HS) if (c[k] >= 0 && v[c[k]] !== "") hs[k] = nombre(v[c[k]]);
    if (Object.keys(hs).length) out.heuresSup = hs;
    return out;
  }).filter((x) => x.matricule);
};

export const Variables = () => {
  const { t, n, nomMois, mois, lignes, fige, totaux, precedents, reglages, occupe, aller, enregistrerLigne, tache } = useP();
  const [focus, setFocus] = useState(null);
  // Le calcul de la ligne en cours de saisie, avant même son
  // enregistrement : c'est lui que montre l'aperçu.
  const [live, setLive] = useState(null);
  const fichier = useRef(null);

  const choisie = lignes.find((l) => (l.salarie.data.matricule || l.salarie.id) === focus) || lignes[0];
  const prets = lignes.filter((l) => l.enregistre).length;

  const appliquerImport = async (texte, nom) => {
    const lues = lireVariables(texte);
    const cibles = lues.map((x) => ({ x, l: lignes.find((l) => l.salarie.data.matricule === x.matricule) })).filter((c) => c.l);
    if (!cibles.length) {
      modal.alert({ title: t("importer"), message: t("importVide"), tone: "warning" });
      return;
    }
    for (const { x, l } of cibles) {
      const { matricule: _m, ...patch } = x;
      await enregistrerLigne(l, patch);
    }
    modal.alert({ title: t("importer"), message: t("importOk", { n: cibles.length, fichier: nom }), tone: "success" });
  };

  const importer = async () => {
    const source = await modal.open({
      title: t("importer"),
      render: ({ close }) => (
        <div className="paiChoix">
          <p>{t("importAide")}</p>
          <button type="button" onClick={() => close("ordi")}><Icon fafa="faUpload" width={15} />{t("depuisOrdinateur")}</button>
          <button type="button" onClick={() => close("cloud")}><Icon fafa="faCloud" width={15} />{t("depuisCloud")}</button>
        </div>
      ),
    });
    if (source === "ordi") fichier.current?.click();
    if (source === "cloud") {
      const node = await choisirFichierCloud({ titre: t("importer"), filtre: (x) => /\.(csv|txt)$/i.test(x.name) });
      if (node) await tache(async () => appliquerImport(await (await blobDuFichier(node)).text(), node.name));
    }
  };

  return (
    <div className="paiVue">
      <Entete titre={t("titreVariables", { mois: nomMois(mois) })} sous={fige ? t("figee") : t("sousVariables")}>
        <Bouton icone="faFileImport" onClick={importer} disabled={fige || occupe}>{t("importer")}</Bouton>
        <Bouton variante="principal" onClick={() => aller("cycle")}>{t("terminer")}</Bouton>
        <input
          ref={fichier}
          type="file"
          hidden
          accept=".csv,.txt,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) await tache(async () => appliquerImport(await f.text(), f.name));
          }}
        />
      </Entete>

      <div className="paiConteneur">
        <div className="paiLegende">
          <b>{t("origine")}</b>
          <span><em data-org="conges">{t("orgConges")}</em> {t("orgCongesD")}</span>
          <span><em data-org="frais">{t("orgFrais")}</em> {t("orgFraisD")}</span>
          <span><em data-org="contrat">{t("orgContrat")}</em> {t("orgContratD")}</span>
          <span><em data-org="saisi">{t("orgSaisi")}</em> {t("orgSaisiD")}</span>
        </div>

        <div className="paiGrille paiPile">
          <Carte className="paiLarge paiCarteGrille">
            <div className="paiDefile">
              <div className="paiVariables" role="table" aria-label={t("navVariables")}>
                <div className="paiVL paiEnteteT" role="row">
                  <span>{t("colSalarie")}</span>
                  <span>{t("colAbsences")}</span>
                  <span>{t("colHeuresSup")}</span>
                  <span className="paiMt">{t("colPrimes")}</span>
                  <span className="paiMt">{t("colAvance")}</span>
                  <span className="paiMt">{t("colTransport")}</span>
                  <span className="paiMt">{t("colFrais")}</span>
                  <span>{t("colPaiement")}</span>
                  <span className="paiMt">{t("colNetEstime")}</span>
                </div>
                {lignes.map((l) => (
                  <LigneVariables
                    key={l.salarie.id || l.salarie.data.matricule}
                    ligne={l}
                    actif={choisie === l}
                    onFocus={() => setFocus(l.salarie.data.matricule || l.salarie.id)}
                    onLive={setLive}
                  />
                ))}
                <div className="paiVL paiTotalV" role="row">
                  <span>{t("totalLigne", { n: lignes.length, prets })}</span>
                  <span />
                  <span>{n(totaux.heuresSup)}</span>
                  <span className="paiMt">{n(totaux.primes)}</span>
                  <span />
                  <span />
                  <span className="paiMt">{n(totaux.frais)}</span>
                  <span />
                  <span className="paiMt">{n(totaux.net)}</span>
                </div>
              </div>
            </div>
          </Carte>

          <aside className="paiColonne">
            {choisie ? (
              <ApercuLive
                ligne={choisie}
                calcul={live?.cle === (choisie.salarie.data.matricule || choisie.salarie.id) ? live.calcul : choisie.calcul}
                precedent={precedents.get(choisie.salarie.data.matricule)}
              />
            ) : null}
            <Carte titre={t("majTitre")} aide={t("majAide", { h: String(reglages.heuresMois).replace(".", ",") })}>
              <ul className="paiMajorations">
                {HS.map((k) => (
                  <li key={k}>
                    <span>{t(`maj_${k}`)}</span>
                    <b>+ {reglages.majorations[k]} %</b>
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

/// Une ligne de la grille. Elle garde sa saisie en local pendant qu'on la
/// remplit et s'enregistre quand le focus la quitte : pas de bouton à
/// chercher, pas d'appel réseau à chaque touche.
const LigneVariables = ({ ligne, actif, onFocus, onLive }) => {
  const { t, m, n, fige, reglages, langue, enregistrerLigne, aller } = useP();
  const [brouillon, setBrouillon] = useState(null);
  const saisie = brouillon || ligne.saisie;
  const calcul = useMemo(() => (brouillon ? C.calculer(ligne.salarie, brouillon, reglages) : ligne.calcul), [brouillon, ligne, reglages]);
  const s = ligne.salarie.data;
  useEffect(() => {
    if (actif) onLive({ cle: s.matricule || ligne.salarie.id, calcul });
  }, [actif, calcul]); // eslint-disable-line react-hooks/exhaustive-deps
  const maj = (patch) => setBrouillon((b) => ({ ...(b || ligne.saisie), ...patch }));
  const sauver = async (e) => {
    if (e && e.currentTarget.contains(e.relatedTarget)) return;
    if (!brouillon) return;
    const patch = {};
    for (const k of ["primes", "retenues", "indemnites", "modePaiement", "heuresSup", "absences", "frais"]) {
      if (JSON.stringify(brouillon[k]) !== JSON.stringify(ligne.saisie[k])) patch[k] = brouillon[k];
    }
    setBrouillon(null);
    if (Object.keys(patch).length) await enregistrerLigne(ligne, patch);
  };

  const hsTotal = HS.reduce((x, k) => x + (Number(saisie.heuresSup?.[k]) || 0), 0);
  const nonPayes = (Number(saisie.absences?.injustifiee) || 0) + (Number(saisie.absences?.sansSolde) || 0);
  const info = saisie.absencesInfo || {};

  const editerHeures = async () => {
    const r = await modal.open({
      title: t("heuresDe", { nom: nomDe(s) }),
      render: ({ close }) => <FormHeures valeur={saisie.heuresSup || {}} close={close} t={t} reglages={reglages} />,
    });
    if (r) {
      setBrouillon(null);
      await enregistrerLigne(ligne, { heuresSup: r });
    }
  };

  const editerAbsences = async () => {
    const r = await modal.open({
      title: `${t("colAbsences")} — ${nomDe(s)}`,
      render: ({ close }) => <FormAbsences valeur={saisie.absences || {}} close={close} t={t} langue={langue} />,
    });
    if (r) await enregistrerLigne(ligne, { absences: r });
  };

  const champ = (cle, label) => (
    <input
      className="paiMtSaisie"
      inputMode="numeric"
      aria-label={`${label} — ${nomDe(s)}`}
      disabled={fige}
      data-saisi={Number(saisie[cle]) && cle !== "indemnites" ? "true" : "false"}
      value={saisie[cle] ? String(saisie[cle]) : ""}
      placeholder="0"
      onChange={(e) => maj({ [cle]: nombre(e.target.value) })}
    />
  );

  return (
    <div className="paiVL" role="row" data-actif={actif ? "true" : "false"} onFocus={onFocus} onBlur={sauver} onClick={onFocus}>
      <span className="paiQuiV">
        <b className="paiEllipse">{nomDe(s)}</b>
        <small>{t("base", { montant: n(s.salaireBase), anc: calcul.tauxAnciennete ? t("ancOui", { taux: calcul.tauxAnciennete }) : t("ancNon") })}</small>
      </span>
      <span className="paiCellule">
        <button type="button" className="paiLienCellule" disabled={fige} onClick={editerAbsences}>
          {nonPayes ? <em data-org={saisie.absencesManuelles ? "saisi" : "conges"} data-alerte="true">{t("joursNonPayes", { n: nonPayes })}</em> : null}
          {info.conge ? <em data-org="conges">{t("joursCongeInfo", { n: info.conge })}</em> : null}
          {info.maladie ? <em data-org="conges">{t("joursMaladieInfo", { n: info.maladie })}</em> : null}
          {!nonPayes && !info.conge && !info.maladie ? <span className="paiPale">{t("aucune")}</span> : null}
        </button>
        {saisie.prorata ? <small>{saisie.prorata.jours} / {saisie.prorata.sur} j</small> : null}
      </span>
      <span className="paiCellule">
        <button type="button" className="paiLienCellule" disabled={fige} onClick={editerHeures}>
          {hsTotal ? <span>{t("hsResume", { h: hsTotal, montant: n(calcul.heuresSup) })}</span> : <span className="paiPale">+ {t("colHeuresSup")}</span>}
        </button>
      </span>
      {champ("primes", t("colPrimes"))}
      {champ("retenues", t("colAvance"))}
      {champ("indemnites", t("colTransport"))}
      <span className="paiCellule paiMt">
        {saisie.frais ? <em data-org={saisie.fraisManuels ? "saisi" : "frais"}>{n(saisie.frais)}</em> : <span className="paiPale">—</span>}
      </span>
      <select aria-label={`${t("colPaiement")} — ${nomDe(s)}`} disabled={fige} value={saisie.modePaiement || "virement"} onChange={(e) => maj({ modePaiement: e.target.value })}>
        {["virement", "mobile", "especes"].map((k) => (
          <option key={k} value={k}>{t(`mode_${k}`)}</option>
        ))}
      </select>
      <button type="button" className="paiNetV paiMt" title={t("voirBulletin")} onClick={() => aller("bulletins", { matricule: s.matricule })}>
        {m(calcul.net)}
        {!ligne.enregistre ? <i aria-hidden="true">•</i> : null}
      </button>
    </div>
  );
};

// Les boîtes de dialogue s'affichent hors de la fenêtre, donc hors du
// contexte de l'app : elles reçoivent ce qu'il leur faut en props.
const FormHeures = ({ valeur, close, t, reglages }) => {
  const [v, setV] = useState({ ...valeur });
  return (
    <div className="paiForm">
      {HS.map((k) => (
        <label key={k}>
          <span>{t(`maj_${k}`)} · + {reglages.majorations[k]} %</span>
          <input inputMode="decimal" value={v[k] || ""} placeholder="0" onChange={(e) => setV((x) => ({ ...x, [k]: nombre(e.target.value) }))} />
        </label>
      ))}
      <div className="paiActionsForm">
        <Bouton onClick={() => close(null)}>{t("annuler")}</Bouton>
        <Bouton variante="principal" onClick={() => close(Object.fromEntries(Object.entries(v).filter(([, x]) => Number(x) > 0)))}>{t("enregistrer")}</Bouton>
      </div>
    </div>
  );
};

const FormAbsences = ({ valeur, close, t, langue }) => {
  const [v, setV] = useState({ injustifiee: valeur.injustifiee || 0, sansSolde: valeur.sansSolde || 0 });
  const libelles = langue === "en"
    ? { injustifiee: "Unexcused absence (days)", sansSolde: "Unpaid leave (days)" }
    : { injustifiee: "Absence injustifiée (jours)", sansSolde: "Congé sans solde (jours)" };
  return (
    <div className="paiForm">
      {Object.keys(v).map((k) => (
        <label key={k}>
          <span>{libelles[k]}</span>
          <input inputMode="decimal" value={v[k] || ""} placeholder="0" onChange={(e) => setV((x) => ({ ...x, [k]: nombre(e.target.value) }))} />
        </label>
      ))}
      <div className="paiActionsForm">
        <Bouton onClick={() => close(null)}>{t("annuler")}</Bouton>
        <Bouton variante="principal" onClick={() => close(v)}>{t("enregistrer")}</Bouton>
      </div>
    </div>
  );
};

/// L'effet de la saisie sur le bulletin, ligne par ligne, à l'instant.
const ApercuLive = ({ ligne, calcul, precedent }) => {
  const { t, m, aller } = useP();
  const c = calcul;
  const ecart = precedent?.net ? c.net - precedent.net : 0;
  return (
    <Carte
      className="paiApercu"
      titre={t("apercu", { nom: nomDe(ligne.salarie.data) })}
      actions={<button type="button" className="paiLien" onClick={() => aller("bulletins", { matricule: ligne.salarie.data.matricule })}>{t("voirBulletin")}</button>}
    >
      <ul className="paiApercuListe">
        {c.rubriques
          .filter((r) => r.gain || r.retenue)
          .map((r) => (
            <li key={r.code} data-sous={r.sousTotal ? "true" : "false"}>
              <span>{libelleRubrique(r, t)}</span>
              <span className="paiMt">{r.sousTotal ? m(r.gain) : r.gain ? `+ ${m(r.gain)}` : `− ${m(r.retenue)}`}</span>
            </li>
          ))}
        <li data-net="true">
          <span>{t("netAPayer")}</span>
          <b className="paiMt">{m(c.net)}</b>
        </li>
      </ul>
      {Math.abs(ecart) >= 1000 ? (
        <div className="paiInfo" data-ton="attention">
          <Icon fafa="faCircleInfo" width={13} />
          <span>{t(ecart < 0 ? "baisseNet" : "hausseNet", { montant: m(Math.abs(ecart)) })}</span>
        </div>
      ) : null}
    </Carte>
  );
};
