// Analyse — l'atelier du chiffre.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE CETTE APPLICATION APPORTE
//
// Chaque module de CompanyOS répond à sa propre question. La caisse dit ce
// qui s'est vendu aujourd'hui, le stock ce qu'il reste, la paie ce qu'on
// doit. Aucun ne répond aux questions qui traversent l'entreprise :
//
//   — quels produits font 80 % de mon chiffre, et lesquels dorment ?
//   — quels clients suis-je en train de perdre, sans le voir ?
//   — combien vais-je encaisser le mois prochain ?
//   — ce jeudi à 400 000 F, c'était un bon jour ou une erreur de saisie ?
//   — qu'achète-t-on avec quoi, et que faut-il ranger côte à côte ?
//
// L'application lit **n'importe quelle** collection de l'OS — y compris
// celles des applications créées au Studio, qui n'existaient pas quand ce
// code a été écrit — en profile les colonnes, et laisse construire dessus
// une analyse. Les règles sont dans domaine.js, éprouvables seules ; les
// graphiques dans graphes.jsx, en SVG sans dépendance.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { saveAs } from "../../cloud";
import { notifier } from "../../notifications";
import { Contenu, useChargement } from "../../chargement";
import { Bouton, Champ, Notice, Vide } from "../../ui";
import { useDevise, useLangue, useTraduction } from "../../../utils/intl";
import * as D from "./domaine";
import {
  Barres,
  Cadre,
  Cohortes,
  Nuage,
  Pareto,
  SerieTemporelle,
  TableauValeurs,
  Tuile,
  court,
} from "./graphes";
import "./analyse.scss";

export const manifest = {
  id: "analyse",
  slug: "analyse",
  name: "Analyse",
  icon: "analyse",
  // Sans cette action, l'icône du bureau et la tuile du menu Démarrer
  // n'ouvrent rien : toutes deux dispatchent `app.action`, et le réducteur
  // retrouve la fenêtre en cherchant celle dont l'action correspond.
  action: "ANALYSEAPP",
  Window: AnalyseApp,
};

const TEXTES = {
  fr: {
    verrou: "Connectez-vous pour analyser vos données.",
    navApercu: "Tableau de bord",
    navExplorer: "Explorer",
    navAnalyses: "Analyses",
    navStats: "Statistiques",
    navDonnees: "Données",
    source: "Source",
    periode: "Période",
    granularite: "Pas de temps",
    champDate: "Daté par",
    tout: "Tout l'historique",
    j30: "30 derniers jours",
    j90: "90 derniers jours",
    a1: "12 derniers mois",
    jour: "Jour",
    semaine: "Semaine",
    mois: "Mois",
    trimestre: "Trimestre",
    annee: "Année",
    mesure: "Mesure",
    dimension: "Dimension",
    agregat: "Calcul",
    aucuneMesure: "Nombre d'enregistrements",
    voirTableau: "Voir en tableau",
    chargerSource: "Choisissez une source de données pour commencer.",
    vide: "Cette source ne contient encore aucun enregistrement.",
    videAide:
      "Utilisez l'application concernée pour saisir vos premières données — l'analyse suivra automatiquement.",
    aucune: "Pas assez de données pour ce graphique.",
    insuffisant: "Il faut au moins trois points pour tracer cette courbe.",
    // Tableau de bord
    total: "Total",
    moyenne: "Moyenne par période",
    enregistrements: "Enregistrements",
    derniere: "Dernière période",
    evolution: "Évolution",
    evolutionAide: "Observé, lissé, et projeté",
    prevu: "Prévision",
    repartition: "Répartition",
    lecture: "Ce que disent les chiffres",
    lectureAide: "Constats calculés, pas rédigés à l'avance",
    // Constats
    "c.variation.hausse": "En hausse de {pct} % sur {periode}.",
    "c.variation.baisse": "En baisse de {pct} % sur {periode}.",
    "c.tendance.hausse": "Tendance de fond à la hausse (fiabilité {r2} %).",
    "c.tendance.baisse": "Tendance de fond à la baisse (fiabilité {r2} %).",
    "c.anomalie.haut": "{periode} sort du lot vers le haut ({valeur} contre {mediane} d'ordinaire).",
    "c.anomalie.bas": "{periode} décroche ({valeur} contre {mediane} d'ordinaire).",
    "c.irregulier": "Activité irrégulière : les périodes varient de {cv} % autour de la moyenne.",
    "c.record": "Meilleure période : {periode}, {fois}× la moyenne.",
    autresAnomalies: "et {n} autre(s) période(s) atypique(s)",
    // Explorer
    filtres: "Filtres",
    ajouterFiltre: "Ajouter un filtre",
    valeur: "Valeur",
    limite: "Garder les",
    premiers: "premiers",
    autres: "Autres",
    croiser: "Croiser deux dimensions",
    enLignes: "En lignes",
    enColonnes: "En colonnes",
    aucunCroisement: "Choisissez deux dimensions à croiser.",
    // Analyses
    paretoTitre: "Pareto — où se concentre l'essentiel",
    paretoAide:
      "Barres : la part de chacun. Courbe : le cumul. La ligne à 80 % sépare la classe A du reste.",
    paretoResume: "{n} {dimension} sur {total} font 80 % du total.",
    classe: "Classe",
    part: "Part",
    cumul: "Cumul",
    rfmTitre: "Clients — récence, fréquence, montant",
    rfmAide:
      "Chaque client est noté de 1 à 5 sur les trois axes ; le triplet donne son segment.",
    rfmManque: "Indiquez le champ qui identifie le client, puis le montant et la date.",
    client: "Client",
    segment: "Segment",
    "seg.champions": "Champions",
    "seg.fideles": "Fidèles",
    "seg.nouveaux": "Nouveaux",
    "seg.prometteurs": "Prometteurs",
    "seg.aSuivre": "À suivre",
    "seg.aReveiller": "À réveiller",
    "seg.aRisque": "À risque",
    "seg.perdus": "Perdus",
    recence: "Récence",
    frequence: "Fréquence",
    jours: "j",
    cohortesTitre: "Cohortes — qui revient, et quand",
    cohortesAide:
      "Chaque ligne est un mois d'acquisition ; les colonnes disent la part de ces clients revenus les mois suivants (en %).",
    cohorte: "Cohorte",
    taille: "Taille",
    mois0: "Mois 0",
    revenus: "revenus",
    affinitesTitre: "Affinités — ce qui s'achète ensemble",
    affinitesAide:
      "Un lift supérieur à 1 signale une vraie association : la paire revient plus souvent que le hasard ne l'expliquerait.",
    affinitesManque:
      "Cette source n'a pas de lignes de détail : l'analyse des paniers a besoin des articles d'un même ticket.",
    paire: "Paire",
    support: "Support",
    confiance: "Confiance",
    lift: "Lift",
    anomaliesTitre: "Périodes atypiques",
    anomaliesAide:
      "Écart mesuré à la médiane plutôt qu'à la moyenne : une valeur énorme ne peut pas se rendre elle-même normale.",
    aucuneAnomalie: "Aucune période ne sort de l'ordinaire.",
    ecart: "Écart",
    // Statistiques
    profil: "Profil des colonnes",
    profilAide: "Type déduit, remplissage et cardinalité de chaque champ.",
    colonne: "Colonne",
    type: "Type",
    remplissage: "Rempli",
    distinctes: "Valeurs distinctes",
    etendue: "Étendue",
    resume: "Résumé statistique",
    mediane: "Médiane",
    ecartType: "Écart-type",
    dispersion: "Dispersion",
    dispersionAide: "Écart-type rapporté à la moyenne",
    correlationTitre: "Relation entre deux mesures",
    correlationAide: "Nuage de points et droite des moindres carrés.",
    coefficient: "Coefficient",
    fiabilite: "Fiabilité",
    "f.tres forte": "très forte",
    "f.forte": "forte",
    "f.moderee": "modérée",
    "f.faible": "faible",
    "f.nulle": "nulle",
    "f.insuffisant": "données insuffisantes",
    correlationNote:
      "Une corrélation n'est pas une cause : deux courbes peuvent monter ensemble sans que l'une explique l'autre.",
    // Données
    lignesBrutes: "Enregistrements",
    exporter: "Exporter en CSV",
    exportOk: "Export enregistré",
    exportEchec: "Export impossible",
    nbLignes: "{n} ligne(s)",
    afficheesPremieres: "200 premières lignes affichées — l'export contient tout.",
  },
  en: {
    verrou: "Sign in to analyse your data.",
    navApercu: "Dashboard",
    navExplorer: "Explore",
    navAnalyses: "Analyses",
    navStats: "Statistics",
    navDonnees: "Data",
    source: "Source",
    periode: "Period",
    granularite: "Time step",
    champDate: "Dated by",
    tout: "All history",
    j30: "Last 30 days",
    j90: "Last 90 days",
    a1: "Last 12 months",
    jour: "Day",
    semaine: "Week",
    mois: "Month",
    trimestre: "Quarter",
    annee: "Year",
    mesure: "Measure",
    dimension: "Dimension",
    agregat: "Calculation",
    aucuneMesure: "Record count",
    voirTableau: "Table view",
    chargerSource: "Pick a data source to get started.",
    vide: "This source has no records yet.",
    videAide:
      "Use the matching application to enter your first data — the analysis will follow automatically.",
    aucune: "Not enough data for this chart.",
    insuffisant: "At least three points are needed to draw this curve.",
    total: "Total",
    moyenne: "Average per period",
    enregistrements: "Records",
    derniere: "Last period",
    evolution: "Trend over time",
    evolutionAide: "Observed, smoothed and projected",
    prevu: "Forecast",
    repartition: "Breakdown",
    lecture: "What the numbers say",
    lectureAide: "Computed findings, not canned text",
    "c.variation.hausse": "Up {pct}% over {periode}.",
    "c.variation.baisse": "Down {pct}% over {periode}.",
    "c.tendance.hausse": "Underlying upward trend (reliability {r2}%).",
    "c.tendance.baisse": "Underlying downward trend (reliability {r2}%).",
    "c.anomalie.haut": "{periode} stands out on the high side ({valeur} versus {mediane} usually).",
    "c.anomalie.bas": "{periode} drops off ({valeur} versus {mediane} usually).",
    "c.irregulier": "Irregular activity: periods vary by {cv}% around the average.",
    "c.record": "Best period: {periode}, {fois}× the average.",
    autresAnomalies: "and {n} other unusual period(s)",
    filtres: "Filters",
    ajouterFiltre: "Add a filter",
    valeur: "Value",
    limite: "Keep the top",
    premiers: "",
    autres: "Other",
    croiser: "Cross two dimensions",
    enLignes: "As rows",
    enColonnes: "As columns",
    aucunCroisement: "Pick two dimensions to cross.",
    paretoTitre: "Pareto — where the bulk sits",
    paretoAide:
      "Bars: each one's share. Curve: the running total. The 80% line separates class A from the rest.",
    paretoResume: "{n} of {total} {dimension} make up 80% of the total.",
    classe: "Class",
    part: "Share",
    cumul: "Cumulative",
    rfmTitre: "Customers — recency, frequency, monetary",
    rfmAide: "Each customer scores 1 to 5 on all three axes; the triplet gives their segment.",
    rfmManque: "Pick the field identifying the customer, then the amount and the date.",
    client: "Customer",
    segment: "Segment",
    "seg.champions": "Champions",
    "seg.fideles": "Loyal",
    "seg.nouveaux": "New",
    "seg.prometteurs": "Promising",
    "seg.aSuivre": "To watch",
    "seg.aReveiller": "To re-engage",
    "seg.aRisque": "At risk",
    "seg.perdus": "Lost",
    recence: "Recency",
    frequence: "Frequency",
    jours: "d",
    cohortesTitre: "Cohorts — who comes back, and when",
    cohortesAide:
      "Each row is an acquisition month; columns show the share of those customers who returned in later months (%).",
    cohorte: "Cohort",
    taille: "Size",
    mois0: "Month 0",
    revenus: "returned",
    affinitesTitre: "Affinities — what sells together",
    affinitesAide:
      "A lift above 1 signals a real association: the pair shows up more often than chance would explain.",
    affinitesManque:
      "This source has no line items: basket analysis needs the items of a single receipt.",
    paire: "Pair",
    support: "Support",
    confiance: "Confidence",
    lift: "Lift",
    anomaliesTitre: "Unusual periods",
    anomaliesAide:
      "Deviation measured against the median rather than the mean: a huge value cannot make itself look normal.",
    aucuneAnomalie: "No period stands out.",
    ecart: "Deviation",
    profil: "Column profile",
    profilAide: "Inferred type, fill rate and cardinality of every field.",
    colonne: "Column",
    type: "Type",
    remplissage: "Filled",
    distinctes: "Distinct values",
    etendue: "Range",
    resume: "Statistical summary",
    mediane: "Median",
    ecartType: "Std. deviation",
    dispersion: "Dispersion",
    dispersionAide: "Standard deviation relative to the mean",
    correlationTitre: "Relationship between two measures",
    correlationAide: "Scatter plot and least-squares line.",
    coefficient: "Coefficient",
    fiabilite: "Reliability",
    "f.tres forte": "very strong",
    "f.forte": "strong",
    "f.moderee": "moderate",
    "f.faible": "weak",
    "f.nulle": "none",
    "f.insuffisant": "not enough data",
    correlationNote:
      "Correlation is not causation: two curves can rise together without one explaining the other.",
    lignesBrutes: "Records",
    exporter: "Export as CSV",
    exportOk: "Export saved",
    exportEchec: "Export failed",
    nbLignes: "{n} row(s)",
    afficheesPremieres: "Showing the first 200 rows — the export contains everything.",
  },
};

/// Le libellé d'un type de champ, d'un agrégat ou d'une granularité.
/// Les identifiants viennent du domaine (donc du français) ; la traduction
/// se fait par clé, avec repli sur l'identifiant lui-même.
const parCle = (t, prefixe, id) => {
  const cle = `${prefixe}${id}`;
  const traduit = t(cle);
  return traduit === cle ? id : traduit;
};

const ilYa = (jours) => {
  const d = new Date();
  d.setDate(d.getDate() - jours);
  return d.toISOString().slice(0, 10);
};

const SECTIONS = [
  { id: "apercu", cle: "navApercu", icone: "faGaugeHigh" },
  { id: "explorer", cle: "navExplorer", icone: "faMagnifyingGlassChart" },
  { id: "analyses", cle: "navAnalyses", icone: "faChartPie" },
  { id: "stats", cle: "navStats", icone: "faSquareRootVariable" },
  { id: "donnees", cle: "navDonnees", icone: "faTable" },
];

function AnalyseApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const t = useTraduction(TEXTES);
  const langue = useLangue();
  const { montant } = useDevise();

  const [section, setSection] = useState("apercu");
  const [sourceId, setSourceId] = useState("caisse.tickets");
  const [brut, setBrut] = useState([]);

  // Réglages d'analyse
  const [champDate, setChampDate] = useState("");
  const [fenetre, setFenetre] = useState("tout");
  const [granularite, setGranularite] = useState("mois");
  const [mesure, setMesure] = useState("");
  const [agregat, setAgregat] = useState("somme");
  const [dimension, setDimension] = useState("");
  const [filtres, setFiltres] = useState([]);
  const [limite, setLimite] = useState(8);
  const [croisLigne, setCroisLigne] = useState("");
  const [croisColonne, setCroisColonne] = useState("");
  const [champClient, setChampClient] = useState("");
  const [mesureX, setMesureX] = useState("");
  const [mesureY, setMesureY] = useState("");

  const source = D.sourceParId(sourceId);

  const charger = useCallback(async () => {
    if (!source) return;
    const records = await api.records.list(source.module, source.collection);
    setBrut(records);

    // À l'ouverture d'une source, l'application se règle toute seule sur
    // ce qu'elle vient de lire : sans cela, l'écran s'ouvre vide et il faut
    // deviner quels champs choisir avant de voir quoi que ce soit.
    const table = D.enTable(records, source);
    const profils = D.profiler(table);
    const dates = D.datesPossibles(profils);
    const mesures = D.mesuresPossibles(profils);
    const dims = D.dimensionsPossibles(profils).filter((p) => p.type !== "date");

    const dateChoisie =
      dates.find((p) => p.champ === source.date)?.champ || dates[0]?.champ || "";
    const mesureChoisie =
      mesures.find((p) => p.champ === source.montant)?.champ ||
      mesures.find((p) => p.champ === "total.ttc")?.champ ||
      mesures[0]?.champ ||
      "";

    setChampDate(dateChoisie);
    setMesure(mesureChoisie);
    setDimension(dims[0]?.champ || "");
    setCroisLigne(dims[0]?.champ || "");
    setCroisColonne(dims[1]?.champ || "");
    setChampClient(
      dims.find((p) => /client|nom|tiers|fournisseur/i.test(p.champ))?.champ ||
        dims[0]?.champ ||
        "",
    );
    setMesureX(mesures[0]?.champ || "");
    setMesureY(mesures[1]?.champ || mesures[0]?.champ || "");
    setFiltres([]);
  }, [source]);

  const etat = useChargement(ouvert && !!source, charger);

  // ---- Pipeline d'analyse -------------------------------------------------

  const table = useMemo(() => D.enTable(brut, source), [brut, source]);
  const profils = useMemo(() => D.profiler(table), [table]);
  const mesures = useMemo(() => D.mesuresPossibles(profils), [profils]);
  const dimensions = useMemo(
    () => D.dimensionsPossibles(profils).filter((p) => p.type !== "date"),
    [profils],
  );
  const champsDate = useMemo(() => D.datesPossibles(profils), [profils]);

  /// La tranche analysée : période puis filtres. Tous les écrans lisent
  /// cette même tranche — une seule rangée de filtres pour tout le module,
  /// pas un réglage par graphique.
  const lignes = useMemo(() => {
    const du =
      fenetre === "j30" ? ilYa(30) : fenetre === "j90" ? ilYa(90) : fenetre === "a1" ? ilYa(365) : "";
    return D.filtrer(D.dansPeriode(table, champDate, du, ""), filtres);
  }, [table, champDate, fenetre, filtres]);

  const serie = useMemo(
    () =>
      champDate
        ? D.requete(lignes, {
            dimension: champDate,
            estDate: true,
            granularite,
            mesure,
            agregat,
          })
        : [],
    [lignes, champDate, granularite, mesure, agregat],
  );

  const serieEnrichie = useMemo(() => {
    if (serie.length < 3) return serie;
    const f = granularite === "jour" ? 7 : 3;
    return D.moyenneMobile(serie, f);
  }, [serie, granularite]);

  const prevision = useMemo(
    () => (serie.length >= 4 ? D.prevoir(serie, 3) : { points: [], fiable: false }),
    [serie],
  );
  const clesPrevision = useMemo(
    () =>
      serie.length
        ? D.datesSuivantes(serie[serie.length - 1].cle, granularite, prevision.points.length)
        : [],
    [serie, granularite, prevision.points.length],
  );

  const parDimension = useMemo(
    () =>
      dimension
        ? D.requete(lignes, { dimension, mesure, agregat, limite })
        : [],
    [lignes, dimension, mesure, agregat, limite],
  );

  const stats = useMemo(
    () => D.decrire(mesure ? lignes.map((l) => l[mesure]) : []),
    [lignes, mesure],
  );

  const format = useCallback(
    (v) => {
      // Une somme d'argent se lit dans la devise du poste ; un nombre
      // d'unités ou un décompte n'est pas de l'argent et ne doit pas
      // porter de symbole.
      const estArgent =
        agregat !== "compte" &&
        agregat !== "compte distinct" &&
        /montant|total|ttc|ht|prix|net|brut|salaire|valeur|ca\b/i.test(mesure || "");
      return estArgent ? montant(v) : court(v);
    },
    [agregat, mesure, montant],
  );

  const nomDim = (cle) => (cle === "__autres__" ? t("autres") : cle);

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="anaApp">
        <div className="anaVerrou">{t("verrou")}</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="anaApp">
      <div className="anaShell">
        <nav className="anaNav">
          {SECTIONS.map((s) => (
            <div
              key={s.id}
              className="anaOnglet handcr"
              data-actif={section === s.id}
              onClick={() => setSection(s.id)}
            >
              <Icon fafa={s.icone} width={13} />
              <span>{t(s.cle)}</span>
            </div>
          ))}
        </nav>

        <div className="anaCentre cosScroll">
          {/* Une seule rangée de filtres, au-dessus de tout ce qu'elle
              cadre : chaque écran se recalcule sur la même tranche. */}
          <div className="anaFiltres">
            <Champ label={t("source")}>
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                {D.SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom[langue] || s.nom.fr}
                  </option>
                ))}
              </select>
            </Champ>
            {champsDate.length ? (
              <>
                <Champ label={t("champDate")}>
                  <select value={champDate} onChange={(e) => setChampDate(e.target.value)}>
                    {champsDate.map((p) => (
                      <option key={p.champ} value={p.champ}>{p.champ}</option>
                    ))}
                  </select>
                </Champ>
                <Champ label={t("periode")}>
                  <select value={fenetre} onChange={(e) => setFenetre(e.target.value)}>
                    <option value="tout">{t("tout")}</option>
                    <option value="j30">{t("j30")}</option>
                    <option value="j90">{t("j90")}</option>
                    <option value="a1">{t("a1")}</option>
                  </select>
                </Champ>
                <Champ label={t("granularite")}>
                  <select value={granularite} onChange={(e) => setGranularite(e.target.value)}>
                    {D.GRANULARITES.map((g) => (
                      <option key={g} value={g}>{parCle(t, "", g)}</option>
                    ))}
                  </select>
                </Champ>
              </>
            ) : null}
            <Champ label={t("mesure")}>
              <select value={mesure} onChange={(e) => setMesure(e.target.value)}>
                <option value="">{t("aucuneMesure")}</option>
                {mesures.map((p) => (
                  <option key={p.champ} value={p.champ}>{p.champ}</option>
                ))}
              </select>
            </Champ>
            <Champ label={t("agregat")}>
              <select value={agregat} onChange={(e) => setAgregat(e.target.value)}>
                {D.AGREGATS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </Champ>
          </div>

          <Contenu etat={etat} vide={false} lignes={5}>
            {!table.length ? (
              <Vide icone="faChartLine" titre={t("vide")} aide={t("videAide")} />
            ) : section === "apercu" ? (
              <Apercu
                t={t}
                serie={serieEnrichie}
                prevision={prevision}
                clesPrevision={clesPrevision}
                parDimension={parDimension}
                dimension={dimension}
                stats={stats}
                format={format}
                nomDim={nomDim}
                granularite={granularite}
              />
            ) : section === "explorer" ? (
              <Explorer
                t={t}
                lignes={lignes}
                profils={profils}
                dimensions={dimensions}
                dimension={dimension}
                setDimension={setDimension}
                filtres={filtres}
                setFiltres={setFiltres}
                limite={limite}
                setLimite={setLimite}
                parDimension={parDimension}
                format={format}
                nomDim={nomDim}
                croisLigne={croisLigne}
                setCroisLigne={setCroisLigne}
                croisColonne={croisColonne}
                setCroisColonne={setCroisColonne}
                mesure={mesure}
                agregat={agregat}
              />
            ) : section === "analyses" ? (
              <Analyses
                t={t}
                lignes={lignes}
                serie={serie}
                parDimension={D.requete(lignes, { dimension, mesure, agregat })}
                dimension={dimension}
                dimensions={dimensions}
                champClient={champClient}
                setChampClient={setChampClient}
                champDate={champDate}
                mesure={mesure}
                source={source}
                brut={brut}
                format={format}
                nomDim={nomDim}
              />
            ) : section === "stats" ? (
              <Statistiques
                t={t}
                lignes={lignes}
                profils={profils}
                mesures={mesures}
                stats={stats}
                mesure={mesure}
                mesureX={mesureX}
                setMesureX={setMesureX}
                mesureY={mesureY}
                setMesureY={setMesureY}
                format={format}
              />
            ) : (
              <Donnees t={t} lignes={lignes} profils={profils} source={source} />
            )}
          </Contenu>
        </div>
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------

const Apercu = ({ t, serie, prevision, clesPrevision, parDimension, dimension, stats, format, nomDim, granularite }) => {
  const avecVar = D.variations(serie);
  const derniere = avecVar[avecVar.length - 1];
  const lectures = D.constats(serie, { granularite });

  const texteConstat = (c) => {
    const v = c.valeurs;
    switch (c.cle) {
      case "variation":
        return t(v.pct >= 0 ? "c.variation.hausse" : "c.variation.baisse", {
          pct: Math.abs(v.pct).toFixed(1),
          periode: v.periode,
        });
      case "tendance":
        return t(v.hausse ? "c.tendance.hausse" : "c.tendance.baisse", {
          r2: Math.round(v.r2 * 100),
        });
      case "anomalie": {
        const base = t(v.haut ? "c.anomalie.haut" : "c.anomalie.bas", {
          periode: v.periode,
          valeur: format(v.valeur),
          mediane: format(v.mediane),
        });
        return v.combien > 1 ? `${base} ${t("autresAnomalies", { n: v.combien - 1 })}.` : base;
      }
      case "irregulier":
        return t("c.irregulier", { cv: Math.round(v.cv) });
      case "record":
        return t("c.record", { periode: v.periode, fois: v.fois.toFixed(1) });
      default:
        return "";
    }
  };

  return (
    <div className="anaGrille">
      <div className="anaTuiles">
        <Tuile libelle={t("total")} valeur={format(stats.somme)} />
        <Tuile libelle={t("moyenne")} valeur={format(serie.length ? stats.somme / serie.length : 0)} />
        <Tuile libelle={t("enregistrements")} valeur={String(stats.n || 0)} />
        <Tuile
          libelle={t("derniere")}
          valeur={derniere ? format(derniere.valeur) : "—"}
          variation={derniere?.variation ?? null}
          aide={derniere?.cle}
          ton={derniere?.variation >= 0 ? "ok" : derniere?.variation < 0 ? "attention" : "neutre"}
        />
      </div>

      <Cadre
        titre={t("evolution")}
        aide={t("evolutionAide")}
        libelleTableau={t("voirTableau")}
        tableau={
          <TableauValeurs
            colonnes={[
              { cle: "cle", nom: t("periode") },
              { cle: "valeur", nom: t("total"), num: true },
              { cle: "variation", nom: t("evolution"), num: true },
            ]}
            lignes={avecVar.map((p) => ({
              cle: p.cle,
              valeur: format(p.valeur),
              variation: p.variation === null ? "—" : `${p.variation.toFixed(1)} %`,
            }))}
          />
        }
      >
        <SerieTemporelle
          serie={serie}
          prevision={prevision.points}
          clesPrevision={clesPrevision}
          format={format}
          libelles={{ prevu: t("prevu"), insuffisant: t("insuffisant") }}
        />
      </Cadre>

      {lectures.length ? (
        <section className="anaLecture">
          <h4>{t("lecture")}</h4>
          <p className="anaAide">{t("lectureAide")}</p>
          <ul>
            {lectures.map((c) => (
              <li key={c.cle} data-ton={c.ton}>
                <Icon
                  fafa={
                    c.ton === "ok" ? "faArrowTrendUp"
                    : c.ton === "attention" ? "faTriangleExclamation"
                    : "faCircleInfo"
                  }
                  width={12}
                />
                <span>{texteConstat(c)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dimension && parDimension.length ? (
        <Cadre
          titre={`${t("repartition")} — ${dimension}`}
          libelleTableau={t("voirTableau")}
          tableau={
            <TableauValeurs
              colonnes={[
                { cle: "cle", nom: dimension },
                { cle: "valeur", nom: t("total"), num: true },
                { cle: "n", nom: t("enregistrements"), num: true },
              ]}
              lignes={parDimension.map((d) => ({
                cle: nomDim(d.cle),
                valeur: format(d.valeur),
                n: d.n,
              }))}
            />
          }
        >
          <Barres
            donnees={parDimension.map((d) => ({ ...d, nom: nomDim(d.cle) }))}
            format={format}
            libelles={{ aucune: t("aucune") }}
          />
        </Cadre>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Explorer — construire sa propre question
// ---------------------------------------------------------------------------

const Explorer = ({
  t, lignes, profils, dimensions, dimension, setDimension, filtres, setFiltres,
  limite, setLimite, parDimension, format, nomDim,
  croisLigne, setCroisLigne, croisColonne, setCroisColonne, mesure, agregat,
}) => {
  const croisement = useMemo(
    () =>
      croisLigne && croisColonne
        ? D.croiser(lignes, { ligne: croisLigne, colonne: croisColonne, mesure, agregat })
        : null,
    [lignes, croisLigne, croisColonne, mesure, agregat],
  );

  const majFiltre = (i, patch) =>
    setFiltres((f) => f.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="anaGrille">
      <section className="anaBloc">
        <h4>{t("filtres")}</h4>
        {filtres.map((f, i) => (
          <div key={i} className="anaFiltreLigne">
            <select value={f.champ} onChange={(e) => majFiltre(i, { champ: e.target.value })}>
              <option value="">—</option>
              {profils.map((p) => (
                <option key={p.champ} value={p.champ}>{p.champ}</option>
              ))}
            </select>
            <select value={f.op} onChange={(e) => majFiltre(i, { op: e.target.value })}>
              {D.OPERATEURS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <input
              value={f.valeur}
              placeholder={t("valeur")}
              disabled={f.op === "non vide"}
              onChange={(e) => majFiltre(i, { valeur: e.target.value })}
            />
            <span
              className="anaRetirer handcr"
              onClick={() => setFiltres((x) => x.filter((_, j) => j !== i))}
            >
              <Icon fafa="faXmark" width={11} />
            </span>
          </div>
        ))}
        <Bouton
          variante="secondaire"
          icone="faPlus"
          onClick={() => setFiltres((f) => [...f, { champ: "", op: "=", valeur: "" }])}
        >
          {t("ajouterFiltre")}
        </Bouton>
        <p className="anaAide">{t("nbLignes", { n: lignes.length })}</p>
      </section>

      <Cadre
        titre={t("repartition")}
        libelleTableau={t("voirTableau")}
        tableau={
          <TableauValeurs
            colonnes={[
              { cle: "cle", nom: dimension || "—" },
              { cle: "valeur", nom: t("total"), num: true },
              { cle: "n", nom: t("enregistrements"), num: true },
            ]}
            lignes={parDimension.map((d) => ({ cle: nomDim(d.cle), valeur: format(d.valeur), n: d.n }))}
          />
        }
      >
        <div className="anaReglages">
          <Champ label={t("dimension")}>
            <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
              <option value="">—</option>
              {dimensions.map((p) => (
                <option key={p.champ} value={p.champ}>
                  {p.champ} ({p.distinctes})
                </option>
              ))}
            </select>
          </Champ>
          <Champ label={t("limite")}>
            <select value={limite} onChange={(e) => setLimite(Number(e.target.value))}>
              {[5, 8, 12, 20, 0].map((n) => (
                <option key={n} value={n}>{n === 0 ? "∞" : n}</option>
              ))}
            </select>
          </Champ>
        </div>
        <Barres
          donnees={parDimension.map((d) => ({ ...d, nom: nomDim(d.cle) }))}
          format={format}
          libelles={{ aucune: t("aucune") }}
        />
      </Cadre>

      <section className="anaBloc">
        <h4>{t("croiser")}</h4>
        <div className="anaReglages">
          <Champ label={t("enLignes")}>
            <select value={croisLigne} onChange={(e) => setCroisLigne(e.target.value)}>
              <option value="">—</option>
              {dimensions.map((p) => (
                <option key={p.champ} value={p.champ}>{p.champ}</option>
              ))}
            </select>
          </Champ>
          <Champ label={t("enColonnes")}>
            <select value={croisColonne} onChange={(e) => setCroisColonne(e.target.value)}>
              <option value="">—</option>
              {dimensions.map((p) => (
                <option key={p.champ} value={p.champ}>{p.champ}</option>
              ))}
            </select>
          </Champ>
        </div>
        {croisement ? (
          <div className="vzTableauEnveloppe">
            <table className="vzTableau">
              <thead>
                <tr>
                  <th>{croisLigne}</th>
                  {croisement.entetes.map((h) => (
                    <th key={h} data-num>{h}</th>
                  ))}
                  <th data-num>{t("total")}</th>
                </tr>
              </thead>
              <tbody>
                {croisement.corps.slice(0, 40).map((r) => (
                  <tr key={r.cle}>
                    <th scope="row">{r.cle}</th>
                    {r.cellules.map((c, i) => (
                      <td key={i} data-num>{c === null ? "—" : format(c)}</td>
                    ))}
                    <td data-num><b>{format(r.total)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="anaAide">{t("aucunCroisement")}</p>
        )}
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Analyses métier
// ---------------------------------------------------------------------------

const Analyses = ({
  t, lignes, serie, parDimension, dimension, dimensions,
  champClient, setChampClient, champDate, mesure, source, brut, format, nomDim,
}) => {
  const par = useMemo(() => D.pareto(parDimension), [parDimension]);
  const atypiques = useMemo(() => D.anomalies(serie), [serie]);

  const transactions = useMemo(
    () =>
      champClient && champDate
        ? lignes.map((l) => ({
            client: l[champClient],
            date: l[champDate],
            montant: mesure ? Number(l[mesure]) || 0 : 1,
          }))
        : [],
    [lignes, champClient, champDate, mesure],
  );

  const seg = useMemo(() => D.rfm(transactions), [transactions]);
  const coh = useMemo(() => D.cohortes(transactions), [transactions]);

  /// Les paniers viennent des lignes de détail du document — la seule
  /// façon de savoir ce qui a voyagé ensemble.
  const paniers = useMemo(() => {
    if (!source?.lignes) return [];
    return brut
      .map((r) => {
        const l = r.data?.[source.lignes];
        return Array.isArray(l)
          ? l.map((x) => x.designation || x.nom || x.articleId).filter(Boolean)
          : [];
      })
      .filter((p) => p.length > 1);
  }, [brut, source]);
  const aff = useMemo(() => D.affinites(paniers), [paniers]);

  return (
    <div className="anaGrille">
      <Cadre
        titre={t("paretoTitre")}
        aide={t("paretoAide")}
        libelleTableau={t("voirTableau")}
        tableau={
          <TableauValeurs
            colonnes={[
              { cle: "cle", nom: dimension || "—" },
              { cle: "valeur", nom: t("total"), num: true },
              { cle: "part", nom: t("part"), num: true },
              { cle: "cumul", nom: t("cumul"), num: true },
              { cle: "classe", nom: t("classe") },
            ]}
            lignes={par.lignes.map((l) => ({
              cle: nomDim(l.cle),
              valeur: format(l.valeur),
              part: `${l.part.toFixed(1)} %`,
              cumul: `${l.partCumulee.toFixed(1)} %`,
              classe: l.classe,
            }))}
          />
        }
      >
        {par.lignes.length > 1 ? (
          <>
            <Pareto lignes={par.lignes} libelles={{ aucune: t("aucune"), cumul: t("cumul") }} />
            <p className="anaResume">
              {t("paretoResume", {
                n: par.seuilA,
                total: par.lignes.length,
                dimension: dimension || "",
              })}
            </p>
          </>
        ) : (
          <div className="vzVide">{t("aucune")}</div>
        )}
      </Cadre>

      <section className="anaBloc">
        <h4>{t("anomaliesTitre")}</h4>
        <p className="anaAide">{t("anomaliesAide")}</p>
        {atypiques.length ? (
          <TableauValeurs
            colonnes={[
              { cle: "cle", nom: t("periode") },
              { cle: "valeur", nom: t("total"), num: true },
              { cle: "mediane", nom: t("mediane"), num: true },
              { cle: "score", nom: t("ecart"), num: true },
            ]}
            lignes={atypiques.map((a) => ({
              cle: a.cle,
              valeur: format(a.valeur),
              mediane: format(a.mediane),
              score: `${a.score > 0 ? "+" : ""}${a.score.toFixed(1)} σ`,
            }))}
          />
        ) : (
          <Notice ton="ok" icone="faCircleCheck">{t("aucuneAnomalie")}</Notice>
        )}
      </section>

      <section className="anaBloc">
        <h4>{t("rfmTitre")}</h4>
        <p className="anaAide">{t("rfmAide")}</p>
        <div className="anaReglages">
          <Champ label={t("client")}>
            <select value={champClient} onChange={(e) => setChampClient(e.target.value)}>
              <option value="">—</option>
              {dimensions.map((p) => (
                <option key={p.champ} value={p.champ}>{p.champ}</option>
              ))}
            </select>
          </Champ>
        </div>
        {seg.clients.length ? (
          <>
            <Barres
              donnees={seg.segments.map((s, i) => ({
                cle: s.segment,
                nom: `${t(`seg.${s.segment}`)} (${s.n})`,
                valeur: s.montant,
                // La couleur suit le segment, pas son rang : filtrer ne
                // repeint pas ceux qui restent.
                couleur: `var(--vz-${(D.SEGMENTS_RFM.indexOf(s.segment) % 8) + 1})`,
              }))}
              format={format}
              libelles={{ aucune: t("aucune") }}
            />
            <TableauValeurs
              colonnes={[
                { cle: "client", nom: t("client") },
                { cle: "segment", nom: t("segment") },
                { cle: "recence", nom: t("recence"), num: true },
                { cle: "frequence", nom: t("frequence"), num: true },
                { cle: "montant", nom: t("total"), num: true },
              ]}
              lignes={seg.clients.slice(0, 25).map((c) => ({
                client: c.client,
                segment: t(`seg.${c.segment}`),
                recence: `${c.recence} ${t("jours")}`,
                frequence: c.frequence,
                montant: format(c.montant),
              }))}
            />
          </>
        ) : (
          <p className="anaAide">{t("rfmManque")}</p>
        )}
      </section>

      <section className="anaBloc">
        <h4>{t("cohortesTitre")}</h4>
        <p className="anaAide">{t("cohortesAide")}</p>
        <Cohortes
          donnees={coh.cohortes}
          libelles={{
            aucune: t("aucune"),
            cohorte: t("cohorte"),
            taille: t("taille"),
            mois0: t("mois0"),
            revenus: t("revenus"),
          }}
        />
      </section>

      <section className="anaBloc">
        <h4>{t("affinitesTitre")}</h4>
        <p className="anaAide">{t("affinitesAide")}</p>
        {aff.length ? (
          <TableauValeurs
            colonnes={[
              { cle: "paire", nom: t("paire") },
              { cle: "n", nom: t("enregistrements"), num: true },
              { cle: "support", nom: t("support"), num: true },
              { cle: "confiance", nom: t("confiance"), num: true },
              { cle: "lift", nom: t("lift"), num: true },
            ]}
            lignes={aff.slice(0, 20).map((a) => ({
              paire: `${a.a} + ${a.b}`,
              n: a.n,
              support: `${a.support.toFixed(1)} %`,
              confiance: `${a.confiance.toFixed(0)} %`,
              lift: a.lift.toFixed(2),
            }))}
          />
        ) : (
          <p className="anaAide">{t("affinitesManque")}</p>
        )}
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

const Statistiques = ({
  t, lignes, profils, mesures, stats, mesure, mesureX, setMesureX, mesureY, setMesureY, format,
}) => {
  const points = useMemo(
    () =>
      mesureX && mesureY
        ? lignes
            .map((l) => ({ x: Number(l[mesureX]), y: Number(l[mesureY]) }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
            .slice(0, 400)
        : [],
    [lignes, mesureX, mesureY],
  );
  const corr = useMemo(
    () => D.correlation(points.map((p) => p.x), points.map((p) => p.y)),
    [points],
  );
  const reg = useMemo(
    () => D.regression(points.map((p) => p.x), points.map((p) => p.y)),
    [points],
  );

  return (
    <div className="anaGrille">
      <section className="anaBloc">
        <h4>{t("resume")} {mesure ? `— ${mesure}` : ""}</h4>
        <div className="anaTuiles">
          <Tuile libelle={t("moyenne")} valeur={format(stats.moyenne)} />
          <Tuile libelle={t("mediane")} valeur={format(stats.mediane)} />
          <Tuile libelle={t("ecartType")} valeur={format(stats.ecartType)} />
          <Tuile
            libelle={t("dispersion")}
            valeur={`${Math.round(stats.cv * 100)} %`}
            aide={t("dispersionAide")}
          />
        </div>
        <TableauValeurs
          colonnes={[
            { cle: "nom", nom: t("colonne") },
            { cle: "val", nom: t("valeur"), num: true },
          ]}
          lignes={[
            { nom: "n", val: stats.n },
            { nom: t("total"), val: format(stats.somme) },
            { nom: "min", val: format(stats.min) },
            { nom: "Q1", val: format(stats.q1) },
            { nom: t("mediane"), val: format(stats.mediane) },
            { nom: "Q3", val: format(stats.q3) },
            { nom: "P90", val: format(stats.p90) },
            { nom: "max", val: format(stats.max) },
          ]}
        />
      </section>

      <Cadre
        titre={t("correlationTitre")}
        aide={t("correlationAide")}
        libelleTableau={t("voirTableau")}
        tableau={
          <TableauValeurs
            colonnes={[
              { cle: "x", nom: mesureX, num: true },
              { cle: "y", nom: mesureY, num: true },
            ]}
            lignes={points.slice(0, 100).map((p) => ({ x: court(p.x), y: court(p.y) }))}
          />
        }
      >
        <div className="anaReglages">
          <Champ label="X">
            <select value={mesureX} onChange={(e) => setMesureX(e.target.value)}>
              {mesures.map((p) => (
                <option key={p.champ} value={p.champ}>{p.champ}</option>
              ))}
            </select>
          </Champ>
          <Champ label="Y">
            <select value={mesureY} onChange={(e) => setMesureY(e.target.value)}>
              {mesures.map((p) => (
                <option key={p.champ} value={p.champ}>{p.champ}</option>
              ))}
            </select>
          </Champ>
        </div>
        <Nuage
          points={points}
          reg={reg}
          libelles={{ insuffisant: t("insuffisant") }}
        />
        <p className="anaResume">
          {t("coefficient")} r = {corr.r.toFixed(3)} ({parCle(t, "f.", corr.force)}) · r² ={" "}
          {reg.r2.toFixed(3)} · n = {corr.n}
        </p>
        <Notice ton="info" icone="faCircleInfo">{t("correlationNote")}</Notice>
      </Cadre>

      <section className="anaBloc">
        <h4>{t("profil")}</h4>
        <p className="anaAide">{t("profilAide")}</p>
        <TableauValeurs
          colonnes={[
            { cle: "champ", nom: t("colonne") },
            { cle: "type", nom: t("type") },
            { cle: "remplissage", nom: t("remplissage"), num: true },
            { cle: "distinctes", nom: t("distinctes"), num: true },
            { cle: "etendue", nom: t("etendue") },
          ]}
          lignes={profils.map((p) => ({
            champ: p.champ,
            type: p.type,
            remplissage: `${Math.round(p.remplissage * 100)} %`,
            distinctes: p.distinctes,
            etendue:
              p.min === null ? "—"
              : p.type === "nombre" ? `${court(p.min)} → ${court(p.max)}`
              : `${p.min} → ${p.max}`,
          }))}
        />
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Données brutes
// ---------------------------------------------------------------------------

const Donnees = ({ t, lignes, profils, source }) => {
  const [occupe, setOccupe] = useState(false);
  const colonnes = profils.slice(0, 12).map((p) => p.champ);

  const exporter = async () => {
    setOccupe(true);
    try {
      const csv = D.versCSV(lignes, [...new Set(profils.map((p) => p.champ))]);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const nom = `analyse-${source?.id || "donnees"}-${new Date().toISOString().slice(0, 10)}.csv`;
      const noeud = await saveAs(blob, nom, { folder: "Analyses" });
      if (noeud) notifier({ titre: t("exportOk"), message: noeud.name, app: manifest.name, ton: "success" });
    } catch (e) {
      modal.alert({ title: t("exportEchec"), message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="anaGrille">
      <section className="anaBloc">
        <div className="anaEntete">
          <h4>{t("lignesBrutes")} — {t("nbLignes", { n: lignes.length })}</h4>
          <Bouton icone="faFileCsv" off={occupe} onClick={exporter}>
            {t("exporter")}
          </Bouton>
        </div>
        {lignes.length > 200 ? <p className="anaAide">{t("afficheesPremieres")}</p> : null}
        <TableauValeurs
          colonnes={colonnes.map((c) => ({ cle: c, nom: c }))}
          lignes={lignes.slice(0, 200).map((l) => {
            const o = {};
            for (const c of colonnes) o[c] = l[c] === null || l[c] === undefined ? "—" : String(l[c]);
            return o;
          })}
        />
      </section>
    </div>
  );
};
