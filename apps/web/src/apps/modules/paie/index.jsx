// Paie.
//
// ─────────────────────────────────────────────────────────────────────────
// LE MODÈLE : UN CYCLE, PAS UNE PILE DE BULLETINS
//
// Les outils de paie les plus appréciés (PayFit en tête) ont changé une
// chose : la paie n'est plus une liste de bulletins qu'on remplit un à un,
// c'est un cycle mensuel qu'on fait avancer — éléments variables,
// contrôles, validation, paiement, déclarations. Le logiciel dit à chaque
// étape ce qui empêche de passer à la suivante, et montre l'effet d'une
// saisie sur le bulletin au moment où on la fait.
//
// La rigueur, elle, vient des logiciels de paie ivoiriens (Sage Paie en
// tête) : bulletin conforme, CNPS (retraite, prestations familiales,
// accident du travail), ITS à la DGI, FDFP, CMU, DISA annuelle, et
// l'écriture de paie pour la Comptabilité.
//
// CE QUI N'EST JAMAIS RESSAISI
//
//   - les salariés, leur contrat, leur banque : l'app Ressources humaines ;
//   - les absences : l'app Congés (une absence injustifiée ou sans solde
//     retient le salaire, un congé payé s'affiche) ;
//   - les notes de frais approuvées : l'app Frais, remboursées avec le
//     salaire puis marquées « remboursées » au paiement ;
//   - l'employeur (raison sociale, NCC, n° CNPS, logo) : la fiche
//     entreprise.
//
// Et en sortie : les bulletins PDF (Cloud, Courrier), l'ordre de virement,
// les bordereaux, l'écriture de paie que la Comptabilité reprend seule.
//
// La langue de l'écran suit celle du système ; le bulletin reste en
// français, langue légale. Les règles sont dans domaine.js et cycle.js,
// testées sans navigateur.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { Contenu, useChargement } from "../../chargement";
import { useEntreprise } from "../../entreprise";
import { useLangue, useTraduction } from "../../../utils/intl";
import { LANGUES } from "../../../utils/langue";
import * as D from "./domaine";
import * as C from "./cycle";
import { TEXTES, dateDe, deMois, formateur, nomDuMois, nombreDe } from "./textes";
import { Ctx, aujourdhui } from "./commun";
import { Cycle } from "./Cycle";
import { Variables } from "./Variables";
import { Bulletins } from "./Bulletins";
import { Paiement } from "./Paiement";
import { Reglages } from "./Reglages";
import "./paie.scss";
import { manifest as descriptif } from "./manifest";

export const manifest = { ...descriptif, Window: PaieApp };

const NAV = [
  { groupe: "grpSuivre" },
  { id: "cycle", label: "navCycle", icone: "faRotate" },
  { groupe: "grpPreparer" },
  { id: "variables", label: "navVariables", icone: "faTableList" },
  { id: "bulletins", label: "navBulletins", icone: "faFileInvoice" },
  { groupe: "grpPayer" },
  { id: "paiement", label: "navPaiement", icone: "faMoneyCheckDollar" },
  { groupe: "grpReglages" },
  { id: "reglages", label: "navReglages", icone: "faSliders" },
];

const VUES = { cycle: Cycle, variables: Variables, bulletins: Bulletins, paiement: Paiement, reglages: Reglages };

function PaieApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const { entreprise } = useEntreprise(ouvert);
  const tBrut = useTraduction(TEXTES);
  // Un mois passé en paramètre fournit aussi sa forme élidée : « Paie
  // d'octobre », « Paie de mars ».
  const t = useCallback(
    (cle, params) => tBrut(cle, params?.mois ? { ...params, deMois: deMois(params.mois) } : params),
    [tBrut],
  );
  const langue = useLangue();
  const m = useMemo(() => formateur(langue), [langue]);
  const n = useMemo(() => nombreDe(langue), [langue]);

  const [section, setSection] = useState("cycle");
  const [intention, setIntention] = useState(null);
  const [mois, setMois] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [donnees, setDonnees] = useState({ salaries: [], absences: [], notes: [], bulletins: [], reglages: null, cycles: [] });

  const charger = useCallback(async () => {
    const liste = (mod, col) => api.records.list(mod, col).catch(() => []);
    const [salaries, absences, notes, bulletins, reglages, cycles] = await Promise.all([
      liste("rh", "salaries"),
      liste("rh", "absences"),
      liste("frais", "notes"),
      api.records.list(manifest.slug, "bulletins"),
      liste(manifest.slug, "reglages"),
      liste(manifest.slug, "cycles"),
    ]);
    setDonnees({ salaries, absences, notes, bulletins, reglages: reglages[0] || null, cycles });
  }, []);
  // Rechargement en direct quand un collègue modifie ces collections.
  const etat = useChargement(ouvert, charger, { ecoute: ["paie/*", "rh/salaries", "frais/notes"] });

  const { salaries, absences, notes, bulletins, cycles } = donnees;
  const reglages = useMemo(() => D.completer(donnees.reglages?.data || {}), [donnees.reglages]);

  // Le mois ouvert par défaut : le précédent s'il reste à payer, sinon le
  // mois en cours — on paie d'ordinaire à la fin du mois travaillé.
  const moisCourant = aujourdhui().slice(0, 7);
  const moisActif = useMemo(() => {
    if (mois) return mois;
    const prec = C.moisPrecedent(moisCourant);
    const cyclePrec = cycles.find((c) => c.data.mois === prec);
    const aDesBulletins = bulletins.some((b) => b.data.mois === prec);
    return aDesBulletins && !["paye", "declare"].includes(cyclePrec?.data?.etat) ? prec : moisCourant;
  }, [mois, cycles, bulletins, moisCourant]);

  const cycle = cycles.find((c) => c.data.mois === moisActif) || null;
  const fige = ["valide", "paye", "declare"].includes(cycle?.data?.etat);

  // Les lignes du mois : une par salarié payé, avec sa saisie et son calcul.
  const lignes = useMemo(() => {
    const duMois = new Map(bulletins.filter((b) => b.data.mois === moisActif).map((b) => [b.data.matricule, b]));
    if (fige) {
      return [...duMois.values()].map((b) => {
        const salarie = salaries.find((s) => s.data.matricule === b.data.matricule) || { id: "", data: { matricule: b.data.matricule } };
        return { salarie, saisie: b.data.saisie || {}, calcul: b.data.calcul, enregistre: true, record: b };
      });
    }
    return salaries
      .filter((s) => C.payeLeMois(s.data, moisActif))
      .sort((a, b) => `${a.data.nom} ${a.data.prenom}`.localeCompare(`${b.data.nom} ${b.data.prenom}`, "fr"))
      .map((s) => {
        const saisie = C.saisieInitiale({ salarie: s, mois: moisActif, bulletins, absences, notes, reglages });
        const record = duMois.get(s.data.matricule) || null;
        return { salarie: s, saisie, calcul: C.calculer(s, saisie, reglages), enregistre: !!record, record };
      });
  }, [bulletins, salaries, absences, notes, reglages, moisActif, fige]);

  const precedents = useMemo(() => {
    const prec = C.moisPrecedent(moisActif);
    return new Map(bulletins.filter((b) => b.data.mois === prec).map((b) => [b.data.matricule, b.data.calcul]));
  }, [bulletins, moisActif]);

  const controles = useMemo(() => (fige ? [] : C.controles({ lignes, precedents, reglages })), [lignes, precedents, reglages, fige]);
  const bloquants = controles.filter((c) => c.niveau === "bloquant");
  const totaux = useMemo(() => C.totaux(lignes.map((l) => l.calcul)), [lignes]);

  // ---- Actions ------------------------------------------------------------

  const tache = async (fn) => {
    setOccupe(true);
    try {
      return await fn();
    } catch (e) {
      modal.alert({ title: t("appNom"), message: e.message, tone: "error" });
      return null;
    } finally {
      setOccupe(false);
    }
  };

  const ecrire = async (ligne, saisie) => {
    const calcul = C.calculer(ligne.salarie, saisie, reglages);
    const data = { mois: moisActif, matricule: ligne.salarie.data.matricule, saisie, calcul };
    if (ligne.record) await api.records.update(manifest.slug, "bulletins", ligne.record.id, data);
    else await api.records.create(manifest.slug, "bulletins", data);
  };

  /// Enregistre la saisie d'un salarié (une ligne des variables, ou le
  /// bulletin). Une valeur reprise d'une autre app et changée à la main
  /// est marquée comme telle : la reprise ne l'écrasera plus.
  const enregistrerLigne = (ligne, patch) =>
    fige
      ? null
      : tache(async () => {
          const saisie = { ...ligne.saisie, ...patch };
          if (patch.absences) saisie.absencesManuelles = true;
          if ("frais" in patch) saisie.fraisManuels = true;
          await ecrire(ligne, saisie);
          await etat.rafraichir();
        });

  const preparerTout = () =>
    tache(async () => {
      for (const l of lignes) await ecrire(l, l.saisie);
      await etat.rafraichir();
    });

  const majCycle = async (patch) => {
    const data = { mois: moisActif, ...(cycle?.data || {}), ...patch };
    if (cycle) await api.records.update(manifest.slug, "cycles", cycle.id, data);
    else await api.records.create(manifest.slug, "cycles", data);
  };

  const auteur = session.user?.name || session.user?.email || "";

  const valider = async () => {
    if (bloquants.length) return;
    const attention = controles.filter((c) => c.niveau === "attention" && c.code !== "nonEnregistre").length;
    const ok = await modal.confirm({
      title: t("validerTitre", { mois: nomDuMois(moisActif, langue) }),
      message: t("validerMessage", { n: lignes.length, net: m(totaux.net) }) + (attention ? ` ${t("validerAttention", { n: attention })}` : ""),
      detail: t("validerDetail"),
      confirmLabel: t("valider"),
    });
    if (!ok) return;
    const fait = await tache(async () => {
      // On réenregistre chaque bulletin avec le calcul du moment : ce sont
      // ces montants qui seront payés et déclarés.
      for (const l of lignes) await ecrire(l, l.saisie);
      await majCycle({ etat: "valide", valideLe: aujourdhui(), validePar: auteur });
      await etat.rafraichir();
      return true;
    });
    if (fait) {
      notifier({
        titre: t("validee", { mois: nomDuMois(moisActif, langue) }),
        message: t("valideeMsg", { n: lignes.length }),
        app: t("appNom"),
        ton: "success",
      });
      setSection("paiement");
    }
  };

  const rouvrir = async () => {
    const ok = await modal.confirm({
      title: t("rouvrirTitre", { mois: nomDuMois(moisActif, langue) }),
      detail: t("rouvrirDetail"),
      confirmLabel: t("rouvrir"),
      danger: true,
    });
    if (!ok) return;
    await tache(async () => {
      await majCycle({ etat: "preparation", valideLe: "", validePar: "" });
      await etat.rafraichir();
    });
  };

  const marquerPaye = async () => {
    const ok = await modal.confirm({
      title: t("marquerPayeTitre", { mois: nomDuMois(moisActif, langue) }),
      detail: t("marquerPayeDetail"),
      confirmLabel: t("marquerPaye"),
    });
    if (!ok) return;
    await tache(async () => {
      // Les notes de frais payées avec le salaire sont soldées dans
      // l'app Frais : la même note ne se rembourse pas deux fois.
      const ids = new Set(lignes.flatMap((l) => l.saisie.notesFrais || []));
      for (const note of notes) {
        if (ids.has(note.id) && note.data.etat === "approuvee") {
          await api.records.update("frais", "notes", note.id, { ...note.data, etat: "remboursee" }).catch(() => {});
        }
      }
      await majCycle({ etat: "paye", payeLe: aujourdhui() });
      await etat.rafraichir();
    });
  };

  const marquerDeclare = (type) =>
    tache(async () => {
      const declarations = { ...(cycle?.data?.declarations || {}), [type]: { le: aujourdhui(), par: auteur } };
      const tout = ["cnps", "its", "fdfp", "cmu"].every((k) => declarations[k]);
      await majCycle({ declarations, ...(tout && cycle?.data?.etat === "paye" ? { etat: "declare" } : {}) });
      await etat.rafraichir();
    });

  const majReglages = (data) =>
    tache(async () => {
      if (donnees.reglages) await api.records.update(manifest.slug, "reglages", donnees.reglages.id, data);
      else await api.records.create(manifest.slug, "reglages", data);
      await etat.rafraichir();
      return true;
    });

  const aller = (s, opts = null) => {
    setSection(s);
    setIntention(opts);
  };

  // Une autre application peut ouvrir la Paie sur un salarié.
  useEffect(() => {
    const suivre = (e) => {
      if (e.detail.app !== manifest.id) return;
      const { section: s, ...reste } = e.detail.params || {};
      if (s && VUES[s]) aller(s, reste);
    };
    window.addEventListener("companyos:lien", suivre);
    return () => window.removeEventListener("companyos:lien", suivre);
  }, []);

  const valeur = {
    t,
    langue,
    m,
    n,
    nomMois: (x, o) => nomDuMois(x, langue, o),
    date: (iso) => dateDe(iso, langue),
    entreprise: entreprise || {},
    salaries,
    bulletins,
    absences,
    notes,
    reglages,
    reglagesBruts: donnees.reglages?.data || null,
    cycles,
    mois: moisActif,
    setMois,
    cycle,
    fige,
    lignes,
    precedents,
    controles,
    bloquants,
    totaux,
    occupe,
    intention,
    peutAdministrer: ["OWNER", "ADMIN"].includes(session.user?.role),
    aller,
    tache,
    enregistrerLigne,
    preparerTout,
    valider,
    rouvrir,
    marquerPaye,
    marquerDeclare,
    majReglages,
    rafraichir: etat.rafraichir,
  };

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="paiApp">
        <div className="paiVerrou">{t("verrou")}</div>
      </ModuleWindow>
    );
  }

  const Vue = VUES[section] || Cycle;
  const optionsMois = [];
  for (let i = -1, x = C.moisSuivant(moisCourant); i < 12; i += 1) {
    x = C.moisPrecedent(x);
    optionsMois.push(x);
  }
  if (!optionsMois.includes(moisActif)) optionsMois.unshift(moisActif);

  return (
    <ModuleWindow manifest={manifest} className="paiApp">
      <Ctx.Provider value={valeur}>
        <div className="paiShell" lang={langue}>
          <aside className="paiNav cosScroll" aria-label={t("appNom")}>
            <div className="paiMarque">
              <b>{t("appNom")}</b>
              <span>{entreprise?.nom || ""}{entreprise?.pays ? ` · ${entreprise.pays}` : ""}</span>
            </div>
            <label className="paiChampNav">
              <span>{t("moisDePaie")}</span>
              <select value={moisActif} onChange={(e) => setMois(e.target.value)}>
                {optionsMois.map((x) => (
                  <option key={x} value={x}>{nomDuMois(x, langue)}</option>
                ))}
              </select>
            </label>
            <nav>
              {NAV.map((item) =>
                item.groupe ? (
                  <div key={item.groupe} className="paiNavGroupe">{t(item.groupe)}</div>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    className="paiNavItem"
                    aria-current={section === item.id ? "page" : undefined}
                    onClick={() => aller(item.id)}
                  >
                    <Icon fafa={item.icone} width={13} />
                    <span>{t(item.label)}</span>
                    {item.id === "cycle" && controles.filter((c) => c.niveau !== "info").length ? (
                      <em className="paiPastille">{controles.filter((c) => c.niveau !== "info").length}</em>
                    ) : null}
                  </button>
                ),
              )}
            </nav>
            <div className="paiLangue">
              <span>{t("langue")} : {t("langueAuto")}</span>
              <b>{LANGUES.find((l) => l.code === langue)?.nom || langue}</b>
            </div>
          </aside>
          <main className="paiPage cosScroll">
            <Contenu etat={etat} vide={false} lignes={8}>
              <Vue key={`${section}-${moisActif}`} />
            </Contenu>
          </main>
        </div>
      </Ctx.Provider>
    </ModuleWindow>
  );
}
