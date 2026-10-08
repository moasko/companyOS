// Paie — le bulletin d'un salarié, sa remise, et le simulateur.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import { saveToCloud } from "../../cloud";
import { composerCourriel } from "../../courrielRequest";
import { ouvrirFichier } from "../../openRequest";
import { etatFenetre } from "../../windows";
import { imagesPdf } from "../editeur-factures/images";
import { bulletin as calculBulletin, SITUATIONS } from "./domaine";
import * as C from "./cycle";
import { bulletinPdf, libelleRubrique } from "./pdf";
import { Bouton, Carte, Entete, nomDe, useP } from "./commun";

const nombre = (v) => Number(String(v ?? "").replace(/[\s  ]/g, "").replace(",", ".")) || 0;

/// Les cumuls de l'année jusqu'au mois inclus, le mois en cours compris
/// même s'il n'est pas encore enregistré.
const cumulsJusqua = (bulletins, matricule, mois, calcul) => {
  const annee = mois.slice(0, 4);
  const anterieurs = bulletins.filter((b) => b.data.matricule === matricule && b.data.mois.startsWith(annee) && b.data.mois < mois);
  const c = C.cumulsAnnuels(anterieurs, annee)[0] || { brut: 0, its: 0, cnpsSalarie: 0, net: 0 };
  return {
    brut: c.brut + calcul.brut,
    its: c.its + calcul.its,
    cnpsSalarie: c.cnpsSalarie + calcul.cotisations.salariale,
    net: c.net + calcul.net,
  };
};

export const Bulletins = () => {
  const p = useP();
  const { t, m, n, nomMois, mois, lignes, fige, bulletins, intention, entreprise, enregistrerLigne, occupe, tache, langue } = p;
  const [choisi, setChoisi] = useState(intention?.matricule || lignes[0]?.salarie.data.matricule || "");
  const simulateur = useRef(null);
  useEffect(() => {
    if (intention?.simulateur) simulateur.current?.scrollIntoView({ block: "start" });
  }, [intention]);

  const index = Math.max(0, lignes.findIndex((l) => l.salarie.data.matricule === choisi));
  const ligne = lignes[index];
  const s = ligne?.salarie.data || {};
  const calcul = ligne?.calcul;

  const historique = useMemo(
    () =>
      bulletins
        .filter((b) => b.data.matricule === s.matricule && b.data.mois < mois)
        .sort((a, b) => b.data.mois.localeCompare(a.data.mois))
        .slice(0, 6),
    [bulletins, s.matricule, mois],
  );

  const fabriquer = async () => {
    const images = await imagesPdf({ afficherSignature: false }, entreprise);
    return bulletinPdf({
      entreprise,
      salarie: s,
      mois,
      saisie: ligne.saisie,
      calcul,
      cumuls: cumulsJusqua(bulletins, s.matricule, mois, calcul),
      images,
    });
  };
  const nomFichier = `bulletin-${s.matricule || "salarie"}-${mois}.pdf`;

  const telecharger = () =>
    tache(async () => {
      const blob = await fabriquer();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomFichier;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });

  const versCloud = async () => {
    const node = await tache(async () => saveToCloud(await fabriquer(), nomFichier, { folder: "Paie" }));
    if (node) {
      const ouvrir = await modal.confirm({
        title: t("exporte"),
        message: t("fichierRange", { nom: node.name }),
        confirmLabel: t("voir"),
        cancelLabel: "OK",
      });
      if (ouvrir) ouvrirFichier({ type: "FILE", id: node.id, name: node.name, mimeType: "application/pdf" });
    }
  };

  const parCourrier = async () => {
    const node = await tache(async () => saveToCloud(await fabriquer(), nomFichier, { folder: "Paie" }));
    if (!node) return;
    if (!etatFenetre("courrier")) {
      modal.alert({ title: t("exporte"), message: t("fichierRange", { nom: node.name }) });
      return;
    }
    composerCourriel({
      a: s.email || "",
      sujet: `Bulletin de paie — ${nomMois(mois)}`,
      texte: `Bonjour ${s.prenom || ""},\n\nVeuillez trouver ci-joint votre bulletin de paie de ${nomMois(mois)}.\n\nCordialement,\n${entreprise.signataire || entreprise.nom || ""}`,
      pieces: [{ id: node.id, nom: node.name }],
    });
  };

  if (!ligne) {
    return (
      <div className="paiVue">
        <Entete titre={t("navBulletins")} />
        <div className="paiConteneur">
          <p className="paiRien">{t("aucunSalarie")}</p>
          <Simulateur innerRef={simulateur} />
        </div>
      </div>
    );
  }

  const aller = (pas) => setChoisi(lignes[(index + pas + lignes.length) % lignes.length].salarie.data.matricule);

  return (
    <div className="paiVue">
      <Entete titre={t("titreBulletin", { nom: nomDe(s), mois: nomMois(mois) })} sous={fige ? t("fige") : t("brouillon")}>
        <select className="paiSelectTete" value={s.matricule} onChange={(e) => setChoisi(e.target.value)} aria-label={t("colSalarie")}>
          {lignes.map((l) => (
            <option key={l.salarie.data.matricule || l.salarie.id} value={l.salarie.data.matricule}>{nomDe(l.salarie.data)}</option>
          ))}
        </select>
        <div className="paiGroupe" role="group">
          <button type="button" className="paiBtnIcone" aria-label={t("precedent")} onClick={() => aller(-1)}>
            <Icon fafa="faChevronLeft" width={11} />
          </button>
          <button type="button" className="paiBtnIcone" aria-label={t("suivant")} onClick={() => aller(1)}>
            <Icon fafa="faChevronRight" width={11} />
          </button>
        </div>
        <Bouton icone="faFilePdf" onClick={telecharger} disabled={occupe}>{t("telechargerPdf")}</Bouton>
        {!fige ? (
          <Bouton variante="principal" icone="faCheck" disabled={occupe} onClick={() => enregistrerLigne(ligne, {})}>
            {t("marquerVerifie")}
          </Bouton>
        ) : null}
      </Entete>

      <div className="paiConteneur paiBulletinPage">
        <article className="paiFeuille" aria-label={t("navBulletins")}>
          <div className="paiFeuilleTete">
            <div>
              <b>{entreprise.nom || "—"}</b>
              <span>{[entreprise.adresse, entreprise.ville].filter(Boolean).join(", ")}</span>
              <span>{[entreprise.ncc ? `NCC ${entreprise.ncc}` : "", entreprise.cnpsEmployeur ? `CNPS ${entreprise.cnpsEmployeur}` : ""].filter(Boolean).join(" · ")}</span>
            </div>
            <div className="paiDroite">
              <b className="paiTitreDoc">{t("titreFeuille").toUpperCase()}</b>
              <span>{nomMois(mois)}</span>
              <span>{t(`mode_${ligne.saisie.modePaiement || "virement"}`)}</span>
            </div>
          </div>

          <div className="paiIdentite">
            {[
              [t("colSalarie"), nomDe(s)],
              ["Matricule", s.matricule],
              [t("colPoste"), s.poste],
              ["CNPS", s.numeroCnps || "—"],
              [t("simSituation"), `${t(`situation_${ligne.saisie.situation || "celibataire"}`)}${ligne.saisie.enfants ? ` · ${ligne.saisie.enfants}` : ""}`],
              ["ITS", `${calcul.parts} part(s)`],
            ].map(([l, v]) => (
              <span key={l}>
                <small>{l}</small>
                <b>{v || "—"}</b>
              </span>
            ))}
          </div>

          <div className="paiRubriques" role="table">
            <div className="paiRub paiRubTete" role="row">
              <span>N°</span>
              <span>{t("colRubrique")}</span>
              <span className="paiMt">{t("colBase")}</span>
              <span className="paiMt">{t("colTaux")}</span>
              <span className="paiMt">{t("colGain")}</span>
              <span className="paiMt">{t("colRetenue")}</span>
              <span className="paiMt">{t("colPatronal")}</span>
            </div>
            {calcul.rubriques.map((r) => (
              <div key={r.code} className="paiRub" role="row" data-sous={r.sousTotal ? "true" : "false"}>
                <span className="paiDoux">{r.code}</span>
                <span>{libelleRubrique(r, t)}</span>
                <span className="paiMt">{typeof r.base === "number" && !["absences", "heuresSup", "cmu"].includes(r.libelle) ? n(r.base) : r.base}</span>
                <span className="paiMt">{r.taux !== "" && r.taux != null ? `${Number(r.taux).toLocaleString(langue === "en" ? "en-US" : "fr-FR")} %` : ""}</span>
                <span className="paiMt">{r.gain ? n(r.gain) : ""}</span>
                <span className="paiMt">{r.retenue ? n(r.retenue) : ""}</span>
                <span className="paiMt paiDoux">{r.patronal ? n(r.patronal) : ""}</span>
              </div>
            ))}
          </div>

          <div className="paiNetBloc">
            <span>{t("netAPayer")}</span>
            <b>{m(calcul.net)}</b>
          </div>
          <p className="paiDoux paiPetit">{t("coutMois", { montant: m(calcul.coutTotal) })}</p>
        </article>

        <aside className="paiColonne">
          <Carte titre={t("remettre")}>
            <div className="paiRemise">
              <button type="button" onClick={telecharger} disabled={occupe}>
                <span className="paiRemiseIcone"><Icon fafa="faFilePdf" width={15} /></span>
                <span><b>{t("envPdf")}</b><small>{t("envPdfD")}</small></span>
              </button>
              <button type="button" onClick={parCourrier} disabled={occupe}>
                <span className="paiRemiseIcone"><Icon fafa="faEnvelope" width={15} /></span>
                <span><b>{t("envCourrier")}</b><small>{s.email ? t("envCourrierD", { email: s.email }) : t("envCourrierSans")}</small></span>
              </button>
              <button type="button" onClick={versCloud} disabled={occupe}>
                <span className="paiRemiseIcone"><Icon fafa="faCloud" width={15} /></span>
                <span><b>{t("envCloud")}</b><small>{t("envCloudD", { fichier: nomFichier })}</small></span>
              </button>
            </div>
          </Carte>

          {!fige ? <ElementsDuMois ligne={ligne} /> : null}

          <Carte titre={t("historique")}>
            {historique.length ? (
              <ul className="paiHistorique">
                {historique.map((h) => (
                  <li key={h.id}>
                    <span>{nomMois(h.data.mois)}</span>
                    <b className="paiMt">{m(h.data.calcul?.net)}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="paiRien">{t("aucunHistorique")}</p>
            )}
          </Carte>

          <Simulateur innerRef={simulateur} defaut={s} />
        </aside>
      </div>
    </div>
  );
};

const ElementsDuMois = ({ ligne }) => {
  const { t, enregistrerLigne, occupe } = useP();
  const [v, setV] = useState({
    situation: ligne.saisie.situation || "celibataire",
    enfants: ligne.saisie.enfants || 0,
    personnesCmu: ligne.saisie.personnesCmu ?? 1,
  });
  const change = JSON.stringify(v) !== JSON.stringify({ situation: ligne.saisie.situation || "celibataire", enfants: ligne.saisie.enfants || 0, personnesCmu: ligne.saisie.personnesCmu ?? 1 });
  return (
    <Carte titre={t("elementsMois")}>
      <div className="paiChamps">
        <label>
          <span>{t("simSituation")}</span>
          <select value={v.situation} onChange={(e) => setV((x) => ({ ...x, situation: e.target.value }))}>
            {SITUATIONS.map((x) => (
              <option key={x.id} value={x.id}>{t(`situation_${x.id}`)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("simEnfants")}</span>
          <input inputMode="numeric" value={v.enfants} onChange={(e) => setV((x) => ({ ...x, enfants: nombre(e.target.value) }))} />
        </label>
        <label>
          <span>{t("personnesCmu")}</span>
          <input inputMode="numeric" value={v.personnesCmu} onChange={(e) => setV((x) => ({ ...x, personnesCmu: nombre(e.target.value) }))} />
        </label>
      </div>
      {change ? (
        <Bouton variante="principal" disabled={occupe} onClick={() => enregistrerLigne(ligne, v)}>{t("enregistrer")}</Bouton>
      ) : null}
    </Carte>
  );
};

/// Le simulateur : pour une embauche ou une augmentation, sans rien
/// enregistrer. Dans les deux sens, brut vers net et net vers brut.
const Simulateur = ({ innerRef, defaut = {} }) => {
  const { t, m, reglages, langue } = useP();
  const [sens, setSens] = useState("brutNet");
  const [montant, setMontant] = useState(String(defaut.salaireBase || 500000));
  const [situation, setSituation] = useState("celibataire");
  const [enfants, setEnfants] = useState(0);
  const r = useMemo(() => {
    const v = nombre(montant);
    const brut = sens === "brutNet" ? v : C.netVersBrut(v, { situation, enfants }, reglages);
    const b = calculBulletin({ salaireBase: brut }, { situation, enfants, personnesCmu: 1 }, reglages);
    return { brut, b, taux: brut ? ((brut - b.net) / brut) * 100 : 0 };
  }, [montant, sens, situation, enfants, reglages]);
  return (
    <section ref={innerRef}>
      <Carte
        titre={t("simTitre")}
        actions={
          <div className="paiOnglets" role="group">
            {["brutNet", "netBrut"].map((k) => (
              <button key={k} type="button" aria-pressed={sens === k} onClick={() => setSens(k)}>
                {t(k === "brutNet" ? "simBrutNet" : "simNetBrut")}
              </button>
            ))}
          </div>
        }
      >
        <div className="paiChamps">
          <label className="paiChampLarge">
            <span>{t(sens === "brutNet" ? "simBrut" : "simNet")}</span>
            <input inputMode="numeric" className="paiGrosChamp" value={montant} onChange={(e) => setMontant(e.target.value)} />
          </label>
          <label>
            <span>{t("simSituation")}</span>
            <select value={situation} onChange={(e) => setSituation(e.target.value)}>
              {SITUATIONS.map((x) => (
                <option key={x.id} value={x.id}>{t(`situation_${x.id}`)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("simEnfants")}</span>
            <input inputMode="numeric" value={enfants} onChange={(e) => setEnfants(nombre(e.target.value))} />
          </label>
        </div>
        <ul className="paiResultats">
          {sens === "netBrut" ? (
            <li><span>{t("simResBrut")}</span><b className="paiFort">{m(r.brut)}</b></li>
          ) : (
            <li><span>{t("simResNet")}</span><b className="paiFort">{m(r.b.net)}</b></li>
          )}
          <li><span>{t("simResCout")}</span><b>{m(r.b.coutTotal)}</b></li>
          <li><span>{t("simResTaux")}</span><b>{r.taux.toLocaleString(langue === "en" ? "en-US" : "fr-FR", { maximumFractionDigits: 1 })} %</b></li>
        </ul>
        <small className="paiDoux">{t("simAide")}</small>
      </Carte>
    </section>
  );
};

