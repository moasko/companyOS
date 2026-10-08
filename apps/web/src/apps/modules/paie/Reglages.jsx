// Paie — barèmes et rubriques.
//
// Tout ce qui change par décret se règle ici : un taux CNPS, une tranche
// d'ITS, le SMIG. Le calcul applique ces valeurs, il ne les décrète pas.

import React, { useState } from "react";
import { modal } from "../../modalRequest";
import { REGLAGES_DEFAUT, completer } from "./domaine";
import { Bouton, Carte, Entete, useP } from "./commun";

const nombre = (v) => {
  const x = Number(String(v ?? "").replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};

export const Reglages = () => {
  const { t, reglages, majReglages, peutAdministrer, occupe } = useP();
  const [r, setR] = useState(() => completer(reglages));
  // Les champs gardent leur saisie jusqu'à la sortie ; un retour aux
  // valeurs par défaut les recrée.
  const [version, setVersion] = useState(0);
  const lecture = !peutAdministrer;

  const set = (chemin, valeur) =>
    setR((x) => {
      const [a, b] = chemin.split(".");
      return b ? { ...x, [a]: { ...x[a], [b]: valeur } } : { ...x, [a]: valeur };
    });

  const champ = (chemin, label) => {
    const [a, b] = chemin.split(".");
    const v = b ? r[a][b] : r[a];
    return (
      <label key={chemin}>
        <span>{label}</span>
        <input inputMode="decimal" disabled={lecture} defaultValue={String(v).replace(".", ",")} onBlur={(e) => set(chemin, nombre(e.target.value))} />
      </label>
    );
  };

  const enregistrer = async () => {
    const ok = await majReglages(r);
    if (ok) modal.alert({ title: t("regEnregistre"), message: t("regEnregistreMsg"), tone: "success" });
  };

  return (
    <div className="paiVue">
      <Entete titre={t("titreReglages")} sous={t("sousReglages")}>
        <Bouton disabled={lecture || occupe} onClick={() => {
          setR(completer(REGLAGES_DEFAUT));
          setVersion((v) => v + 1);
        }}>{t("regDefaut")}</Bouton>
        <Bouton variante="principal" disabled={lecture || occupe} onClick={enregistrer}>{t("regEnregistrer")}</Bouton>
      </Entete>
      <div className="paiConteneur" key={version}>
        {lecture ? <p className="paiInfo" data-ton="attention">{t("regAdmin")}</p> : null}
        <div className="paiReglages">
          <Carte titre={t("regCnps")}>
            <div className="paiChamps">
              {champ("cnps.retraiteSalarie", t("regRetraiteSal"))}
              {champ("cnps.retraiteEmployeur", t("regRetraiteEmp"))}
              {champ("cnps.prestationsFamiliales", t("regPf"))}
              {champ("cnps.accidentTravail", t("regAt"))}
              {champ("cnps.plafond", t("regPlafond"))}
              {champ("cnps.plafondPrestations", t("regPlafondPf"))}
            </div>
          </Carte>
          <Carte titre={t("regFdfp")}>
            <div className="paiChamps">
              {champ("fdfp.apprentissage", t("regApprentissage"))}
              {champ("fdfp.formationContinue", t("regFormation"))}
            </div>
          </Carte>
          <Carte titre={t("regCmu")}>
            <div className="paiChamps">
              {champ("cmu.montantParPersonne", t("regCmuMontant"))}
              <label className="paiCase">
                <input type="checkbox" disabled={lecture} checked={!!r.cmu.aLaChargeEmployeur} onChange={(e) => set("cmu.aLaChargeEmployeur", e.target.checked)} />
                <span>{t("regCmuEmployeur")}</span>
              </label>
            </div>
          </Carte>
          <Carte titre={t("regDivers")}>
            <div className="paiChamps">
              {champ("smig", t("regSmig"))}
              {champ("transport", t("regTransport"))}
              {champ("heuresMois", t("regHeures"))}
              {champ("joursMois", t("regJours"))}
            </div>
          </Carte>
          <Carte titre={t("regAnciennete")}>
            <div className="paiChamps">
              <label className="paiCase">
                <input type="checkbox" disabled={lecture} checked={!!r.anciennete.actif} onChange={(e) => set("anciennete.actif", e.target.checked)} />
                <span>{t("regAncActif")}</span>
              </label>
              {champ("anciennete.apresAns", t("regAncApres"))}
              {champ("anciennete.tauxInitial", t("regAncInitial"))}
              {champ("anciennete.parAn", t("regAncParAn"))}
              {champ("anciennete.max", t("regAncMax"))}
            </div>
          </Carte>
          <Carte titre={t("regIts")}>
            <div className="paiTranches">
              <span className="paiEnteteT">{t("regItsJusqua")}</span>
              <span className="paiEnteteT">{t("regItsTaux")}</span>
              {r.its.map((tr, i) => (
                <React.Fragment key={i}>
                  {tr.jusqua === Infinity ? (
                    <span className="paiDoux">{t("regItsInfini")}</span>
                  ) : (
                    <input
                      inputMode="numeric"
                      aria-label={`${t("regItsJusqua")} ${i + 1}`}
                      disabled={lecture}
                      defaultValue={tr.jusqua}
                      onBlur={(e) => setR((x) => ({ ...x, its: x.its.map((y, k) => (k === i ? { ...y, jusqua: nombre(e.target.value) } : y)) }))}
                    />
                  )}
                  <input
                    inputMode="decimal"
                    aria-label={`${t("regItsTaux")} ${i + 1}`}
                    disabled={lecture}
                    defaultValue={tr.taux}
                    onBlur={(e) => setR((x) => ({ ...x, its: x.its.map((y, k) => (k === i ? { ...y, taux: nombre(e.target.value) } : y)) }))}
                  />
                </React.Fragment>
              ))}
            </div>
            <div className="paiChamps">
              {champ("ricf.parDemiPart", t("regRicf"))}
            </div>
          </Carte>
        </div>
      </div>
    </div>
  );
};
