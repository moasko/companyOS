// Comptabilité.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI DISTINGUE CETTE APPLICATION
//
// Les logiciels de référence — Pennylane, Xero, Sage — sont excellents sur
// l'automatisation *bancaire* : ils se branchent au compte, catégorisent
// les mouvements, rapprochent. Cela suppose deux choses qu'une PME
// ivoirienne n'a pas forcément : un compte bancaire connecté à une API, et
// des ventes qui passent par la banque. Ici, une bonne part du chiffre se
// fait en espèces et en mobile money.
//
// Trois choix en découlent :
//
//   1. **Aucun numéro de compte à connaître.** L'utilisateur choisit une
//      phrase — « J'ai payé le loyer » — et saisit le montant qu'il a sous
//      les yeux, taxe comprise. La partie double est écrite pour lui, et
//      montrée avant validation : simple à l'usage, vérifiable au
//      contrôle.
//
//   2. **Les écritures viennent de la Facturation.** CompanyOS possède
//      déjà les factures et les règlements. Chaque pièce émise propose son
//      écriture, marquée de son origine pour ne jamais être comptée deux
//      fois. Un logiciel externe ne peut pas faire cela : il faudrait
//      d'abord lui ressaisir les factures.
//
//   3. **Le mobile money est un compte de trésorerie de plein droit**
//      (531), aux côtés de la caisse et de la banque — pas une case
//      « autre ».
//
// CE QUI EST REPRIS DE SAP S/4HANA FINANCE
//
// Quatre idées, transposées à l'échelle d'une PME :
//
//   - **le journal unique** (leur table ACDOCA) : une seule collection de
//     lignes, dont balance, résultat, bilan, TVA et analytique ne sont que
//     des agrégations. Rien n'est tenu en double, donc rien ne peut
//     diverger ;
//   - **les postes ouverts** : un compte de tiers ne se lit pas par son
//     solde mais poste par poste, ce qui donne enfin « qui doit quoi,
//     depuis quand, sur quelle facture » ;
//   - **la dimension analytique** portée par la ligne : un axe — boutique,
//     chantier, activité — et tous les états se recalculent dessus ;
//   - **la clôture de période** : le passé se verrouille, on n'antidate pas
//     dans un mois dont la TVA est déclarée.
//
// Ce qui n'est *pas* repris : périmètres analytiques multiples, devises
// parallèles, référentiels comptables simultanés. Une PME n'en a pas
// l'usage, et chacun coûterait sa complexité à l'écran.
//
// Le référentiel est le SYSCOHADA révisé (AUDCIF), en vigueur dans les 17
// pays de l'OHADA. Voir domaine.js, où vivent toutes les règles.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { saveAs } from "../../cloud";
import { Contenu, useChargement } from "../../chargement";
import { Auteur } from "../../Auteur";
import { Bouton, Champ, Notice, Vide } from "../../ui";
import { totaux } from "@companyos/shared/facturation";
import { ecritureDuTicket } from "../caisse/domaine";
import {
  ecritureDeFacture as ecritureAchat,
  ecriturePaiement as ecriturePaiementAchat,
} from "../achats/domaine";
import { ecritureDeBulletin } from "../paie/domaine";
import { ecritureDeNote } from "../frais/domaine";
import * as D from "./domaine";
import "./comptabilite.scss";

export const manifest = {
  id: "comptabilite",
  slug: "comptabilite",
  name: "Comptabilité",
  icon: "comptabilite",
  action: "COMPTABILITEAPP",
  Window: ComptabiliteApp,
};

const SECTIONS = [
  { id: "tableau", label: "Tableau de bord", icone: "faChartPie" },
  { id: "saisie", label: "Enregistrer", icone: "faPlus" },
  { id: "tiers", label: "Qui me doit quoi", icone: "faHandHoldingDollar" },
  { id: "journal", label: "Journal", icone: "faBook" },
  { id: "grandlivre", label: "Grand livre", icone: "faListUl" },
  { id: "balance", label: "Balance", icone: "faScaleBalanced" },
  { id: "resultat", label: "Compte de résultat", icone: "faArrowTrendUp" },
  { id: "bilan", label: "Bilan", icone: "faBuildingColumns" },
  { id: "tva", label: "TVA", icone: "faReceipt" },
  { id: "plan", label: "Plan comptable", icone: "faSitemap" },
  { id: "cloture", label: "Clôture", icone: "faLock" },
];

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const moisCourant = () => new Date().toISOString().slice(0, 7);

function ComptabiliteApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";

  const [section, setSection] = useState("tableau");
  const [ecritures, setEcritures] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [reglements, setReglements] = useState([]);
  const [ticketsCaisse, setTicketsCaisse] = useState([]);
  const [achats, setAchats] = useState({ factures: [], paiements: [], fournisseurs: [] });
  const [paie, setPaie] = useState({ bulletins: [], salaries: [] });
  const [notesFrais, setNotesFrais] = useState([]);

  // Période observée. L'exercice entier par défaut : une PME regarde son
  // année, et se restreint au mois quand elle déclare la TVA.
  const [periode, setPeriode] = useState(() =>
    D.exercice(new Date().getFullYear()),
  );

  const [compteOuvert, setCompteOuvert] = useState("411");
  // L'axe analytique observé. Vide = toute l'entreprise.
  const [axe, setAxe] = useState("");
  const [reglages, setReglages] = useState(null);
  const [brouillon, setBrouillon] = useState(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    const [e, f, r, g, tk, af, ap, four, bul, sal, ndf] = await Promise.all([
      api.records.list(manifest.slug, "ecritures"),
      // La Facturation peut ne pas être installée : la comptabilité reste
      // utilisable, simplement sans reprise automatique.
      api.records.list("facturation", "factures").catch(() => []),
      api.records.list("facturation", "reglements").catch(() => []),
      api.records.list(manifest.slug, "reglages").catch(() => []),
      // La Caisse aussi : chaque ticket propose son écriture.
      api.records.list("caisse", "tickets").catch(() => []),
      // Et les Achats : factures fournisseur et paiements.
      api.records.list("achats", "factures").catch(() => []),
      api.records.list("achats", "paiements").catch(() => []),
      api.records.list("stock", "fournisseurs").catch(() => []),
      // La Paie : chaque bulletin propose son écriture de salaire.
      api.records.list("paie", "bulletins").catch(() => []),
      api.records.list("rh", "salaries").catch(() => []),
      // Les Notes de frais : chaque note approuvée propose sa charge.
      api.records.list("frais", "notes").catch(() => []),
    ]);
    setEcritures(e);
    setDocuments(f);
    setReglements(r);
    setReglages(g[0] || null);
    setTicketsCaisse(tk);
    setAchats({ factures: af, paiements: ap, fournisseurs: four });
    setPaie({ bulletins: bul, salaries: sal });
    setNotesFrais(ndf);
  }, []);
  const etat = useChargement(ouvert, charger);

  // ---- Dérivations --------------------------------------------------------

  const suggerees = useMemo(() => {
    // Les Achats construisent leurs propositions avec leur propre domaine :
    // la Comptabilité ne connaît pas la forme d'une facture fournisseur.
    const nomF = (id) =>
      achats.fournisseurs.find((f) => f.id === id)?.data?.nom || "";
    const propositions = [
      ...achats.factures.map((f) =>
        ecritureAchat({ id: f.id, ...f.data }, nomF(f.data.fournisseurId)),
      ),
      ...achats.paiements.map((p) => {
        const fac = achats.factures.find((f) => f.id === p.data.factureId);
        return ecriturePaiementAchat(
          { id: p.id, ...p.data },
          fac,
          nomF(fac?.data?.fournisseurId),
        );
      }),
      // Une note de frais compte dès qu'elle est approuvée — la charge est
      // née, même si le remboursement attend.
      ...notesFrais
        .filter((n) => ["approuvee", "remboursee"].includes(n.data.etat))
        .map((n) => {
          const sal = paie.salaries.find((x) => x.id === n.data.salarieId);
          const nom = sal
            ? `${sal.data.prenom || ""} ${sal.data.nom || ""}`.trim()
            : "salarié";
          return ecritureDeNote(n.data, n.id, nom);
        }),
      ...paie.bulletins.map((bul) => {
        const sal = paie.salaries.find((x) => x.data.matricule === bul.data.matricule);
        return ecritureDeBulletin(bul.data.calcul, sal?.data || {}, bul.data.mois);
      }),
    ];
    return D.ecrituresSuggerees({
      documents,
      reglements,
      tickets: ticketsCaisse,
      ecritureTicket: ecritureDuTicket,
      propositions,
      ecritures,
      totauxDe: totaux,
    });
  }, [documents, reglements, ticketsCaisse, achats, paie, notesFrais, ecritures]);

  // Période et axe voyagent ensemble : c'est le contexte d'observation, et
  // toutes les restitutions le respectent sans le savoir (voir lignesDe).
  const contexte = useMemo(() => ({ ...periode, axe: axe || undefined }), [periode, axe]);
  const clotureAu = reglages?.data?.clotureAu || "";

  const controle = useMemo(() => D.controle(ecritures), [ecritures]);
  const resultat = useMemo(() => D.compteDeResultat(ecritures, contexte), [ecritures, contexte]);
  const leBilan = useMemo(() => D.bilan(ecritures, contexte), [ecritures, contexte]);
  const laBalance = useMemo(() => D.balance(ecritures, contexte), [ecritures, contexte]);
  const laTva = useMemo(() => D.tva(ecritures, contexte), [ecritures, contexte]);
  const laTreso = useMemo(() => D.tresorerie(ecritures, contexte), [ecritures, contexte]);
  const lesAxes = useMemo(() => D.axes(ecritures), [ecritures]);
  const clients = useMemo(
    () => D.balanceAgee(ecritures, "411", contexte),
    [ecritures, contexte],
  );
  const fournisseurs = useMemo(
    () => D.balanceAgee(ecritures, "401", contexte),
    [ecritures, contexte],
  );

  const journal = useMemo(
    () =>
      ecritures
        .filter((e) => {
          const d = e.data?.date;
          if (axe && e.data?.axe !== axe) return false;
          return (!periode.du || d >= periode.du) && (!periode.au || d <= periode.au);
        })
        .sort((a, b) => String(b.data?.date).localeCompare(String(a.data?.date))),
    [ecritures, periode, axe],
  );

  // ---- Écriture -----------------------------------------------------------

  const enregistrer = async (ecriture) => {
    const soucis = D.problemes(ecriture, { clotureAu });
    if (soucis.length) {
      return modal.alert({
        title: "Cette écriture ne peut pas être enregistrée",
        message: soucis.join("\n"),
        tone: "error",
      });
    }
    setOccupe(true);
    try {
      await api.records.create(manifest.slug, "ecritures", ecriture);
      await etat.rafraichir();
      setBrouillon(null);
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  /// Accepter une écriture proposée par la Facturation.
  const accepter = async (proposition) => {
    setOccupe(true);
    try {
      await api.records.create(manifest.slug, "ecritures", proposition);
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const toutAccepter = async () => {
    const ok = await modal.confirm({
      title: `Comptabiliser ${suggerees.length} opération(s) ?`,
      message: "Chaque pièce de la Facturation produira son écriture au journal.",
      detail:
        "Elles restent modifiables ensuite, et aucune pièce ne sera comptabilisée deux fois.",
      confirmLabel: "Tout comptabiliser",
    });
    if (!ok) return;
    setOccupe(true);
    try {
      for (const p of suggerees) {
        await api.records.create(manifest.slug, "ecritures", p);
      }
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Enregistrement interrompu", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  /// Une écriture enregistrée ne se modifie pas : elle se contre-passe.
  /// C'est la règle comptable, et c'est aussi ce qui rend le journal
  /// opposable — un livre qu'on peut réécrire ne prouve rien.
  const contrepasser = async (ecriture) => {
    const ok = await modal.confirm({
      title: "Annuler cette écriture ?",
      message: `« ${ecriture.data.libelle} »`,
      detail:
        "Une écriture inverse sera ajoutée à la date du jour. L'originale reste au journal : c'est ce qui rend la comptabilité vérifiable.",
      confirmLabel: "Contre-passer",
      danger: true,
    });
    if (!ok) return;
    await enregistrer({
      date: aujourdhui(),
      libelle: `Annulation — ${ecriture.data.libelle}`,
      contrepasse: ecriture.id,
      lignes: ecriture.data.lignes.map((l) => ({
        compte: l.compte,
        debit: l.credit,
        credit: l.debit,
      })),
    });
  };

  /// Verrouille tout ce qui précède une date.
  const cloturer = async (date) => {
    const ok = await modal.confirm({
      title: date ? `Clôturer jusqu'au ${date} ?` : "Rouvrir la période ?",
      message: date
        ? "Plus aucune écriture ne pourra être datée de cette période."
        : "Les écritures pourront de nouveau être datées dans le passé.",
      detail: date
        ? "Rien n'est effacé ni figé : les états restent consultables, et la clôture peut être reculée."
        : "À n'utiliser que pour corriger une clôture posée trop tôt.",
      confirmLabel: date ? "Clôturer" : "Rouvrir",
      danger: !date,
    });
    if (!ok) return;
    setOccupe(true);
    try {
      if (reglages) {
        await api.records.update(manifest.slug, "reglages", reglages.id, {
          ...reglages.data,
          clotureAu: date,
        });
      } else {
        await api.records.create(manifest.slug, "reglages", { clotureAu: date });
      }
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Clôture impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  /// Export pour l'expert-comptable. Un cabinet attend un fichier plat,
  /// une ligne par ligne d'écriture — c'est ce que tous les logiciels de
  /// production comptable savent lire.
  const exporter = async () => {
    const lignes = [
      ["Date", "Libellé", "Compte", "Intitulé", "Débit", "Crédit", "Tiers"],
    ];
    for (const e of journal) {
      for (const l of e.data.lignes || []) {
        lignes.push([
          e.data.date,
          e.data.libelle,
          l.compte,
          D.intitule(l.compte),
          l.debit || 0,
          l.credit || 0,
          e.data.tiers || "",
        ]);
      }
    }
    // BOM UTF-8 et point-virgule : c'est ce qu'attend Excel en français.
    const csv =
      "﻿" +
      lignes
        .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
        .join("\r\n");

    const node = await saveAs(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `journal-${periode.du}-${periode.au}.csv`,
      { folder: "Comptabilité" },
    );
    if (node) {
      modal.alert({
        title: "Journal exporté",
        message: `« ${node.name} » est dans votre cloud.`,
        tone: "success",
      });
    }
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="cptApp">
        <div className="cptVerrou">Connectez-vous pour tenir votre comptabilité.</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="cptApp">
      <div className="cptShell">
        <aside className="cptNav cosScroll">
          {SECTIONS.map((s) => (
            <div
              key={s.id}
              className="cptNavItem handcr"
              data-actif={section === s.id}
              onClick={() => setSection(s.id)}
            >
              <Icon fafa={s.icone} width={13} />
              <span>{s.label}</span>
              {s.id === "saisie" && suggerees.length ? (
                <em className="cptPastille">{suggerees.length}</em>
              ) : null}
            </div>
          ))}
        </aside>

        <div className="cptCentre cosScroll">
          <div className="cptEntete">
            <Periode valeur={periode} onChanger={setPeriode} />
            {lesAxes.length ? (
              <div className="cptPeriode">
                <Icon fafa="faLayerGroup" width={12} />
                <select value={axe} onChange={(e) => setAxe(e.target.value)}>
                  <option value="">Toute l'entreprise</option>
                  {lesAxes.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="cptEnteteFin">
              {/* La fenêtre charge à l'ouverture. Une facture émise pendant
                  qu'elle est ouverte n'apparaîtrait donc pas dans les
                  reprises — d'où ce bouton, qui va rechercher les pièces
                  sans qu'on ait à fermer et rouvrir. */}
              <Bouton
                variante="secondaire"
                icone="faArrowsRotate"
                off={occupe}
                onClick={() => etat.rafraichir()}
                title="Rechercher les nouvelles pièces de la Facturation"
              >
                Actualiser
              </Bouton>
              {!controle.equilibre ? (
                <span className="cptAlerte" title="Le total des débits doit égaler celui des crédits">
                  <Icon fafa="faTriangleExclamation" width={12} />
                  Journal déséquilibré de {D.fcfa(Math.abs(controle.ecart))}
                </span>
              ) : null}
              <Bouton variante="secondaire" icone="faFileCsv" onClick={exporter}>
                Export comptable
              </Bouton>
            </div>
          </div>

          <Contenu etat={etat} vide={false} lignes={8}>
            {section === "tableau" ? (
              <Tableau
                resultat={resultat}
                treso={laTreso}
                tva={laTva}
                bilan={leBilan}
                suggerees={suggerees}
                onVoirSaisie={() => setSection("saisie")}
              />
            ) : section === "saisie" ? (
              <Saisie
                suggerees={suggerees}
                occupe={occupe}
                brouillon={brouillon}
                setBrouillon={setBrouillon}
                onAccepter={accepter}
                onToutAccepter={toutAccepter}
                onEnregistrer={enregistrer}
              />
            ) : section === "tiers" ? (
              <Tiers clients={clients} fournisseurs={fournisseurs} />
            ) : section === "journal" ? (
              <Journal journal={journal} onContrepasser={contrepasser} />
            ) : section === "grandlivre" ? (
              <GrandLivre
                balance={laBalance}
                compte={compteOuvert}
                onChoisir={setCompteOuvert}
                lignes={D.grandLivre(ecritures, compteOuvert, periode)}
              />
            ) : section === "balance" ? (
              <Balance balance={laBalance} />
            ) : section === "resultat" ? (
              <Resultat resultat={resultat} />
            ) : section === "bilan" ? (
              <Bilan bilan={leBilan} />
            ) : section === "tva" ? (
              <Tva tva={laTva} periode={periode} onPeriode={setPeriode} />
            ) : section === "cloture" ? (
              <Cloture
                clotureAu={clotureAu}
                reglages={reglages}
                occupe={occupe}
                onCloturer={cloturer}
              />
            ) : (
              <Plan />
            )}
          </Contenu>
        </div>
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Période
// ---------------------------------------------------------------------------

const Periode = ({ valeur, onChanger }) => {
  const annee = new Date().getFullYear();
  return (
    <div className="cptPeriode">
      <Icon fafa="faCalendarDays" width={12} />
      <select
        value={`${valeur.du}|${valeur.au}`}
        onChange={(e) => {
          const [du, au] = e.target.value.split("|");
          onChanger({ du, au });
        }}
      >
        <option value={`${D.exercice(annee).du}|${D.exercice(annee).au}`}>
          Exercice {annee}
        </option>
        <option value={`${D.exercice(annee - 1).du}|${D.exercice(annee - 1).au}`}>
          Exercice {annee - 1}
        </option>
        {Array.from({ length: 12 }, (_, i) => {
          const m = `${annee}-${String(i + 1).padStart(2, "0")}`;
          const p = D.mois(m);
          return (
            <option key={m} value={`${p.du}|${p.au}`}>
              {new Date(annee, i, 1).toLocaleDateString("fr-FR", {
                month: "long",
                year: "numeric",
              })}
            </option>
          );
        })}
      </select>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------

const Tableau = ({ resultat, treso, tva, bilan, suggerees, onVoirSaisie }) => (
  <>
    {suggerees.length ? (
      <div className="cptRappel handcr" onClick={onVoirSaisie}>
        <Icon fafa="faWandMagicSparkles" width={16} />
        <div>
          <b>{suggerees.length} opération(s) prêtes à comptabiliser</b>
          <span>
            Vos factures et règlements attendent leur écriture. Un clic suffit.
          </span>
        </div>
        <Icon fafa="faChevronRight" width={12} />
      </div>
    ) : null}

    <div className="cptCartes">
      <Carte
        titre="Trésorerie"
        valeur={D.fcfa(treso.total)}
        ton={treso.total >= 0 ? "ok" : "danger"}
        detail={treso.comptes.map((c) => `${D.intitule(c.compte)} ${D.fcfa(c.montant)}`).join(" · ")}
      />
      <Carte
        titre="Résultat de la période"
        valeur={D.fcfa(resultat.resultat)}
        ton={resultat.resultat >= 0 ? "ok" : "danger"}
        detail={`${D.fcfa(resultat.totalProduits)} de produits — ${D.fcfa(resultat.totalCharges)} de charges`}
      />
      <Carte
        titre={tva.aPayer ? "TVA à reverser" : "Crédit de TVA"}
        valeur={D.fcfa(tva.aPayer || tva.credit)}
        ton={tva.aPayer ? "attention" : "ok"}
        detail={`Collectée ${D.fcfa(tva.collectee)} — déductible ${D.fcfa(tva.deductible)}`}
      />
      <Carte
        titre="Total du bilan"
        valeur={D.fcfa(bilan.totalActif)}
        ton={bilan.equilibre ? "ok" : "danger"}
        detail={bilan.equilibre ? "Actif et passif s'équilibrent" : "Bilan déséquilibré"}
      />
    </div>

    <div className="cptDeux">
      <div className="cptBloc">
        <h3>D'où vient l'argent</h3>
        {resultat.produits.length ? (
          <Barres lignes={resultat.produits} total={resultat.totalProduits} ton="ok" />
        ) : (
          <p className="cptRien">Aucun produit sur la période.</p>
        )}
      </div>
      <div className="cptBloc">
        <h3>Où il part</h3>
        {resultat.charges.length ? (
          <Barres lignes={resultat.charges} total={resultat.totalCharges} ton="danger" />
        ) : (
          <p className="cptRien">Aucune charge sur la période.</p>
        )}
      </div>
    </div>
  </>
);

const Carte = ({ titre, valeur, detail, ton }) => (
  <div className="cptCarte" data-ton={ton}>
    <div className="cptCarteTitre">{titre}</div>
    <div className="cptCarteValeur">{valeur}</div>
    {detail ? <div className="cptCarteDetail">{detail}</div> : null}
  </div>
);

/// Barres proportionnelles — un tableau de chiffres ne montre pas les
/// ordres de grandeur, et c'est justement ce qu'on cherche d'un coup d'œil.
const Barres = ({ lignes, total, ton }) => (
  <div className="cptBarres">
    {[...lignes]
      .sort((a, b) => b.montant - a.montant)
      .slice(0, 8)
      .map((l) => (
        <div key={l.compte} className="cptBarre">
          <span className="cptBarreNom" title={`${l.compte} — ${l.label}`}>
            {l.label}
          </span>
          <span className="cptBarrePiste">
            <span
              className="cptBarreRemplie"
              data-ton={ton}
              style={{ width: `${total ? (l.montant / total) * 100 : 0}%` }}
            />
          </span>
          <span className="cptBarreVal">{D.fcfa(l.montant)}</span>
        </div>
      ))}
  </div>
);

// ---------------------------------------------------------------------------
// Saisie
// ---------------------------------------------------------------------------

const Saisie = ({
  suggerees,
  occupe,
  brouillon,
  setBrouillon,
  onAccepter,
  onToutAccepter,
  onEnregistrer,
}) => {
  const familles = useMemo(() => {
    const m = new Map();
    for (const mod of D.MODELES) {
      if (!m.has(mod.famille)) m.set(mod.famille, []);
      m.get(mod.famille).push(mod);
    }
    return [...m.entries()];
  }, []);

  const modele = brouillon?.modele
    ? D.MODELES.find((m) => m.id === brouillon.modele)
    : null;

  const apercu = useMemo(() => {
    if (!modele || !brouillon?.montant) return null;
    return D.ecritureDepuisModele({
      modele,
      montant: brouillon.montant,
      date: brouillon.date,
      libelle: brouillon.libelle,
      taux: brouillon.taux,
      compteTresorerie: brouillon.compteTresorerie,
      tiers: brouillon.tiers,
    });
  }, [modele, brouillon]);

  return (
    <>
      {suggerees.length ? (
        <div className="cptBloc">
          <div className="cptBlocEntete">
            <h3>Reprises de la Facturation</h3>
            <Bouton icone="faCheckDouble" off={occupe} onClick={onToutAccepter}>
              Tout comptabiliser ({suggerees.length})
            </Bouton>
          </div>
          <p className="cptAide">
            Ces écritures découlent de pièces déjà émises dans CompanyOS. Elles ne
            seront jamais comptabilisées deux fois : chacune garde la trace de sa
            pièce d'origine.
          </p>
          <div className="cptSuggestions">
            {suggerees.slice(0, 25).map((s) => (
              <div key={s.origine} className="cptSuggestion">
                <div className="cptSugTete">
                  <span className="cptSugDate">{s.date}</span>
                  <span className="cptSugLib">{s.libelle}</span>
                  <Bouton
                    variante="secondaire"
                    icone="faCheck"
                    off={occupe}
                    onClick={() => onAccepter(s)}
                  >
                    Comptabiliser
                  </Bouton>
                </div>
                <LignesEcriture lignes={s.lignes} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="cptBloc">
        <h3>Enregistrer une opération</h3>
        <p className="cptAide">
          Choisissez ce que vous avez fait. Les comptes sont trouvés pour vous —
          vous verrez l'écriture avant de l'enregistrer.
        </p>

        <div className="cptModeles">
          {familles.map(([famille, liste]) => (
            <div key={famille} className="cptFamille">
              <div className="cptFamilleNom">{famille}</div>
              <div className="cptFamilleListe">
                {liste.map((m) => (
                  <div
                    key={m.id}
                    className="cptModele handcr"
                    data-actif={brouillon?.modele === m.id}
                    onClick={() =>
                      setBrouillon({
                        modele: m.id,
                        date: aujourdhui(),
                        montant: "",
                        libelle: "",
                        taux: 18,
                        compteTresorerie: m.tresorerie ? "571" : undefined,
                        tiers: "",
                      })
                    }
                  >
                    {m.phrase}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {modele ? (
          <div className="cptFormulaire">
            {modele.aide ? <Notice ton="info">{modele.aide}</Notice> : null}

            <div className="cptChamps">
              <Champ label="Montant reçu ou payé" aide="Tel qu'il est sur le reçu, taxe comprise">
                <input
                  type="number"
                  autoFocus
                  value={brouillon.montant}
                  onChange={(e) =>
                    setBrouillon((b) => ({ ...b, montant: e.target.value }))
                  }
                  placeholder="0"
                />
              </Champ>
              <Champ label="Date">
                <input
                  type="date"
                  value={brouillon.date}
                  onChange={(e) => setBrouillon((b) => ({ ...b, date: e.target.value }))}
                />
              </Champ>
              {modele.tva ? (
                <Champ label="TVA">
                  <select
                    value={brouillon.taux}
                    onChange={(e) =>
                      setBrouillon((b) => ({ ...b, taux: Number(e.target.value) }))
                    }
                  >
                    {D.TAUX_TVA.map((t) => (
                      <option key={t} value={t}>
                        {t ? `${t} %` : "Exonéré"}
                      </option>
                    ))}
                  </select>
                </Champ>
              ) : null}
              {modele.tresorerie ? (
                <Champ label="Payé par">
                  <select
                    value={brouillon.compteTresorerie}
                    onChange={(e) =>
                      setBrouillon((b) => ({ ...b, compteTresorerie: e.target.value }))
                    }
                  >
                    {D.TRESORERIE.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Champ>
              ) : null}
            </div>

            <Champ label="Précision" aide="Facultatif — ce qui vous aidera à vous en souvenir">
              <input
                value={brouillon.libelle}
                onChange={(e) => setBrouillon((b) => ({ ...b, libelle: e.target.value }))}
                placeholder={modele.phrase}
              />
            </Champ>

            {apercu ? (
              <div className="cptApercu">
                <div className="cptApercuTitre">
                  Voici l'écriture qui sera enregistrée
                </div>
                <LignesEcriture lignes={apercu.lignes} />
              </div>
            ) : null}

            <div className="cptActions">
              <Bouton
                icone="faCheck"
                off={occupe || !apercu}
                onClick={() => onEnregistrer(apercu)}
              >
                Enregistrer au journal
              </Bouton>
              <Bouton variante="secondaire" onClick={() => setBrouillon(null)}>
                Annuler
              </Bouton>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
};

/// Les lignes d'une écriture, toujours affichées de la même façon : c'est
/// ce qui permet à l'utilisateur d'apprendre la partie double sans qu'on
/// la lui impose.
const LignesEcriture = ({ lignes }) => (
  <table className="cptLignes">
    <tbody>
      {lignes.map((l, i) => (
        <tr key={i}>
          <td className="cptCode">{l.compte}</td>
          <td className="cptLib">{D.intitule(l.compte)}</td>
          <td className="cptMt">{l.debit ? D.fcfa(l.debit) : ""}</td>
          <td className="cptMt">{l.credit ? D.fcfa(l.credit) : ""}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

const Journal = ({ journal, onContrepasser }) =>
  journal.length ? (
    <div className="cptBloc">
      <h3>Journal — {journal.length} écriture(s)</h3>
      <p className="cptAide">
        Le journal ne se corrige pas : une écriture fausse s'annule par une
        écriture inverse. C'est ce qui le rend opposable.
      </p>
      {journal.map((e) => (
        <div key={e.id} className="cptEcriture">
          <div className="cptEcrTete">
            <span className="cptSugDate">{e.data.date}</span>
            <span className="cptSugLib">{e.data.libelle}</span>
            {e.data.origine ? (
              <span className="cptOrigine" title="Reprise automatique de la Facturation">
                <Icon fafa="faLink" width={9} /> Facturation
              </span>
            ) : null}
            <span
              className="cptContrepasser handcr"
              title="Annuler par une écriture inverse"
              onClick={() => onContrepasser(e)}
            >
              <Icon fafa="faRotateLeft" width={11} />
            </span>
          </div>
          <LignesEcriture lignes={e.data.lignes || []} />
          <Auteur record={e} />
        </div>
      ))}
    </div>
  ) : (
    <Vide
      icone="faBook"
      titre="Aucune écriture sur la période"
      aide="Enregistrez une opération, ou reprenez celles que la Facturation propose."
    />
  );

// ---------------------------------------------------------------------------
// Grand livre, balance, états
// ---------------------------------------------------------------------------

const GrandLivre = ({ balance, compte, onChoisir, lignes }) => (
  <div className="cptBloc">
    <div className="cptBlocEntete">
      <h3>Grand livre</h3>
      <select value={compte} onChange={(e) => onChoisir(e.target.value)}>
        {balance.length ? (
          balance.map((c) => (
            <option key={c.compte} value={c.compte}>
              {c.compte} — {c.label}
            </option>
          ))
        ) : (
          <option value="">Aucun compte mouvementé</option>
        )}
      </select>
    </div>
    {lignes.length ? (
      <table className="cptTable">
        <thead>
          <tr>
            <th>Date</th>
            <th>Libellé</th>
            <th className="cptMt">Débit</th>
            <th className="cptMt">Crédit</th>
            <th className="cptMt">Solde</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i}>
              <td>{l.date}</td>
              <td>{l.libelle}</td>
              <td className="cptMt">{l.debit ? D.fcfa(l.debit) : ""}</td>
              <td className="cptMt">{l.credit ? D.fcfa(l.credit) : ""}</td>
              <td className="cptMt cptSolde">{D.fcfa(l.solde)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p className="cptRien">Ce compte n'a pas bougé sur la période.</p>
    )}
  </div>
);

const Balance = ({ balance }) => {
  const t = balance.reduce(
    (s, c) => ({ debit: s.debit + c.debit, credit: s.credit + c.credit }),
    { debit: 0, credit: 0 },
  );
  return balance.length ? (
    <div className="cptBloc">
      <h3>Balance générale</h3>
      <table className="cptTable">
        <thead>
          <tr>
            <th>Compte</th>
            <th>Intitulé</th>
            <th className="cptMt">Débit</th>
            <th className="cptMt">Crédit</th>
            <th className="cptMt">Solde</th>
          </tr>
        </thead>
        <tbody>
          {balance.map((c) => (
            <tr key={c.compte}>
              <td className="cptCode">{c.compte}</td>
              <td>{c.label}</td>
              <td className="cptMt">{D.fcfa(c.debit)}</td>
              <td className="cptMt">{D.fcfa(c.credit)}</td>
              <td className="cptMt cptSolde">{D.fcfa(c.solde)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Totaux</td>
            <td className="cptMt">{D.fcfa(t.debit)}</td>
            <td className="cptMt">{D.fcfa(t.credit)}</td>
            <td className="cptMt">{D.fcfa(t.debit - t.credit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  ) : (
    <Vide icone="faScaleBalanced" titre="Rien à équilibrer pour l'instant" />
  );
};

const Resultat = ({ resultat }) => (
  <div className="cptBloc">
    <h3>Compte de résultat</h3>
    <div className="cptDeux">
      <Colonne titre="Charges" lignes={resultat.charges} total={resultat.totalCharges} />
      <Colonne titre="Produits" lignes={resultat.produits} total={resultat.totalProduits} />
    </div>
    <div className="cptResultat" data-ton={resultat.resultat >= 0 ? "ok" : "danger"}>
      <span>{resultat.resultat >= 0 ? "Bénéfice" : "Perte"}</span>
      <b>{D.fcfa(Math.abs(resultat.resultat))}</b>
    </div>
  </div>
);

const Bilan = ({ bilan }) => (
  <div className="cptBloc">
    <h3>Bilan</h3>
    <div className="cptDeux">
      <Colonne titre="Actif — ce que l'entreprise possède" lignes={bilan.actif} total={bilan.totalActif} />
      <Colonne
        titre="Passif — ce qu'elle doit"
        lignes={[
          ...bilan.passif,
          {
            compte: "131",
            label: bilan.resultat >= 0 ? "Résultat de l'exercice" : "Résultat de l'exercice (perte)",
            montant: bilan.resultat,
          },
        ]}
        total={bilan.totalPassif}
      />
    </div>
    {!bilan.equilibre ? (
      <Notice ton="erreur">
        L'actif et le passif ne s'équilibrent pas. Une écriture est fausse — le
        journal vous dira laquelle.
      </Notice>
    ) : null}
  </div>
);

const Colonne = ({ titre, lignes, total }) => (
  <div>
    <h4 className="cptColTitre">{titre}</h4>
    <table className="cptTable">
      <tbody>
        {lignes.length ? (
          lignes.map((l) => (
            <tr key={l.compte}>
              <td className="cptCode">{l.compte}</td>
              <td>{l.label}</td>
              <td className="cptMt">{D.fcfa(l.montant)}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={3} className="cptRien">
              Rien à cette rubrique.
            </td>
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2}>Total</td>
          <td className="cptMt">{D.fcfa(total)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
);

const Tva = ({ tva, periode, onPeriode }) => (
  <div className="cptBloc">
    <h3>TVA de la période</h3>
    <p className="cptAide">
      En Côte d'Ivoire, la déclaration mensuelle (CA02) se dépose avant le 15 du
      mois suivant. Choisissez le mois en haut de l'écran pour obtenir les
      montants à reporter.
    </p>
    <table className="cptTable">
      <tbody>
        <tr>
          <td className="cptCode">4431</td>
          <td>TVA facturée à vos clients</td>
          <td className="cptMt">{D.fcfa(tva.collectee)}</td>
        </tr>
        <tr>
          <td className="cptCode">4452</td>
          <td>TVA payée à vos fournisseurs, récupérable</td>
          <td className="cptMt">− {D.fcfa(tva.deductible)}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2}>{tva.aPayer ? "À reverser à l'État" : "Crédit de TVA reportable"}</td>
          <td className="cptMt">{D.fcfa(tva.aPayer || tva.credit)}</td>
        </tr>
      </tfoot>
    </table>
    {tva.credit ? (
      <Notice ton="info">
        Vous avez payé plus de TVA que vous n'en avez facturé. Ce crédit se
        reporte sur les mois suivants ; il n'est pas remboursé automatiquement.
      </Notice>
    ) : null}
  </div>
);

// ---------------------------------------------------------------------------
// Postes ouverts
// ---------------------------------------------------------------------------

/// « Qui me doit quoi » — la question que le solde d'un compte de tiers ne
/// répond jamais. Chaque poste garde sa facture d'origine et son âge.
const Tiers = ({ clients, fournisseurs }) => (
  <>
    <ColonneTiers
      titre="Ce que vos clients vous doivent"
      aide="Chaque ligne est une facture non soldée. Le rapprochement avec les règlements est automatique : ce qui reste ici n'a réellement pas été payé."
      vide="Aucune facture en attente de règlement."
      tiers={clients}
      sens={1}
    />
    <ColonneTiers
      titre="Ce que vous devez à vos fournisseurs"
      aide="Les factures d'achat que vous n'avez pas encore réglées."
      vide="Rien à payer à ce jour."
      tiers={fournisseurs}
      sens={-1}
    />
  </>
);

const ColonneTiers = ({ titre, aide, vide, tiers, sens }) => {
  const total = tiers.reduce((s, t) => s + t.total, 0);
  return (
    <div className="cptBloc">
      <h3>{titre}</h3>
      <p className="cptAide">{aide}</p>
      {tiers.length ? (
        <table className="cptTable">
          <thead>
            <tr>
              <th>Tiers</th>
              <th className="cptMt">À jour</th>
              <th className="cptMt">1 – 30 j</th>
              <th className="cptMt">31 – 60 j</th>
              <th className="cptMt">61 – 90 j</th>
              <th className="cptMt">+ de 90 j</th>
              <th className="cptMt">Total</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <React.Fragment key={t.tiers}>
                <tr className="cptTiersLigne">
                  <td>{t.tiers}</td>
                  <td className="cptMt">{t.aJour ? D.fcfa(t.aJour * sens) : ""}</td>
                  <td className="cptMt">{t.j30 ? D.fcfa(t.j30 * sens) : ""}</td>
                  <td className="cptMt">{t.j60 ? D.fcfa(t.j60 * sens) : ""}</td>
                  <td className="cptMt">{t.j90 ? D.fcfa(t.j90 * sens) : ""}</td>
                  {/* Au-delà de 90 jours, une créance change de nature : on
                      ne relance plus, on provisionne. D'où la mise en
                      évidence. */}
                  <td className="cptMt cptRetard">
                    {t.plus ? D.fcfa(t.plus * sens) : ""}
                  </td>
                  <td className="cptMt cptSolde">{D.fcfa(t.total * sens)}</td>
                </tr>
                {t.postes.map((p) => (
                  <tr key={p.piece + p.date} className="cptPoste">
                    <td colSpan={5}>
                      <span className="cptCode">{p.piece || "sans pièce"}</span>{" "}
                      {p.libelle}
                    </td>
                    <td className="cptMt">{p.age > 0 ? `${p.age} j` : "à jour"}</td>
                    <td className="cptMt">{D.fcfa(p.solde * sens)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>Total</td>
              <td className="cptMt">{D.fcfa(total * sens)}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className="cptRien">{vide}</p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Clôture
// ---------------------------------------------------------------------------

const Cloture = ({ clotureAu, occupe, onCloturer }) => {
  const [date, setDate] = useState(clotureAu || "");
  return (
    <div className="cptBloc">
      <h3>Clôture de période</h3>
      <p className="cptAide">
        Une fois la TVA d'un mois déclarée, plus rien ne doit pouvoir s'y
        ajouter : sinon vos livres cessent de correspondre à ce que vous avez
        déposé, et personne ne s'en aperçoit avant le contrôle. La clôture
        n'efface rien et ne fige aucun état — elle empêche seulement de dater
        une écriture dans le passé.
      </p>

      {clotureAu ? (
        <Notice ton="info" icone="faLock">
          Les écritures sont verrouillées jusqu'au {clotureAu} inclus.
        </Notice>
      ) : (
        <Notice ton="attention" icone="faLockOpen">
          Aucune période n'est close : une écriture peut être datée de
          n'importe quand.
        </Notice>
      )}

      <div className="cptChamps">
        <Champ label="Clôturer jusqu'au" aide="Inclus. Laissez vide pour tout rouvrir.">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Champ>
      </div>
      <div className="cptActions">
        <Bouton icone="faLock" off={occupe || date === clotureAu} onClick={() => onCloturer(date)}>
          {date ? "Clôturer la période" : "Rouvrir tout"}
        </Bouton>
      </div>
    </div>
  );
};

const Plan = () => {
  const [q, setQ] = useState("");
  const liste = D.PLAN.filter(
    (c) =>
      !q.trim() ||
      c.code.includes(q.trim()) ||
      c.label.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="cptBloc">
      <h3>Plan comptable SYSCOHADA révisé</h3>
      <p className="cptAide">
        Le référentiel des 17 pays de l'OHADA. Vous n'avez pas à le connaître :
        il est là pour vérifier, ou pour répondre à votre comptable.
      </p>
      <input
        className="cptRecherche"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Chercher un compte ou un mot…"
      />
      {Object.entries(D.CLASSES)
        .filter(([n]) => liste.some((c) => D.classeDe(c.code) === Number(n)))
        .map(([n, cl]) => (
          <div key={n} className="cptClasse">
            <div className="cptClasseNom">
              Classe {n} — {cl.label}
            </div>
            <table className="cptTable">
              <tbody>
                {liste
                  .filter((c) => D.classeDe(c.code) === Number(n))
                  .map((c) => (
                    <tr key={c.code}>
                      <td className="cptCode">{c.code}</td>
                      <td>{c.label}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
};
