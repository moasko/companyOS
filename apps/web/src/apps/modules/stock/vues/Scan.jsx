// Stock — le mode scan.
//
// Pensé pour le téléphone comme pour la douchette USB : une douchette tape
// le code puis « Entrée » dans le champ qui a le focus ; la caméra passe
// par BarcodeDetector quand le navigateur le connaît. Chaque lecture ajoute
// un article (ou +1) au panier ; valider crée les mouvements d'un coup, ou
// reporte les quantités dans un inventaire ouvert.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../../../utils/general";
import { parCode } from "../regles";
import { Bouton, Entete, Vignette, nombre, useS } from "../commun";

const MODES = [
  { id: "entree", icone: "faArrowDown" },
  { id: "sortie", icone: "faArrowUp" },
  { id: "transfert", icone: "faRightLeft" },
  { id: "compter", icone: "faClipboardCheck" },
];

const cameraDisponible = () => typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;

export const Scan = () => {
  const s = useS();
  const { t, q, articles, entrepots, entrepotActif, inventaires, parEntrepot, enregistrerMouvements, enregistrerRecord, nomEntrepot, aller, occupe } = s;
  const premier = entrepotActif !== "*" ? entrepotActif : entrepots[0]?.id ?? "";
  const [mode, setMode] = useState("sortie");
  const [ou, setOu] = useState(premier);
  const [vers, setVers] = useState(entrepots.find((e) => e.id !== premier)?.id ?? premier);
  const ouverts = inventaires.filter((i) => i.data.statut !== "valide");
  const [inventaireId, setInventaireId] = useState(ouverts[0]?.id || "");
  const [code, setCode] = useState("");
  const [panier, setPanier] = useState([]);
  const [message, setMessage] = useState(null);
  const [camera, setCamera] = useState(false);
  const champ = useRef(null);
  const video = useRef(null);
  const parId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const lire = (brut) => {
    const a = parCode(articles, brut);
    if (!a) {
      setMessage({ ton: "rouge", texte: t("codeInconnu", { code: brut }) });
      return;
    }
    setPanier((p) => {
      const i = p.findIndex((x) => x.articleId === a.id);
      if (i < 0) return [{ articleId: a.id, qte: 1 }, ...p];
      return p.map((x, j) => (j === i ? { ...x, qte: nombre(x.qte) + 1 } : x));
    });
    setMessage({ ton: "vert", texte: `${a.data.designation} +1` });
  };

  const soumettre = (e) => {
    e.preventDefault();
    if (code.trim()) lire(code.trim());
    setCode("");
    champ.current?.focus();
  };

  // La caméra : une image toutes les 300 ms, et une pause d'une seconde
  // après chaque lecture pour ne pas compter dix fois le même article.
  useEffect(() => {
    if (!camera) return undefined;
    let flux = null;
    let fini = false;
    let minuterie = null;
    let dernier = { code: "", quand: 0 };
    (async () => {
      try {
        flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (fini) return;
        video.current.srcObject = flux;
        await video.current.play();
        const detecteur = new window.BarcodeDetector();
        const boucle = async () => {
          if (fini) return;
          try {
            const trouves = await detecteur.detect(video.current);
            const c = trouves[0]?.rawValue;
            if (c && (c !== dernier.code || Date.now() - dernier.quand > 1000)) {
              dernier = { code: c, quand: Date.now() };
              lire(c);
            }
          } catch {
            /* image pas encore prête */
          }
          minuterie = setTimeout(boucle, 300);
        };
        boucle();
      } catch {
        setMessage({ ton: "rouge", texte: t("cameraRefusee") });
        setCamera(false);
      }
    })();
    return () => {
      fini = true;
      clearTimeout(minuterie);
      flux?.getTracks().forEach((x) => x.stop());
    };
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps

  const valider = async () => {
    const lignes = panier.filter((x) => nombre(x.qte) > 0);
    if (!lignes.length) return;
    if (mode === "compter") {
      const inv = inventaires.find((i) => i.id === inventaireId);
      if (!inv) return;
      const existantes = inv.data.lignes || [];
      const parArticle = new Map(existantes.map((l) => [l.articleId, l]));
      for (const x of lignes) {
        const l = parArticle.get(x.articleId);
        if (l) parArticle.set(x.articleId, { ...l, compte: (l.compte == null ? 0 : Number(l.compte)) + nombre(x.qte) });
        else parArticle.set(x.articleId, { articleId: x.articleId, attendu: parEntrepot[x.articleId]?.[inv.data.entrepotId || ""] || 0, compte: nombre(x.qte), cause: "" });
      }
      const r = await enregistrerRecord("inventaires", inv.id, { ...inv.data, lignes: [...parArticle.values()] });
      if (r) {
        setPanier([]);
        setMessage({ ton: "vert", texte: t("scanReporte", { numero: inv.data.numero }) });
      }
      return;
    }
    const mvts = lignes.map((x) =>
      mode === "transfert"
        ? { articleId: x.articleId, sens: "transfert", quantite: nombre(x.qte), de: ou, vers, motif: t("motifScan") }
        : { articleId: x.articleId, sens: mode, quantite: nombre(x.qte), entrepotId: ou, motif: t("motifScan") },
    );
    if (await enregistrerMouvements(mvts)) {
      setPanier([]);
      setMessage({ ton: "vert", texte: t("scanEnregistre", { n: mvts.length }) });
    }
  };

  const total = panier.reduce((x, y) => x + nombre(y.qte), 0);

  return (
    <div className="stoVue stoScan">
      <Entete titre={t("navScan")} sous={t("sousScan")} />
      <div className="stoConteneur stoScanCorps">
        <div className="stoSegments stoModes" role="group" aria-label={t("mode")}>
          {MODES.map((x) => (
            <button key={x.id} type="button" aria-pressed={mode === x.id} onClick={() => setMode(x.id)}>
              <Icon fafa={x.icone} width={12} />
              {t(`mode_${x.id}`)}
            </button>
          ))}
        </div>

        <div className="stoDeux">
          {mode === "compter" ? (
            <label className="stoChamp">
              <span>{t("inventaire")}</span>
              <select value={inventaireId} onChange={(e) => setInventaireId(e.target.value)}>
                {!ouverts.length ? <option value="">{t("aucunInventaireOuvert")}</option> : null}
                {ouverts.map((i) => <option key={i.id} value={i.id}>{i.data.numero} · {nomEntrepot(i.data.entrepotId)}</option>)}
              </select>
            </label>
          ) : (
            <label className="stoChamp">
              <span>{mode === "transfert" ? t("de") : t("entrepot")}</span>
              <select value={ou} onChange={(e) => setOu(e.target.value)}>
                {entrepots.map((e) => <option key={e.id || "p"} value={e.id}>{e.nom}</option>)}
              </select>
            </label>
          )}
          {mode === "transfert" ? (
            <label className="stoChamp">
              <span>{t("vers")}</span>
              <select value={vers} onChange={(e) => setVers(e.target.value)}>
                {entrepots.map((e) => <option key={e.id || "p"} value={e.id}>{e.nom}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        {mode === "compter" && !ouverts.length ? (
          <p className="stoAide">
            {t("scanSansInventaire")} <button type="button" className="stoLien" onClick={() => aller("inventaires", { nouveau: true })}>{t("nouvelInventaire")}</button>
          </p>
        ) : null}

        <form className="stoLecteur" onSubmit={soumettre}>
          <Icon fafa="faBarcode" width={18} />
          <input ref={champ} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("scannerIci")} aria-label={t("scannerIci")} autoComplete="off" />
          {cameraDisponible() ? (
            <button type="button" className="stoIcone" aria-pressed={camera} onClick={() => setCamera((c) => !c)} title={t("camera")} aria-label={t("camera")}>
              <Icon fafa="faCamera" width={15} />
            </button>
          ) : null}
        </form>
        {camera ? <video ref={video} className="stoVideo" muted playsInline /> : null}
        {message ? <p className="stoMessage" data-ton={message.ton} role="status">{message.texte}</p> : null}

        <ul className="stoPanier">
          {panier.map((x, i) => {
            const a = parId.get(x.articleId);
            return (
              <li key={x.articleId}>
                <Vignette article={a} taille={40} />
                <span>
                  <b className="stoEllipse">{a?.data.designation}</b>
                  <small className="stoDoux">{t("enStockIci", { q: q(parEntrepot[x.articleId]?.[mode === "compter" ? inventaires.find((v) => v.id === inventaireId)?.data.entrepotId || "" : ou] || 0) })}</small>
                </span>
                <span className="stoPas">
                  <button type="button" onClick={() => setPanier((p) => p.map((y, j) => (j === i ? { ...y, qte: Math.max(0, nombre(y.qte) - 1) } : y)))} aria-label="−">−</button>
                  <input inputMode="decimal" value={x.qte} onChange={(e) => setPanier((p) => p.map((y, j) => (j === i ? { ...y, qte: e.target.value } : y)))} aria-label={t("quantite")} />
                  <button type="button" onClick={() => setPanier((p) => p.map((y, j) => (j === i ? { ...y, qte: nombre(y.qte) + 1 } : y)))} aria-label="+">+</button>
                </span>
                <button type="button" className="stoIcone" onClick={() => setPanier((p) => p.filter((_, j) => j !== i))} aria-label={t("retirer")}>
                  <Icon fafa="faXmark" width={12} />
                </button>
              </li>
            );
          })}
          {!panier.length ? <li className="stoRien">{t("panierVide")}</li> : null}
        </ul>

        <div className="stoPied stoPiedScan">
          <span>{t("panierTotal", { n: panier.length, q: q(total) })}</span>
          <Bouton
            variante="principal"
            icone="faCheck"
            disabled={!panier.length || occupe || (mode === "compter" && !inventaireId) || (mode === "transfert" && ou === vers)}
            onClick={valider}
          >
            {t(`validerScan_${mode}`)}
          </Bouton>
        </div>
      </div>
    </div>
  );
};
