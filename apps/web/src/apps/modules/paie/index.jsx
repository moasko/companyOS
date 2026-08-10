// Paie.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE CETTE APPLICATION COMPLÈTE
//
// Les RH tenaient les salariés, leur salaire de base, leur numéro CNPS —
// mais aucun bulletin. Or la paie est mensuelle, obligatoire, et
// lourdement réglementée en Côte d'Ivoire. C'est aussi la troisième sortie
// de trésorerie d'une PME, après les achats : la Caisse et la Facturation
// couvrent les ventes, les Achats couvrent les fournisseurs, la Paie
// couvre les salaires.
//
// Elle ne ressaisit rien : les salariés viennent des RH, et chaque bulletin
// propose son écriture à la Comptabilité — comme les tickets de caisse et
// les factures d'achat. Les barèmes (CNPS, ITS, CMU) et leurs calculs sont
// dans domaine.js, éprouvés seuls, et modifiables : un taux change par
// décret, pas par mise à jour du logiciel.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { saveAs } from "../../cloud";
import { Contenu, useChargement } from "../../chargement";
import { Bouton, Champ, Notice } from "../../ui";
import * as D from "./domaine";
import "./paie.scss";

export const manifest = {
  id: "paie",
  slug: "paie",
  name: "Paie",
  icon: "paie",
  action: "PAIEAPP",
  Window: PaieApp,
};

const money = D.fcfa;

function PaieApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";

  const [salaries, setSalaries] = useState([]);
  const [bulletins, setBulletins] = useState([]);
  const [reglages, setReglages] = useState(null);
  const [mois, setMois] = useState(D.moisParDefaut());
  const [selection, setSelection] = useState(null); // matricule ouvert
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    const [s, b, r] = await Promise.all([
      api.records.list("rh", "salaries").catch(() => []),
      api.records.list(manifest.slug, "bulletins"),
      api.records.list(manifest.slug, "reglages").catch(() => []),
    ]);
    setSalaries(s.filter((x) => x.data.statut !== "sorti"));
    setBulletins(b);
    setReglages(r[0]?.data || null);
  }, []);
  const etat = useChargement(ouvert, charger);

  const parametres = reglages || D.REGLAGES_DEFAUT;

  // Les bulletins du mois affiché, indexés par matricule.
  const duMois = useMemo(() => {
    const m = new Map();
    for (const b of bulletins) {
      if (b.data.mois === mois) m.set(b.data.matricule, b);
    }
    return m;
  }, [bulletins, mois]);

  // Le récapitulatif du mois se calcule sur les bulletins réels.
  const recap = useMemo(
    () => D.recapitulatif([...duMois.values()].map((b) => b.data.calcul)),
    [duMois],
  );

  const salarieOuvert = salaries.find((s) => s.data.matricule === selection) || null;
  const bulletinOuvert = selection ? duMois.get(selection) : null;

  // ---- Génération ---------------------------------------------------------

  /// Prépare un bulletin pour un salarié, ou reprend l'existant. La saisie
  /// variable (primes, retenues) part de zéro ; la situation familiale part
  /// du dernier bulletin connu — elle change rarement d'un mois à l'autre.
  const brouillonPour = (salarie) => {
    const existant = duMois.get(salarie.data.matricule);
    if (existant) return existant.data.saisie;
    // Dernier bulletin de ce salarié, pour reprendre situation et enfants.
    const dernier = bulletins
      .filter((b) => b.data.matricule === salarie.data.matricule)
      .sort((a, b) => String(b.data.mois).localeCompare(String(a.data.mois)))[0];
    return {
      primes: 0,
      indemnites: 0,
      retenues: 0,
      personnesCmu: 1,
      situation: dernier?.data.saisie?.situation || salarie.data.situation || "celibataire",
      enfants: dernier?.data.saisie?.enfants ?? salarie.data.enfants ?? 0,
    };
  };

  const enregistrerBulletin = async (salarie, saisie) => {
    const infos = {
      salaireBase: Number(salarie.data.salaireBase) || 0,
      situation: saisie.situation,
      enfants: saisie.enfants,
      prenom: salarie.data.prenom,
      nom: salarie.data.nom,
      matricule: salarie.data.matricule,
    };
    const calcul = D.bulletin(infos, saisie, parametres);
    const donnees = { mois, matricule: salarie.data.matricule, saisie, calcul };

    const existant = duMois.get(salarie.data.matricule);
    setOccupe(true);
    try {
      if (existant) {
        await api.records.update(manifest.slug, "bulletins", existant.id, donnees);
      } else {
        await api.records.create(manifest.slug, "bulletins", donnees);
      }
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const genererTout = async () => {
    const manquants = salaries.filter((s) => !duMois.get(s.data.matricule));
    if (!manquants.length) return;
    const ok = await modal.confirm({
      title: `Générer ${manquants.length} bulletin(s) ?`,
      message: `Un bulletin sera créé pour chaque salarié sans bulletin en ${mois}.`,
      detail:
        "Les montants partent du salaire de base ; vous pourrez ajouter primes et retenues fiche par fiche.",
      confirmLabel: "Générer les bulletins",
    });
    if (!ok) return;
    setOccupe(true);
    try {
      for (const s of manquants) {
        const saisie = brouillonPour(s);
        const infos = {
          salaireBase: Number(s.data.salaireBase) || 0,
          situation: saisie.situation,
          enfants: saisie.enfants,
          prenom: s.data.prenom,
          nom: s.data.nom,
          matricule: s.data.matricule,
        };
        await api.records.create(manifest.slug, "bulletins", {
          mois,
          matricule: s.data.matricule,
          saisie,
          calcul: D.bulletin(infos, saisie, parametres),
        });
      }
      await etat.rafraichir();
      notifier({
        titre: "Bulletins générés",
        message: `${manquants.length} bulletin(s) pour ${mois}.`,
        app: "Paie",
        ton: "success",
      });
    } catch (e) {
      modal.alert({ title: "Génération interrompue", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const supprimerBulletin = async (bulletin) => {
    const ok = await modal.confirm({
      title: "Supprimer ce bulletin ?",
      message: `Le bulletin de ${mois} sera retiré.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.records.remove(manifest.slug, "bulletins", bulletin.id);
    await etat.rafraichir();
  };

  /// Journal de paie du mois, exporté dans le cloud pour le comptable.
  const exporter = async () => {
    const lignes = [
      ["Matricule", "Nom", "Brut", "Cotisations", "ITS", "Net", "Charges patronales", "Coût total"],
    ];
    for (const b of duMois.values()) {
      const s = salaries.find((x) => x.data.matricule === b.data.matricule);
      const c = b.data.calcul;
      lignes.push([
        b.data.matricule,
        s ? `${s.data.prenom} ${s.data.nom}` : b.data.matricule,
        c.brut,
        c.cotisationsSalariales,
        c.its,
        c.net,
        c.chargesPatronales,
        c.coutTotal,
      ]);
    }
    const csv =
      "﻿" +
      lignes.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const node = await saveAs(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `journal-paie-${mois}.csv`,
      { folder: "Paie" },
    );
    if (node) {
      modal.alert({ title: "Journal exporté", message: `« ${node.name} » est dans votre cloud.`, tone: "success" });
    }
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="paieApp">
        <div className="paieVerrou">Connectez-vous pour établir la paie.</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="paieApp">
      <div className="paieShell">
        <aside className="paieListe">
          <div className="paieMois">
            <Icon fafa="faCalendarDays" width={13} />
            <input type="month" value={mois} onChange={(e) => setMois(e.target.value)} />
          </div>

          <div className="paieCartes">
            <div className="paieCarte">
              <span>Effectif payé</span>
              <b>
                {duMois.size} / {salaries.length}
              </b>
            </div>
            <div className="paieCarte">
              <span>Masse nette</span>
              <b>{money(recap.net)}</b>
            </div>
            <div className="paieCarte">
              <span>Coût total</span>
              <b>{money(recap.coutTotal)}</b>
            </div>
          </div>

          <div className="paieActions">
            <Bouton icone="faWandMagicSparkles" off={occupe} onClick={genererTout}>
              Générer les manquants
            </Bouton>
            <Bouton
              variante="secondaire"
              icone="faFileCsv"
              off={!duMois.size}
              onClick={exporter}
            >
              Journal
            </Bouton>
          </div>

          <div className="paieSalaries cosScroll">
            <Contenu
              etat={etat}
              vide={!salaries.length}
              lignes={6}
              rendreVide={() => (
                <div className="paieVide">
                  Aucun salarié. Les fiches viennent de l'application Ressources
                  humaines.
                </div>
              )}
            >
              {salaries.map((s) => {
                const b = duMois.get(s.data.matricule);
                return (
                  <div
                    key={s.id}
                    className="paieSalarie handcr"
                    data-actif={selection === s.data.matricule}
                    onClick={() => setSelection(s.data.matricule)}
                  >
                    <div className="paieSalarieNom">
                      {s.data.prenom} {s.data.nom}
                    </div>
                    <div className="paieSalarieBas">
                      <span>{s.data.poste || s.data.matricule}</span>
                      {b ? (
                        <span className="paieNet">{money(b.data.calcul.net)}</span>
                      ) : (
                        <span className="paieAFaire">à établir</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </Contenu>
          </div>
        </aside>

        <div className="paieCentre cosScroll">
          {salarieOuvert ? (
            <Bulletin
              salarie={salarieOuvert}
              mois={mois}
              saisieInitiale={brouillonPour(salarieOuvert)}
              existant={bulletinOuvert}
              reglages={parametres}
              occupe={occupe}
              onEnregistrer={(saisie) => enregistrerBulletin(salarieOuvert, saisie)}
              onSupprimer={() => bulletinOuvert && supprimerBulletin(bulletinOuvert)}
            />
          ) : (
            <div className="paieAccueil">
              <Icon className="paieAccueilIcone" src="paie" width={52} />
              <div className="paieAccueilTitre">Paie du mois</div>
              <p>
                Choisissez un salarié pour établir son bulletin, ou générez
                d'un coup ceux qui manquent. Les barèmes CNPS et ITS sont
                appliqués automatiquement — et modifiables dans les réglages.
              </p>
            </div>
          )}
        </div>
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Bulletin
// ---------------------------------------------------------------------------

const Bulletin = ({
  salarie,
  mois,
  saisieInitiale,
  existant,
  reglages,
  occupe,
  onEnregistrer,
  onSupprimer,
}) => {
  const [saisie, setSaisie] = useState(saisieInitiale);

  // Rechargé quand on change de salarié : sans clé, l'état resterait celui
  // du précédent.
  React.useEffect(() => setSaisie(saisieInitiale), [salarie.id, existant?.id]);

  const maj = (patch) => setSaisie((s) => ({ ...s, ...patch }));

  const infos = {
    salaireBase: Number(salarie.data.salaireBase) || 0,
    situation: saisie.situation,
    enfants: saisie.enfants,
  };
  const b = D.bulletin(infos, saisie, reglages);

  return (
    <div className="paieBulletin">
      <div className="paieBulletinTete">
        <div>
          <h3>
            {salarie.data.prenom} {salarie.data.nom}
          </h3>
          <p className="paieAide">
            {salarie.data.poste || "—"} · matricule {salarie.data.matricule} ·
            CNPS {salarie.data.numeroCnps || "non renseigné"} · {mois}
          </p>
        </div>
        <div className="paieBulletinFin">
          {existant ? (
            <span className="paieDejaEtabli">
              <Icon fafa="faCircleCheck" width={12} /> Établi
            </span>
          ) : null}
        </div>
      </div>

      {/* Éléments variables du mois */}
      <div className="paieBloc">
        <h4>Éléments du mois</h4>
        <div className="paieChamps">
          <Champ label="Situation familiale">
            <select value={saisie.situation} onChange={(e) => maj({ situation: e.target.value })}>
              {D.SITUATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Champ>
          <Champ label="Enfants à charge">
            <input
              type="number"
              min="0"
              value={saisie.enfants}
              onChange={(e) => maj({ enfants: Number(e.target.value) })}
            />
          </Champ>
          <Champ label="Primes imposables" aide="Rendement, ancienneté…">
            <input
              type="number"
              value={saisie.primes}
              onChange={(e) => maj({ primes: Number(e.target.value) })}
            />
          </Champ>
          <Champ label="Indemnités non imposables" aide="Transport…">
            <input
              type="number"
              value={saisie.indemnites}
              onChange={(e) => maj({ indemnites: Number(e.target.value) })}
            />
          </Champ>
          <Champ label="Retenues" aide="Avances, prêts">
            <input
              type="number"
              value={saisie.retenues}
              onChange={(e) => maj({ retenues: Number(e.target.value) })}
            />
          </Champ>
        </div>
      </div>

      {/* Le bulletin calculé */}
      <div className="paieBloc">
        <h4>Bulletin de paie</h4>
        <table className="paieTable">
          <tbody>
            <Ligne libelle="Salaire de base" valeur={b.base} />
            {b.primes ? <Ligne libelle="Primes" valeur={b.primes} /> : null}
            <Ligne libelle="Salaire brut" valeur={b.brut} fort />
            <Ligne libelle="Cotisation CNPS (6,3 %)" valeur={-b.cotisationsSalariales} />
            <Ligne
              libelle={`Impôt sur salaire (ITS, ${b.parts} part${b.parts > 1 ? "s" : ""})`}
              valeur={-b.its}
            />
            {b.cmuSalarie ? <Ligne libelle="CMU" valeur={-b.cmuSalarie} /> : null}
            {b.retenues ? <Ligne libelle="Retenues" valeur={-b.retenues} /> : null}
            {b.indemnites ? <Ligne libelle="Indemnités (non imposables)" valeur={b.indemnites} /> : null}
            <Ligne libelle="Net à payer" valeur={b.net} fort accent />
          </tbody>
        </table>
      </div>

      {/* Coût employeur — la part invisible sur la fiche du salarié */}
      <div className="paieBloc">
        <h4>Coût pour l'entreprise</h4>
        <table className="paieTable">
          <tbody>
            <Ligne libelle="Salaire brut + indemnités" valeur={b.brut + b.indemnites} />
            <Ligne
              libelle="Charges patronales (CNPS employeur, CMU)"
              valeur={b.chargesPatronales}
            />
            <Ligne libelle="Coût total" valeur={b.coutTotal} fort />
          </tbody>
        </table>
        <p className="paieAide">
          Le salarié touche {money(b.net)} ; l'entreprise dépense{" "}
          {money(b.coutTotal)}. L'écart, ce sont les cotisations et l'impôt
          reversés à la CNPS et à l'État.
        </p>
      </div>

      <div className="paieBoutons">
        <Bouton icone="faFloppyDisk" off={occupe} onClick={() => onEnregistrer(saisie)}>
          {existant ? "Mettre à jour le bulletin" : "Établir le bulletin"}
        </Bouton>
        {existant ? (
          <Bouton variante="secondaire" icone="faTrashCan" onClick={onSupprimer}>
            Supprimer
          </Bouton>
        ) : null}
      </div>
    </div>
  );
};

const Ligne = ({ libelle, valeur, fort, accent }) => (
  <tr data-fort={fort ? "true" : "false"} data-accent={accent ? "true" : "false"}>
    <td>{libelle}</td>
    <td className="paieMt" data-negatif={valeur < 0}>
      {valeur < 0 ? `− ${money(-valeur)}` : money(valeur)}
    </td>
  </tr>
);
