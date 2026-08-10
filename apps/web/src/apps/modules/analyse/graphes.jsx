// Analyse — les graphiques, en SVG écrit à la main.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI PAS UNE BIBLIOTHÈQUE
//
// Recharts, Chart.js ou D3 pèsent de 90 à 300 Ko pour un OS qui s'ouvre
// déjà avec vingt applications, imposent leur propre thème, et rendent des
// marques épaisses qu'il faut ensuite dé-styler. Ces graphiques-ci font
// une page de SVG, suivent les jetons `--app-*` du thème clair comme
// sombre, et n'ajoutent aucune dépendance.
//
// LES RÈGLES SUIVIES (elles ne sont pas décoratives)
//
//   • Un seul axe des ordonnées. Jamais deux échelles sur un même dessin :
//     leur alignement est arbitraire et invente une corrélation. Le Pareto,
//     qui se dessine d'ordinaire à deux axes, exprime ici barres **et**
//     courbe cumulée en pourcentage du total : une seule échelle, 0 à 100.
//   • La couleur suit l'entité, jamais son rang : filtrer une série ne
//     repeint pas les survivantes.
//   • Palette catégorielle d'ordre fixe, éprouvée pour les huit formes de
//     daltonisme sur les deux surfaces de l'OS (validateur : écart minimal
//     ΔE 9,1 en clair, 8,4 en sombre). Au-delà de huit séries on ne génère
//     pas de teinte : le reste devient « Autres ».
//   • Marques fines, extrémités arrondies à 4 px, traits à 2 px, grille en
//     filet plein — jamais de pointillés, qui se lisent comme un seuil.
//   • Étiquettes directes choisies (l'extrémité, l'extrême), jamais un
//     nombre sur chaque point.
//   • Trois couleurs de la palette passent sous 3:1 sur fond clair : toute
//     valeur reste donc lisible autrement que par la teinte — étiquette
//     visible, infobulle, et vue tableau jumelle de chaque graphique.
// ─────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from "react";

/// L'ordre des teintes. Défini en CSS (`--vz-1`… `--vz-8`) pour que le
/// thème sombre substitue ses propres pas sans toucher au dessin.
export const SERIES = [1, 2, 3, 4, 5, 6, 7, 8];
export const couleurSerie = (i) => `var(--vz-${(i % 8) + 1})`;

const MARGE = { haut: 14, droite: 16, bas: 30, gauche: 52 };

/// Un axe de valeurs lisible : des paliers à 1, 2, 5 × 10ⁿ plutôt que le
/// maximum brut divisé en cinq, qui donne des graduations comme 8 437.
const paliers = (max, min = 0, combien = 4) => {
  if (!Number.isFinite(max) || max === min) return [0, 1];
  const etendue = max - min;
  const brut = etendue / combien;
  const magnitude = 10 ** Math.floor(Math.log10(brut));
  const norme = brut / magnitude;
  const pas = (norme >= 5 ? 10 : norme >= 2 ? 5 : norme >= 1 ? 2 : 1) * magnitude;
  const debut = Math.floor(min / pas) * pas;
  const fin = Math.ceil(max / pas) * pas;
  const out = [];
  for (let v = debut; v <= fin + pas / 2; v += pas) out.push(Number(v.toFixed(10)));
  return out;
};

/// Nombre court pour un axe : 1,2 M plutôt que 1 200 000, qui déborde.
export const court = (n) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1).replace(".0", "")} Md`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1).replace(".0", "")} M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(".0", "")} k`;
  return String(Math.round(v * 100) / 100);
};

// ---------------------------------------------------------------------------
// Le cadre commun : titre, légende, bascule vers la vue tableau
// ---------------------------------------------------------------------------

/// Chaque graphique a sa jumelle en tableau — c'est l'accès garanti à la
/// valeur pour qui ne distingue pas les teintes, et la sortie de secours
/// quand un point est trop petit pour être visé.
export const Cadre = ({ titre, aide, legende, tableau, libelleTableau, children }) => {
  const [vue, setVue] = useState("graphe");
  return (
    <figure className="vzCadre">
      <figcaption className="vzTete">
        <div className="vzTitres">
          <h4>{titre}</h4>
          {aide ? <p>{aide}</p> : null}
        </div>
        {tableau ? (
          <button
            type="button"
            className="vzBascule"
            aria-pressed={vue === "tableau"}
            onClick={() => setVue(vue === "graphe" ? "tableau" : "graphe")}
          >
            {libelleTableau}
          </button>
        ) : null}
      </figcaption>
      {legende?.length > 1 ? (
        <div className="vzLegende">
          {legende.map((l, i) => (
            <span key={l.cle ?? i} className="vzLegendeItem">
              <i style={{ background: l.couleur || couleurSerie(i) }} />
              {l.nom}
            </span>
          ))}
        </div>
      ) : null}
      <div className="vzCorps">{vue === "graphe" ? children : tableau}</div>
    </figure>
  );
};

/// L'infobulle. Positionnée en pourcentage du cadre pour suivre le
/// redimensionnement de la fenêtre sans recalcul.
const Bulle = ({ x, y, children }) =>
  children ? (
    <div className="vzBulle" style={{ left: `${x}%`, top: `${y}%` }}>
      {children}
    </div>
  ) : null;

// ---------------------------------------------------------------------------
// Série temporelle — ligne, moyenne mobile, prévision
// ---------------------------------------------------------------------------

/// `serie` : [{ cle, valeur, lisse? }]
/// `prevision` : [{ rang, valeur, bas, haut }] — dessinée en aval du dernier
/// point observé, avec sa bande d'incertitude.
export const SerieTemporelle = ({
  serie = [],
  prevision = [],
  clesPrevision = [],
  format = court,
  hauteur = 210,
  libelles = {},
}) => {
  const [survol, setSurvol] = useState(null);
  const L = 720;
  const H = hauteur;

  const points = useMemo(() => {
    const obs = serie.map((p) => ({ ...p, prevu: false }));
    const pre = prevision.map((p, i) => ({
      cle: clesPrevision[i] ?? `+${p.rang}`,
      valeur: p.valeur,
      bas: p.bas,
      haut: p.haut,
      prevu: true,
    }));
    return [...obs, ...pre];
  }, [serie, prevision, clesPrevision]);

  if (points.length < 2) return <div className="vzVide">{libelles.insuffisant}</div>;

  const maxi = Math.max(...points.map((p) => Math.max(p.valeur, p.haut ?? 0)), 0);
  const grille = paliers(maxi);
  const plafond = grille[grille.length - 1] || 1;

  const x = (i) => MARGE.gauche + (i * (L - MARGE.gauche - MARGE.droite)) / (points.length - 1);
  const y = (v) => H - MARGE.bas - ((v || 0) / plafond) * (H - MARGE.haut - MARGE.bas);

  const chemin = (liste, cle = "valeur") =>
    liste.map((p, i) => `${i ? "L" : "M"}${x(p.i ?? i).toFixed(1)},${y(p[cle]).toFixed(1)}`).join(" ");

  const obs = points.filter((p) => !p.prevu).map((p, i) => ({ ...p, i }));
  const decalage = obs.length - 1;
  const pre = points.filter((p) => p.prevu).map((p, i) => ({ ...p, i: decalage + 1 + i }));
  // La prévision part du dernier point observé : sans ce raccord, la courbe
  // semble sauter.
  const preAvecAncre = obs.length ? [{ ...obs[obs.length - 1], i: decalage }, ...pre] : pre;

  const aLisse = obs.some((p) => p.lisse !== undefined);
  const extreme = obs.reduce((m, p) => (p.valeur > (m?.valeur ?? -Infinity) ? p : m), null);
  const dernier = obs[obs.length - 1];

  return (
    <div className="vzPlot">
      <svg viewBox={`0 0 ${L} ${H}`} role="img" className="vzSvg">
        {grille.map((g) => (
          <g key={g}>
            <line className="vzGrille" x1={MARGE.gauche} x2={L - MARGE.droite} y1={y(g)} y2={y(g)} />
            <text className="vzAxe" x={MARGE.gauche - 8} y={y(g) + 4} textAnchor="end">
              {format(g)}
            </text>
          </g>
        ))}

        {preAvecAncre.length > 1 ? (
          <>
            <path
              className="vzBande"
              d={`${preAvecAncre.map((p, i) => `${i ? "L" : "M"}${x(p.i)},${y(p.haut ?? p.valeur)}`).join(" ")} ${[...preAvecAncre].reverse().map((p) => `L${x(p.i)},${y(p.bas ?? p.valeur)}`).join(" ")} Z`}
            />
            <path className="vzLignePrevue" d={chemin(preAvecAncre)} />
          </>
        ) : null}

        {aLisse ? <path className="vzLisse" d={chemin(obs, "lisse")} /> : null}
        <path className="vzLigne" d={chemin(obs)} />

        {/* Un point n'est marqué que s'il compte : le dernier, l'extrême. */}
        {[extreme, dernier].filter(Boolean).map((p, i) => (
          <circle key={`m${i}`} className="vzPoint" cx={x(p.i)} cy={y(p.valeur)} r={4.5} />
        ))}
        {dernier ? (
          <text
            className="vzEtiquette"
            x={Math.min(x(dernier.i) + 8, L - MARGE.droite)}
            y={Math.max(y(dernier.valeur) - 8, 12)}
            textAnchor={dernier.i > points.length * 0.8 ? "end" : "start"}
          >
            {format(dernier.valeur)}
          </text>
        ) : null}

        {points.map((p, i) => {
          if (i % Math.ceil(points.length / 7) !== 0 && i !== points.length - 1) return null;
          // La première et la dernière graduation s'ancrent vers l'intérieur :
          // centrées, elles dépassent du cadre et se font rogner.
          const bord = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
          return (
            <text key={`x${i}`} className="vzAxe" x={x(i)} y={H - 10} textAnchor={bord}>
              {String(p.cle).slice(-7)}
            </text>
          );
        })}

        {/* Zones de survol : une bande par point, bien plus large que la
            marque — on ne demande pas de viser un cercle de 9 px. */}
        {points.map((p, i) => (
          <rect
            key={`z${i}`}
            className="vzZone"
            x={x(i) - (L / points.length) / 2}
            y={MARGE.haut}
            width={L / points.length}
            height={H - MARGE.haut - MARGE.bas}
            onMouseEnter={() => setSurvol({ ...p, i })}
            onMouseLeave={() => setSurvol(null)}
          />
        ))}
        {survol ? (
          <line
            className="vzViseur"
            x1={x(survol.i)}
            x2={x(survol.i)}
            y1={MARGE.haut}
            y2={H - MARGE.bas}
          />
        ) : null}
      </svg>
      {survol ? (
        <Bulle x={(x(survol.i) / L) * 100} y={(y(survol.valeur) / H) * 100}>
          <b>{survol.cle}</b>
          <span>{format(survol.valeur)}</span>
          {survol.prevu ? <em>{libelles.prevu}</em> : null}
        </Bulle>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Barres horizontales — comparer des catégories
// ---------------------------------------------------------------------------

/// Horizontales à dessein : les noms de catégories se lisent en entier, sans
/// étiquettes inclinées à 45° qu'il faut pencher la tête pour déchiffrer.
export const Barres = ({ donnees = [], format = court, couleur, libelles = {} }) => {
  const [survol, setSurvol] = useState(null);
  if (!donnees.length) return <div className="vzVide">{libelles.aucune}</div>;

  const maxi = Math.max(...donnees.map((d) => Math.abs(d.valeur)), 0) || 1;

  return (
    <div className="vzBarres" onMouseLeave={() => setSurvol(null)}>
      {donnees.map((d, i) => (
        <div
          key={d.cle ?? i}
          className="vzBarreLigne"
          onMouseEnter={() => setSurvol(i)}
          data-survol={survol === i}
        >
          <span className="vzBarreNom" title={d.nom ?? d.cle}>
            {d.nom ?? d.cle}
          </span>
          <span className="vzBarrePiste">
            <span
              className="vzBarre"
              style={{
                width: `${Math.max(1, (Math.abs(d.valeur) / maxi) * 100)}%`,
                background: d.couleur || couleur || couleurSerie(0),
              }}
            />
          </span>
          {/* La valeur est écrite, pas seulement colorée : c'est ce qui
              rend la barre lisible quand la teinte ne l'est pas. */}
          <span className="vzBarreVal">{format(d.valeur)}</span>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Pareto — barres de part + courbe cumulée, une seule échelle en %
// ---------------------------------------------------------------------------

export const Pareto = ({ lignes = [], libelles = {} }) => {
  const [survol, setSurvol] = useState(null);
  if (lignes.length < 2) return <div className="vzVide">{libelles.aucune}</div>;

  const L = 720;
  const H = 230;
  const n = lignes.length;
  const largeur = (L - MARGE.gauche - MARGE.droite) / n;
  const x = (i) => MARGE.gauche + i * largeur;
  const y = (pct) => H - MARGE.bas - (pct / 100) * (H - MARGE.haut - MARGE.bas);

  const classeCouleur = { A: "var(--vz-1)", B: "var(--vz-3)", C: "var(--vz-muet)" };

  return (
    <div className="vzPlot">
      <svg viewBox={`0 0 ${L} ${H}`} role="img" className="vzSvg">
        {[0, 25, 50, 80, 100].map((g) => (
          <g key={g}>
            <line className="vzGrille" x1={MARGE.gauche} x2={L - MARGE.droite} y1={y(g)} y2={y(g)} />
            <text className="vzAxe" x={MARGE.gauche - 8} y={y(g) + 4} textAnchor="end">
              {g} %
            </text>
          </g>
        ))}

        {lignes.map((l, i) => (
          <rect
            key={`b${l.cle}`}
            className="vzBarreSvg"
            x={x(i) + 1}
            y={y(l.part)}
            width={Math.max(2, largeur - 2)}
            height={Math.max(1, y(0) - y(l.part))}
            rx={largeur > 8 ? 4 : 1}
            fill={classeCouleur[l.classe]}
            onMouseEnter={() => setSurvol(i)}
            onMouseLeave={() => setSurvol(null)}
          />
        ))}

        <path
          className="vzLigne"
          d={lignes
            .map((l, i) => `${i ? "L" : "M"}${(x(i) + largeur / 2).toFixed(1)},${y(l.partCumulee).toFixed(1)}`)
            .join(" ")}
        />
        <line className="vzSeuil" x1={MARGE.gauche} x2={L - MARGE.droite} y1={y(80)} y2={y(80)} />
      </svg>
      {survol !== null && lignes[survol] ? (
        <Bulle x={((x(survol) + largeur / 2) / L) * 100} y={(y(lignes[survol].partCumulee) / H) * 100}>
          <b>{lignes[survol].cle}</b>
          <span>{lignes[survol].part.toFixed(1)} %</span>
          <em>
            {libelles.cumul} {lignes[survol].partCumulee.toFixed(1)} % · {lignes[survol].classe}
          </em>
        </Bulle>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Nuage de points + droite de régression
// ---------------------------------------------------------------------------

export const Nuage = ({ points = [], reg = null, formatX = court, formatY = court, libelles = {} }) => {
  const [survol, setSurvol] = useState(null);
  if (points.length < 3) return <div className="vzVide">{libelles.insuffisant}</div>;

  const L = 720;
  const H = 230;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const gx = paliers(Math.max(...xs), Math.min(0, ...xs));
  const gy = paliers(Math.max(...ys), Math.min(0, ...ys));
  const maxX = gx[gx.length - 1] || 1;
  const maxY = gy[gy.length - 1] || 1;

  const px = (v) => MARGE.gauche + (v / maxX) * (L - MARGE.gauche - MARGE.droite);
  const py = (v) => H - MARGE.bas - (v / maxY) * (H - MARGE.haut - MARGE.bas);

  return (
    <div className="vzPlot">
      <svg viewBox={`0 0 ${L} ${H}`} role="img" className="vzSvg">
        {gy.map((g) => (
          <g key={`y${g}`}>
            <line className="vzGrille" x1={MARGE.gauche} x2={L - MARGE.droite} y1={py(g)} y2={py(g)} />
            <text className="vzAxe" x={MARGE.gauche - 8} y={py(g) + 4} textAnchor="end">
              {formatY(g)}
            </text>
          </g>
        ))}
        {gx.map((g) => (
          <text key={`x${g}`} className="vzAxe" x={px(g)} y={H - 10} textAnchor="middle">
            {formatX(g)}
          </text>
        ))}

        {reg && Number.isFinite(reg.pente) ? (
          <line
            className="vzRegression"
            x1={px(0)}
            y1={py(Math.max(0, reg.ordonnee))}
            x2={px(maxX)}
            y2={py(Math.max(0, reg.pente * maxX + reg.ordonnee))}
          />
        ) : null}

        {points.map((p, i) => (
          <circle
            key={i}
            className="vzDot"
            cx={px(p.x)}
            cy={py(p.y)}
            r={survol === i ? 7 : 5}
            onMouseEnter={() => setSurvol(i)}
            onMouseLeave={() => setSurvol(null)}
          />
        ))}
      </svg>
      {survol !== null && points[survol] ? (
        <Bulle x={(px(points[survol].x) / L) * 100} y={(py(points[survol].y) / H) * 100}>
          <b>{points[survol].nom ?? ""}</b>
          <span>
            {formatX(points[survol].x)} · {formatY(points[survol].y)}
          </span>
        </Bulle>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Heatmap de cohortes — rampe séquentielle à une seule teinte
// ---------------------------------------------------------------------------

/// Une seule teinte, du clair au foncé : la magnitude est une grandeur
/// continue, un arc-en-ciel y inventerait des catégories.
export const Cohortes = ({ donnees = [], libelles = {} }) => {
  const [survol, setSurvol] = useState(null);
  if (!donnees.length) return <div className="vzVide">{libelles.aucune}</div>;

  const profondeur = Math.max(...donnees.map((c) => c.cellules.length));
  const pas = (taux) => {
    if (taux === null) return "transparent";
    const i = Math.min(6, Math.max(0, Math.round((taux / 100) * 6)));
    return `var(--vz-seq-${i})`;
  };

  return (
    <div className="vzCohortes">
      <table className="vzGrilleC">
        <thead>
          <tr>
            <th>{libelles.cohorte}</th>
            <th>{libelles.taille}</th>
            {Array.from({ length: profondeur }, (_, i) => (
              <th key={i}>{i === 0 ? libelles.mois0 : `+${i}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {donnees.map((c) => (
            <tr key={c.cohorte}>
              <th scope="row">{c.cohorte}</th>
              <td className="vzTaille">{c.taille}</td>
              {c.cellules.map((cell, i) => (
                <td
                  key={i}
                  className="vzCellule"
                  style={{ background: pas(cell?.taux ?? null) }}
                  data-fort={cell && cell.taux >= 55}
                  onMouseEnter={() => cell && setSurvol({ c: c.cohorte, i, ...cell })}
                  onMouseLeave={() => setSurvol(null)}
                >
                  {/* La valeur est écrite dans la case : la teinte donne
                      l'allure d'ensemble, le chiffre donne la vérité. */}
                  {cell ? `${Math.round(cell.taux)}` : ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {survol ? (
        <p className="vzNoteC">
          {survol.c} · +{survol.i} → {survol.n} {libelles.revenus} ({Math.round(survol.taux)} %)
        </p>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tuiles de chiffres — quand l'histoire est un seul nombre
// ---------------------------------------------------------------------------

/// Un nombre qui compte n'a pas besoin d'un graphique à une barre : il a
/// besoin d'être gros et lisible.
export const Tuile = ({ libelle, valeur, variation, aide, ton = "neutre" }) => (
  <div className="vzTuile" data-ton={ton}>
    <span className="vzTuileLib">{libelle}</span>
    <strong className="vzTuileVal">{valeur}</strong>
    {variation !== null && variation !== undefined ? (
      <span className="vzTuileVar" data-sens={variation >= 0 ? "haut" : "bas"}>
        {variation >= 0 ? "▲" : "▼"} {Math.abs(variation).toFixed(1)} %
      </span>
    ) : null}
    {aide ? <span className="vzTuileAide">{aide}</span> : null}
  </div>
);

/// Courbe miniature, pour donner une allure sans occuper de place.
export const Etincelle = ({ serie = [] }) => {
  if (serie.length < 2) return null;
  const maxi = Math.max(...serie.map((p) => p.valeur)) || 1;
  const d = serie
    .map((p, i) => `${i ? "L" : "M"}${(i / (serie.length - 1)) * 100},${28 - (p.valeur / maxi) * 26}`)
    .join(" ");
  return (
    <svg className="vzEtincelle" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  );
};

/// La vue tableau jumelle — le même contenu, sans couleur.
export const TableauValeurs = ({ colonnes = [], lignes = [] }) => (
  <div className="vzTableauEnveloppe">
    <table className="vzTableau">
      <thead>
        <tr>
          {colonnes.map((c) => (
            <th key={c.cle} data-num={c.num || undefined}>
              {c.nom}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lignes.map((l, i) => (
          <tr key={i}>
            {colonnes.map((c) => (
              <td key={c.cle} data-num={c.num || undefined}>
                {l[c.cle]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
