// Paie — payer les salaires, déclarer, passer en comptabilité.

import React, { useMemo } from "react";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { saveToCloud } from "../../cloud";
import { suivreLien } from "../../notifications";
import { etatFenetre } from "../../windows";
import { imagesPdf } from "../editeur-factures/images";
import { rapportPdf } from "../comptabilite/pdf";
import { ecritureDeBulletin } from "./domaine";
import * as C from "./cycle";
import { bulletinPdf } from "./pdf";
import { Bouton, Carte, Entete, csvDe, nomDe, ranger, useP } from "./commun";

const INTITULES = {
  661: "Rémunérations du personnel",
  664: "Charges sociales",
  641: "Impôts et taxes (FDFP)",
  421: "Personnel, rémunérations dues",
  431: "Sécurité sociale (CNPS)",
  447: "État, impôts retenus (ITS, FDFP)",
};

export const Paiement = () => {
  const { t, m, n, nomMois, date, mois, lignes, cycle, fige, bulletins, entreprise, occupe, tache, marquerPaye, marquerDeclare } = useP();
  const d = cycle?.data || {};
  const paye = ["paye", "declare"].includes(d.etat);
  const pay = useMemo(() => C.paiements(lignes), [lignes]);
  const decl = useMemo(() => C.declarations(lignes.map((l) => l.calcul), mois), [lignes, mois]);

  // L'écriture de paie du mois, somme des écritures de chaque bulletin —
  // la Comptabilité reprend ces mêmes écritures, une par salarié.
  const ecriture = useMemo(() => {
    const parCompte = new Map();
    for (const l of lignes) {
      const e = ecritureDeBulletin(l.calcul, l.salarie.data, mois);
      for (const x of e.lignes) {
        const c = parCompte.get(x.compte) || { compte: x.compte, debit: 0, credit: 0 };
        c.debit += x.debit;
        c.credit += x.credit;
        parCompte.set(x.compte, c);
      }
    }
    return [...parCompte.values()];
  }, [lignes, mois]);

  const fichier = (nom) => `${nom}-${mois}`;

  const exporterOrdre = () => ranger(new Blob([csvDe(C.ordreDeVirement(lignes, mois))], { type: "text/csv;charset=utf-8" }), `${fichier("ordre-virement")}.csv`, t);

  const exporterMobile = () =>
    ranger(
      new Blob(
        [csvDe([
          ["Matricule", "Bénéficiaire", "Téléphone", "Montant", "Motif"],
          ...pay.mobile.liste.map((l) => [l.salarie.data.matricule, nomDe(l.salarie.data), l.salarie.data.telephone || "", l.calcul.net, `SALAIRE ${mois}`]),
        ])],
        { type: "text/csv;charset=utf-8" },
      ),
      `${fichier("paiement-mobile")}.csv`,
      t,
    );

  const emargement = () =>
    ranger(
      rapportPdf({
        titre: "Bordereau d'émargement",
        sousTitre: `Salaires payés en espèces — ${nomMois(mois)}`,
        entreprise,
        colonnes: [
          { label: "Matricule", largeur: 0.14 },
          { label: "Salarié", largeur: 0.36 },
          { label: "Net payé", largeur: 0.2, align: "right" },
          { label: "Signature", largeur: 0.3 },
        ],
        lignes: [
          ...pay.especes.liste.map((l) => ({ cellules: [l.salarie.data.matricule, nomDe(l.salarie.data), n(l.calcul.net), "__________________"] })),
          { style: "total", cellules: ["", "Total", n(pay.especes.total), ""] },
        ],
        notes: ["Chaque salarié signe en face du montant reçu. Le bordereau signé justifie la sortie de caisse."],
      }),
      `${fichier("emargement")}.pdf`,
      t,
    );

  const livre = () =>
    ranger(
      new Blob(
        [csvDe([
          ["Matricule", "Nom", "Brut", "Ancienneté", "Heures sup.", "Primes", "CNPS salarié", "ITS", "CMU salarié", "Transport", "Frais", "Avances", "Net", "Charges patronales", "FDFP", "Coût total", "Paiement"],
          ...lignes.map((l) => {
            const c = l.calcul;
            return [l.salarie.data.matricule, nomDe(l.salarie.data), c.brut, c.primeAnciennete || 0, c.heuresSup || 0, c.primes, c.cotisationsSalariales, c.its, c.cmuSalarie, c.indemnites, c.frais || 0, c.retenues, c.net, c.chargesPatronales, c.fdfp || 0, c.coutTotal, l.saisie.modePaiement || ""];
          }),
        ])],
        { type: "text/csv;charset=utf-8" },
      ),
      `${fichier("livre-de-paie")}.csv`,
      t,
    );

  const bordereau = (type) => {
    const colonnes = {
      cnps: [["Retraite", (c) => c.cotisations.detail.retraiteSalarie + c.cotisations.detail.retraiteEmployeur], ["Prest. fam.", (c) => c.cotisations.detail.prestationsFamiliales], ["Acc. travail", (c) => c.cotisations.detail.accidentTravail]],
      its: [["Brut imposable", (c) => c.brut], ["Parts", (c) => c.parts], ["ITS retenu", (c) => c.its]],
      fdfp: [["Brut", (c) => c.brut], ["FDFP", (c) => c.fdfp || 0]],
      cmu: [["Montant", (c) => c.cmuSalarie + c.cmuEmployeur]],
    }[type];
    const largeur = 0.6 / colonnes.length;
    return ranger(
      rapportPdf({
        titre: t(`decl_${type}`).split(" — ")[0],
        sousTitre: `${nomMois(mois)} — échéance ${date(decl[type].echeance)}`,
        entreprise,
        colonnes: [
          { label: "Matricule", largeur: 0.14 },
          { label: "Salarié", largeur: 0.26 },
          ...colonnes.map(([l]) => ({ label: l, largeur, align: "right" })),
        ],
        lignes: [
          ...lignes.map((l) => ({ cellules: [l.salarie.data.matricule, nomDe(l.salarie.data), ...colonnes.map(([, f]) => n(f(l.calcul)))] })),
          { style: "total", cellules: ["", "Total à déclarer", ...colonnes.map(([, f], i) => (i === colonnes.length - 1 ? n(decl[type].montant) : n(lignes.reduce((s, l) => s + f(l.calcul), 0))))] },
        ],
        notes: [
          entreprise.cnpsEmployeur && type === "cnps" ? `N° employeur CNPS : ${entreprise.cnpsEmployeur}.` : "",
          entreprise.ncc && type !== "cnps" ? `NCC : ${entreprise.ncc}.` : "",
          "Montants calculés depuis les bulletins validés, à reporter sur le formulaire officiel.",
        ].filter(Boolean),
      }),
      `${fichier(`declaration-${type}`)}.pdf`,
      t,
    );
  };

  const disa = () => {
    const annee = mois.slice(0, 4);
    const lignesDisa = C.cumulsAnnuels(bulletins, annee).map((c) => {
      const s = lignes.find((l) => l.salarie.data.matricule === c.matricule)?.salarie.data || {};
      return [c.matricule, nomDe(s), s.numeroCnps || "", c.mois, c.brut, c.cnpsSalarie, c.cnpsEmployeur, c.its, c.net];
    });
    return ranger(
      new Blob([csvDe([["Matricule", "Nom", "N° CNPS", "Mois payés", "Brut", "CNPS salarié", "CNPS employeur", "ITS", "Net"], ...lignesDisa])], { type: "text/csv;charset=utf-8" }),
      `disa-${annee}.csv`,
      t,
    );
  };

  const moisDisa = new Set(bulletins.filter((b) => b.data.mois.startsWith(mois.slice(0, 4))).map((b) => b.data.mois)).size;

  /// Envoi groupé : chaque salarié reçoit son bulletin, rangé aussi dans le
  /// Cloud. C'est un envoi assumé, confirmé avant de partir.
  const envoyerTous = async () => {
    const avecEmail = lignes.filter((l) => l.salarie.data.email);
    const ok = await modal.confirm({
      title: t("envoyerTousTitre", { n: avecEmail.length }),
      message: t("envoyerTousMsg", { sans: lignes.length - avecEmail.length }),
      confirmLabel: t("envoyerTous", { n: avecEmail.length }),
    });
    if (!ok) return;
    await tache(async () => {
      const images = await imagesPdf({ afficherSignature: false }, entreprise);
      let envoyes = 0;
      const erreurs = [];
      for (const l of avecEmail) {
        const s = l.salarie.data;
        try {
          const anterieurs = bulletins.filter((b) => b.data.matricule === s.matricule && b.data.mois.startsWith(mois.slice(0, 4)) && b.data.mois <= mois);
          const cum = C.cumulsAnnuels(anterieurs, mois.slice(0, 4))[0] || {};
          const blob = bulletinPdf({ entreprise, salarie: s, mois, saisie: l.saisie, calcul: l.calcul, cumuls: cum, images });
          const node = await saveToCloud(blob, `bulletin-${s.matricule}-${mois}.pdf`, { folder: "Paie" });
          await api.courrierEnvoyer({
            a: s.email,
            sujet: `Bulletin de paie — ${nomMois(mois)}`,
            texte: `Bonjour ${s.prenom || ""},\n\nVeuillez trouver ci-joint votre bulletin de paie de ${nomMois(mois)}.\n\nCordialement,\n${entreprise.signataire || entreprise.nom || ""}`,
            piecesJointes: [node.id],
          });
          envoyes += 1;
        } catch (e) {
          erreurs.push(e.message);
        }
      }
      modal.alert({
        title: t("envoyerTous", { n: envoyes }),
        message: [t("envoyerTousOk", { n: envoyes }), erreurs.length ? t("envoyerTousErr", { n: erreurs.length, raison: erreurs[0] }) : ""].filter(Boolean).join("\n"),
        tone: erreurs.length ? "warning" : "success",
      });
    });
  };

  const ouvrirCompta = () => suivreLien({ lien: { app: "comptabilite", params: { section: "atraiter" } } });

  return (
    <div className="paiVue">
      <Entete titre={t("titrePaiement", { mois: nomMois(mois) })} sous={fige ? t("sousPaiement", { date: date(d.valideLe) }) : t("sousPaiementAvant")}>
        <Bouton icone="faFileExcel" onClick={livre} disabled={!lignes.length}>{t("livreDePaie")}</Bouton>
        <Bouton variante="principal" icone="faEnvelope" onClick={envoyerTous} disabled={!fige || occupe}>
          {t("envoyerTous", { n: lignes.filter((l) => l.salarie.data.email).length })}
        </Bouton>
      </Entete>

      <div className="paiConteneur">
        {!fige ? (
          <div className="paiInfo" data-ton="attention">
            <Icon fafa="faCircleInfo" width={13} />
            <span>{t("sousPaiementAvant")}</span>
          </div>
        ) : null}

        <Carte
          titre={t("payer", { montant: m(pay.virement.total + pay.mobile.total + pay.especes.total) })}
          aide={t("payerAide")}
          actions={
            fige && !paye ? (
              <Bouton variante="principal" icone="faCheck" disabled={occupe} onClick={marquerPaye}>{t("marquerPaye")}</Bouton>
            ) : paye ? (
              <span className="paiStatut" data-statut="pret">{t("detPaye", { date: date(d.payeLe) })}</span>
            ) : null
          }
        >
          <div className="paiPaiements">
            {[
              ["virement", exporterOrdre],
              ["mobile", exporterMobile],
              ["especes", emargement],
            ].map(([k, f]) => (
              <div key={k} className="paiPaiement">
                <span className="paiPaiementTete">
                  <b>{t(`pay_${k}`)}</b>
                  <span className="paiStatut" data-statut={paye ? "pret" : "entree"}>{paye ? t("paye") : t("pret")}</span>
                </span>
                <b className="paiGros">{m(pay[k].total)}</b>
                <small>{t(`payD_${k}`, { n: pay[k].liste.length })}</small>
                <Bouton onClick={f} disabled={!pay[k].liste.length}>{t(`payA_${k}`)}</Bouton>
              </div>
            ))}
          </div>
        </Carte>

        <div className="paiGrille">
          <Carte className="paiLarge" titre={t("declTitre")} aide={t("declAide")}>
            <div className="paiDeclarations">
              {["cnps", "its", "fdfp", "cmu"].map((k) => {
                const fait = d.declarations?.[k];
                return (
                  <div key={k} className="paiDeclaration">
                    <span>
                      <b>{t(`decl_${k}`)}</b>
                      <small>
                        {k === "cnps"
                          ? t("declD_cnps", { r: n(decl.cnps.retraite), pf: n(decl.cnps.pf), at: n(decl.cnps.at) })
                          : k === "cmu"
                            ? t("declD_cmu", { n: decl.cmu.personnes })
                            : t(`declD_${k}`)}
                      </small>
                    </span>
                    <b className="paiMt">{m(decl[k].montant)}</b>
                    <span className="paiEcheance">
                      <small>{t("echeance")}</small>
                      <b>{date(decl[k].echeance)}</b>
                    </span>
                    <span className="paiDeclActions">
                      <Bouton icone="faFilePdf" onClick={() => bordereau(k)} disabled={!lignes.length}>{t("bordereau")}</Bouton>
                      {fait ? (
                        <span className="paiStatut" data-statut="pret">{t("declareLe", { date: date(fait.le) })}</span>
                      ) : (
                        <Bouton variante="principal" disabled={!fige || occupe} onClick={() => marquerDeclare(k)}>{t("marquerDeclare")}</Bouton>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="paiDisa">
              <b>{t("disaTitre", { annee: mois.slice(0, 4) })}</b>
              <span>{t("disaTexte")}</span>
              <span className="paiProgres"><span style={{ width: `${(moisDisa / 12) * 100}%` }} /></span>
              <b>{moisDisa} / 12</b>
              <Bouton onClick={disa} disabled={!moisDisa}>{t("disaExport")}</Bouton>
            </div>
          </Carte>

          <aside className="paiColonne">
            <Carte titre={t("ecritureTitre")} actions={<span className="paiStatut" data-statut="pret">{t("ecritureEnvoyee")}</span>}>
              <div className="paiEcriture" role="table">
                {ecriture.map((x) => (
                  <div key={x.compte} className="paiEcrLigne" role="row">
                    <span className="paiCode">{x.compte}</span>
                    <span>{INTITULES[x.compte] || x.compte}</span>
                    <span className="paiMt" data-sens={x.debit ? "debit" : "credit"}>{n(x.debit || x.credit)}</span>
                  </div>
                ))}
              </div>
              {etatFenetre("comptabilite") ? (
                <button type="button" className="paiLien" onClick={ouvrirCompta}>{t("ouvrirCompta")}</button>
              ) : null}
            </Carte>
            <div className="paiInfo" data-ton="attention">
              <Icon fafa="faTriangleExclamation" width={13} />
              <span>{t("retardCnps")}</span>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
