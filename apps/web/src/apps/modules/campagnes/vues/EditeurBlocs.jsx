// Campagnes — l'éditeur de message par blocs.
//
// À gauche la palette (glisser un bloc, ou cliquer pour l'ajouter sous la
// sélection), au centre le plan de travail — chaque bloc dessiné par le
// même rendu que l'e-mail — ou l'aperçu réel (ordinateur, mobile), à
// droite l'objet et les réglages du bloc choisi. Sert aux campagnes, aux
// automatisations et aux modèles.

import React, { useMemo, useRef, useState } from "react";
import { Icon } from "../../../../utils/general";
import { modal } from "../../../modalRequest";
import { saveToCloud } from "../../../cloud";
import { choisirImage, redimensionnerImage } from "../../../image";
import { choisirFichierCloud } from "../../../ChoisirFichier";
import * as D from "@companyos/shared/campagnes";
import { ApercuMail, COULEURS, Onglets, useC, useImagesCloud } from "../commun";

const ICONES = {
  titre: "faHeading",
  texte: "faAlignLeft",
  image: "faImage",
  bouton: "faHandPointer",
  produits: "faBoxesStacked",
  colonnes: "faTableColumns",
  promo: "faTicket",
  separateur: "faGripLines",
  reseaux: "faShareNodes",
  signature: "faSignature",
};

const TYPE_DRAG = "application/x-companyos-bloc";

/// Le bloc rendu comme dans l'e-mail. Le HTML vient de notre propre rendu,
/// qui échappe tout ce que l'utilisateur a saisi.
const RenduBloc = ({ bloc, couleur, image }) => {
  const { t } = useC();
  // Un bouton dont le lien reste à saisir se dessine quand même, signalé.
  const lienManquant = bloc.type === "bouton" && bloc.label && !D.urlValide(bloc.url);
  const { html } = D.htmlBloc(lienManquant ? { ...bloc, url: "https://lien.invalid/" } : bloc, { couleur, image });
  if (!/<tr>/.test(html)) return <div className="cmpBlocVide">{t(`vide_${bloc.type}`)}</div>;
  return (
    <>
      <div className="cmpBlocRendu" dangerouslySetInnerHTML={{ __html: html }} />
      {lienManquant ? <span className="cmpLienManquant">{t("lienACompleter")}</span> : null}
    </>
  );
};

export const EditeurBlocs = ({ message, onChange, ab = false, variables = [], exemple = null, extra = {} }) => {
  const { t, articles, argent, peutEcrire } = useC();
  const blocs = message.blocs || [];
  const [selection, setSelection] = useState(blocs[0]?.id || null);
  const [mode, setMode] = useState("plan");
  const [appareil, setAppareil] = useState("ordinateur");
  const [cible, setCible] = useState(null); // index d'insertion pendant un glisser
  const image = useImagesCloud(blocs);
  const dernierChamp = useRef(null);
  const langue = message.langue || "fr";

  const majBlocs = (liste) => onChange({ blocs: liste });
  const majBloc = (id, patch) => majBlocs(blocs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const choisi = blocs.find((b) => b.id === selection);

  const inserer = (type, index = null) => {
    const b = D.blocVide(type, { langue });
    const i = index ?? (choisi ? blocs.indexOf(choisi) + 1 : blocs.length);
    majBlocs([...blocs.slice(0, i), b, ...blocs.slice(i)]);
    setSelection(b.id);
    setMode("plan");
  };
  const deplacer = (id, sens) => majBlocs(D.deplacerBloc(blocs, id, sens));
  const dupliquer = (id) => {
    const i = blocs.findIndex((b) => b.id === id);
    const copie = D.dupliquerBloc(blocs[i]);
    majBlocs([...blocs.slice(0, i + 1), copie, ...blocs.slice(i + 1)]);
    setSelection(copie.id);
  };
  const supprimer = (id) => {
    const i = blocs.findIndex((b) => b.id === id);
    majBlocs(blocs.filter((b) => b.id !== id));
    setSelection(blocs[i + 1]?.id || blocs[i - 1]?.id || null);
  };

  // ---- Glisser-déposer ----------------------------------------------------
  const surDebutPalette = (type) => (e) => {
    e.dataTransfer.setData(TYPE_DRAG, JSON.stringify({ type }));
    e.dataTransfer.effectAllowed = "copy";
  };
  const surDebutBloc = (id) => (e) => {
    e.dataTransfer.setData(TYPE_DRAG, JSON.stringify({ id }));
    e.dataTransfer.effectAllowed = "move";
  };
  const surSurvol = (i) => (e) => {
    if (![...e.dataTransfer.types].includes(TYPE_DRAG)) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setCible(e.clientY < r.top + r.height / 2 ? i : i + 1);
  };
  const surDepot = (e) => {
    e.preventDefault();
    const brut = e.dataTransfer.getData(TYPE_DRAG);
    const i = cible ?? blocs.length;
    setCible(null);
    if (!brut) return;
    const { type, id } = JSON.parse(brut);
    if (type) return inserer(type, i);
    const de = blocs.findIndex((b) => b.id === id);
    if (de < 0) return;
    const sans = blocs.filter((b) => b.id !== id);
    const ou = i > de ? i - 1 : i;
    majBlocs([...sans.slice(0, ou), blocs[de], ...sans.slice(ou)]);
  };

  // ---- Variables ----------------------------------------------------------
  const listeVariables = [...D.VARIABLES.map((v) => v.id), ...variables];
  const glisserVariable = (id) => {
    const champ = dernierChamp.current;
    const jeton = `{{${id}}}`;
    if (!champ?.el) return;
    const { el, appliquer } = champ;
    const valeur = el.value || "";
    const debut = el.selectionStart ?? valeur.length;
    const fin = el.selectionEnd ?? valeur.length;
    appliquer(valeur.slice(0, debut) + jeton + valeur.slice(fin));
    window.requestAnimationFrame(() => { el.focus(); el.setSelectionRange(debut + jeton.length, debut + jeton.length); });
  };
  const suivre = (appliquer) => ({ onFocus: (e) => { dernierChamp.current = { el: e.target, appliquer }; } });

  const objet = D.analyseObjet(message.sujet);
  const verifs = D.verificationsContenu(message);

  return (
    <div className="cmpEditeurBlocs">
      <aside className="cmpPalette" aria-label={t("blocs")}>
        <h3>{t("blocs")}</h3>
        <p className="cmpAide">{t("paletteAide")}</p>
        <div className="cmpPaletteGrille">
          {D.TYPES_BLOCS.map((type) => (
            <button key={type} type="button" draggable onDragStart={surDebutPalette(type)} onClick={() => inserer(type)} disabled={!peutEcrire}>
              <Icon fafa={ICONES[type]} width={14} />
              <b>{t(`bloc_${type}`)}</b>
              <small>{t(`blocAide_${type}`)}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="cmpPlan" aria-label={t("message")}>
        <div className="cmpPlanBarre">
          <Onglets label={t("vue")} valeur={mode} onChoisir={setMode} options={[{ id: "plan", label: t("planTravail") }, { id: "apercu", label: t("apercuReel") }]} />
          {mode === "apercu" ? (
            <Onglets label={t("appareil")} valeur={appareil} onChoisir={setAppareil} options={[{ id: "ordinateur", label: t("ordinateur") }, { id: "mobile", label: t("mobile") }]} />
          ) : null}
        </div>
        {mode === "apercu" ? (
          <ApercuMail message={message} exemple={exemple} appareil={appareil} extra={extra} />
        ) : (
          <div className="cmpFeuille" onDragOver={(e) => { if ([...e.dataTransfer.types].includes(TYPE_DRAG)) { e.preventDefault(); if (!blocs.length) setCible(0); } }} onDrop={surDepot} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setCible(null); }}>
            <div className="cmpFeuilleTete" style={{ background: D.couleurSure(message.couleur) }}>{t("enTeteAuto")}</div>
            {blocs.map((b, i) => (
              <React.Fragment key={b.id}>
                {cible === i ? <div className="cmpInsertion" /> : null}
                <div
                  className="cmpBlocPlan"
                  data-choisi={selection === b.id || undefined}
                  draggable={peutEcrire}
                  onDragStart={surDebutBloc(b.id)}
                  onDragOver={surSurvol(i)}
                  onClickCapture={(e) => { if (e.target.closest("a")) e.preventDefault(); }}
                  onClick={() => setSelection(b.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={t(`bloc_${b.type}`)}
                  aria-pressed={selection === b.id}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelection(b.id); } }}
                >
                  <span className="cmpBlocType">{t(`bloc_${b.type}`)}</span>
                  {selection === b.id && peutEcrire ? (
                    <span className="cmpBlocOutils" onClick={(e) => e.stopPropagation()}>
                      <button type="button" aria-label={t("monter")} title={t("monter")} onClick={() => deplacer(b.id, -1)} disabled={i === 0}><Icon fafa="faArrowUp" width={11} /></button>
                      <button type="button" aria-label={t("descendre")} title={t("descendre")} onClick={() => deplacer(b.id, 1)} disabled={i === blocs.length - 1}><Icon fafa="faArrowDown" width={11} /></button>
                      <button type="button" aria-label={t("dupliquer")} title={t("dupliquer")} onClick={() => dupliquer(b.id)}><Icon fafa="faClone" width={11} /></button>
                      <button type="button" aria-label={t("supprimer")} title={t("supprimer")} onClick={() => supprimer(b.id)}><Icon fafa="faTrashCan" width={11} /></button>
                    </span>
                  ) : null}
                  <RenduBloc bloc={b} couleur={message.couleur} image={image} />
                </div>
              </React.Fragment>
            ))}
            {cible === blocs.length ? <div className="cmpInsertion" /> : null}
            {!blocs.length ? <div className="cmpFeuilleVide"><Icon fafa="faHandPointer" width={18} />{t("feuilleVide")}</div> : null}
            <div className="cmpFeuillePied">{t("piedAuto")}</div>
          </div>
        )}
      </section>

      <aside className="cmpReglages" aria-label={t("reglages")}>
        <section>
          <div className="cmpReglageTete">
            <h3>{t("objet")}</h3>
            {ab ? (
              <label className="cmpCase">
                <input type="checkbox" checked={!!message.ab?.actif} onChange={(e) => onChange({ ab: { ...D.CAMPAGNE_VIDE.ab, ...(message.ab || {}), actif: e.target.checked } })} />
                <span>{t("testAB")}</span>
              </label>
            ) : null}
          </div>
          <label className="cmpChamp">
            <span>{message.ab?.actif ? t("versionA") : t("objet")} <small data-ton={objet.ton}>{objet.longueur ? t("nCaracteres", { n: objet.longueur }) : ""}</small></span>
            <input value={message.sujet || ""} placeholder={t("objetExemple")} onChange={(e) => onChange({ sujet: e.target.value })} {...suivre((v) => onChange({ sujet: v }))} />
          </label>
          {objet.conseils.length ? <p className="cmpConseil">{objet.conseils[0]}</p> : null}
          {ab && message.ab?.actif ? (
            <>
              <label className="cmpChamp">
                <span>{t("versionB")}</span>
                <input value={message.ab.sujetB || ""} placeholder={t("objetBExemple")} onChange={(e) => onChange({ ab: { ...message.ab, sujetB: e.target.value } })} {...suivre((v) => onChange({ ab: { ...message.ab, sujetB: v } }))} />
              </label>
              <div className="cmpDeux">
                <label className="cmpChamp">
                  <span>{t("partTest")}</span>
                  <select value={message.ab.part || 20} onChange={(e) => onChange({ ab: { ...message.ab, part: Number(e.target.value) } })}>
                    {[10, 20, 30, 50].map((p) => <option key={p} value={p}>{p} %</option>)}
                  </select>
                </label>
                <label className="cmpChamp">
                  <span>{t("delaiDecision")}</span>
                  <select value={message.ab.heures || 4} onChange={(e) => onChange({ ab: { ...message.ab, heures: Number(e.target.value) } })}>
                    {[1, 2, 4, 8, 24].map((h) => <option key={h} value={h}>{t("nHeures", { n: h })}</option>)}
                  </select>
                </label>
              </div>
              <p className="cmpEncadre">{t("abExplication", { part: message.ab.part || 20, heures: message.ab.heures || 4 })}</p>
            </>
          ) : null}
          <label className="cmpChamp">
            <span>{t("texteApercu")}</span>
            <input value={message.apercu || ""} maxLength={140} placeholder={t("texteApercuExemple")} onChange={(e) => onChange({ apercu: e.target.value })} />
          </label>
          <div className="cmpVariables">
            <span>{t("inserer")}</span>
            {listeVariables.map((v) => (
              <button key={v} type="button" title={t(`var_${v}`)} onMouseDown={(e) => e.preventDefault()} onClick={() => glisserVariable(v)}>{`{{${v}}}`}</button>
            ))}
          </div>
        </section>

        <section>
          <h3>{choisi ? t("blocChoisi", { type: t(`bloc_${choisi.type}`) }) : t("aucunBloc")}</h3>
          {choisi ? <ProprietesBloc bloc={choisi} maj={(p) => majBloc(choisi.id, p)} suivre={suivre} articles={articles} argent={argent} t={t} /> : <p className="cmpAide">{t("aucunBlocAide")}</p>}
        </section>

        <section>
          <h3>{t("couleur")}</h3>
          <div className="cmpCouleurs" role="radiogroup" aria-label={t("couleur")}>
            {COULEURS.map((hex) => (
              <button key={hex} type="button" role="radio" aria-checked={String(message.couleur || "").toLowerCase() === hex} aria-label={hex} style={{ background: hex }} onClick={() => onChange({ couleur: hex })} />
            ))}
            <label className="cmpCouleurLibre" title={t("couleurLibre")}>
              <Icon fafa="faEyeDropper" width={10} />
              <input type="color" aria-label={t("couleurLibre")} value={D.couleurSure(message.couleur, "#c2410c")} onChange={(e) => onChange({ couleur: e.target.value })} />
            </label>
          </div>
          <label className="cmpChamp">
            <span>{t("langueMessage")}</span>
            <select value={langue} onChange={(e) => onChange({ langue: e.target.value })}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
        </section>

        <section>
          <h3>{t("verifications")}</h3>
          <ul className="cmpVerifs">
            {verifs.filter((v) => !v.facultatif).map((v) => (
              <li key={v.id} data-ok={v.ok || undefined} data-conseil={v.conseil || undefined}>
                <span aria-hidden="true">{v.ok ? <Icon fafa="faCheck" width={9} /> : "!"}</span>
                {t(`verif_${v.id}${v.ok ? "" : "_ko"}`, v.params)}
              </li>
            ))}
            <li data-ok>
              <span aria-hidden="true"><Icon fafa="faCheck" width={9} /></span>
              {t("verif_desabo")}
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Les réglages de chaque type de bloc
// ---------------------------------------------------------------------------

const Champ = ({ label, children, aide }) => (
  <label className="cmpChamp">
    <span>{label}</span>
    {children}
    {aide ? <small>{aide}</small> : null}
  </label>
);

const ProprietesBloc = ({ bloc, maj, suivre, articles, argent, t }) => {
  const val = (k) => bloc[k] ?? "";
  const set = (k) => (e) => maj({ [k]: e.target.value });
  const texte = (k, rows = 6) => (
    <textarea rows={rows} value={val(k)} onChange={set(k)} {...suivre((v) => maj({ [k]: v }))} />
  );
  const lienKo = (u) => u && !D.urlValide(u);
  switch (bloc.type) {
    case "titre":
      return (
        <>
          <Champ label={t("texte")}><input value={val("texte")} onChange={set("texte")} {...suivre((v) => maj({ texte: v }))} /></Champ>
          <div className="cmpDeux">
            <Champ label={t("taille")}><select value={bloc.taille || "grand"} onChange={set("taille")}><option value="grand">{t("grand")}</option><option value="moyen">{t("moyen")}</option></select></Champ>
            <Champ label={t("alignement")}><select value={bloc.align || "gauche"} onChange={set("align")}><option value="gauche">{t("gauche")}</option><option value="centre">{t("centre")}</option></select></Champ>
          </div>
        </>
      );
    case "texte":
    case "signature":
      return <Champ label={t("texte")} aide={t("texteAide")}>{texte("texte", bloc.type === "texte" ? 9 : 4)}</Champ>;
    case "colonnes":
      return (
        <>
          <Champ label={t("colonneGauche")} aide={t("texteAide")}>{texte("gauche", 5)}</Champ>
          <Champ label={t("colonneDroite")}>{texte("droite", 5)}</Champ>
        </>
      );
    case "image":
      return <ProprietesImage bloc={bloc} maj={maj} t={t} />;
    case "bouton":
      return (
        <>
          <Champ label={t("texteBouton")}><input value={val("label")} onChange={set("label")} {...suivre((v) => maj({ label: v }))} /></Champ>
          <Champ label={t("lien")} aide={lienKo(bloc.url) ? t("lienInvalide") : t("lienSuivi")}><input value={val("url")} inputMode="url" placeholder="https://…" onChange={set("url")} aria-invalid={lienKo(bloc.url) || undefined} /></Champ>
          <Champ label={t("alignement")}><select value={bloc.align || "centre"} onChange={set("align")}><option value="gauche">{t("gauche")}</option><option value="centre">{t("centre")}</option></select></Champ>
        </>
      );
    case "produits":
      return <ProprietesProduits bloc={bloc} maj={maj} articles={articles} argent={argent} t={t} />;
    case "promo":
      return (
        <>
          <Champ label={t("codePromo")}><input value={val("code")} onChange={(e) => maj({ code: e.target.value.toUpperCase() })} /></Champ>
          <Champ label={t("texte")}><input value={val("texte")} onChange={set("texte")} /></Champ>
        </>
      );
    case "separateur":
      return <Champ label={t("style")}><select value={bloc.style || "ligne"} onChange={set("style")}><option value="ligne">{t("ligne")}</option><option value="espace">{t("espace")}</option></select></Champ>;
    case "reseaux":
      return (
        <>
          {["site", "whatsapp", "facebook", "instagram", "linkedin"].map((k) => (
            <Champ key={k} label={t(`reseau_${k}`)} aide={k !== "whatsapp" && lienKo(bloc[k]) ? t("lienInvalide") : undefined}>
              <input value={val(k)} inputMode={k === "whatsapp" ? "tel" : "url"} placeholder={k === "whatsapp" ? "+225 07 00 00 00 00" : "https://…"} onChange={set(k)} />
            </Champ>
          ))}
        </>
      );
    default:
      return null;
  }
};

const ProprietesImage = ({ bloc, maj, t }) => {
  const { tache } = useC();
  const depuisCloud = async () => {
    const node = await choisirFichierCloud({ titre: t("choisirImage"), filtre: "image" });
    if (node) maj({ nodeId: node.id, url: "", alt: bloc.alt || node.name.replace(/\.[a-z0-9]+$/i, "") });
  };
  const depuisOrdinateur = () =>
    tache(async () => {
      const fichier = await choisirImage();
      if (!fichier) return;
      // Réduite à la largeur d'un e-mail : 1200 px pour les écrans denses.
      const dataUrl = await redimensionnerImage(fichier, { cote: 1200, qualite: 0.85 });
      const blob = await (await fetch(dataUrl)).blob();
      const node = await saveToCloud(blob, `${fichier.name.replace(/\.[a-z0-9]+$/i, "")}.jpg`, { folder: "Campagnes" });
      if (node) maj({ nodeId: node.id, url: "", alt: bloc.alt || fichier.name.replace(/\.[a-z0-9]+$/i, "") });
    });
  return (
    <>
      <div className="cmpBoutonsLigne">
        <button type="button" className="cmpBtn" data-variante="secondaire" onClick={depuisCloud}><Icon fafa="faCloud" width={12} />{t("depuisCloud")}</button>
        <button type="button" className="cmpBtn" data-variante="secondaire" onClick={depuisOrdinateur}><Icon fafa="faUpload" width={12} />{t("depuisOrdinateur")}</button>
      </div>
      {bloc.nodeId ? <p className="cmpAide">{t("imageCloud")}</p> : null}
      <Champ label={t("ouAdresseImage")}><input value={bloc.url || ""} inputMode="url" placeholder="https://…/image.jpg" onChange={(e) => maj({ url: e.target.value, nodeId: "" })} /></Champ>
      <Champ label={t("texteAlternatif")} aide={t("texteAlternatifAide")}><input value={bloc.alt || ""} onChange={(e) => maj({ alt: e.target.value })} /></Champ>
      <Champ label={t("lienImage")}><input value={bloc.lien || ""} inputMode="url" placeholder="https://…" onChange={(e) => maj({ lien: e.target.value })} /></Champ>
    </>
  );
};

const ProprietesProduits = ({ bloc, maj, articles, argent, t }) => {
  const [recherche, setRecherche] = useState("");
  const produits = bloc.produits || [];
  const q = recherche.trim().toLowerCase();
  const actifs = useMemo(() => articles.filter((a) => !a.data.archive), [articles]);
  const visibles = actifs.filter((a) => !q || [a.data.designation, a.data.reference].some((v) => String(v || "").toLowerCase().includes(q))).slice(0, 30);
  const basculer = (a) => {
    const deja = produits.find((p) => p.articleId === a.id);
    if (deja) maj({ produits: produits.filter((p) => p.articleId !== a.id) });
    else if (produits.length < 6) maj({ produits: [...produits, { articleId: a.id, nom: a.data.designation, prix: a.data.prixVente ? argent(a.data.prixVente) : "", url: "" }] });
  };
  if (!actifs.length) return <p className="cmpAide">{t("produitsSansStock")}</p>;
  return (
    <>
      <label className="cmpCase"><input type="checkbox" checked={bloc.afficherPrix !== false} onChange={(e) => maj({ afficherPrix: e.target.checked })} /><span>{t("afficherPrix")}</span></label>
      {produits.map((p, i) => (
        <div key={p.articleId} className="cmpProduitChoisi">
          <b>{p.nom}</b>
          <input value={p.url || ""} inputMode="url" placeholder={t("lienProduit")} aria-label={t("lienProduit")} onChange={(e) => maj({ produits: produits.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
        </div>
      ))}
      <input className="cmpPetiteRecherche" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder={t("chercherArticle")} aria-label={t("chercherArticle")} />
      <div className="cmpListeArticles">
        {visibles.map((a) => (
          <label key={a.id} className="cmpCase">
            <input type="checkbox" checked={produits.some((p) => p.articleId === a.id)} disabled={!produits.some((p) => p.articleId === a.id) && produits.length >= 6} onChange={() => basculer(a)} />
            <span>{a.data.designation}</span>
            <small>{a.data.prixVente ? argent(a.data.prixVente) : ""}</small>
          </label>
        ))}
      </div>
      <small className="cmpAide">{t("produitsAide")}</small>
    </>
  );
};

/// Demande une adresse de test parmi les membres de l'équipe.
export const choisirAdressesTest = async ({ t, membres, session }) => {
  const toutes = membres.map((m) => m.email).filter(Boolean);
  const choix = await modal.open({
    title: t("envoyerTest"),
    render: ({ close }) => <ChoixTest t={t} adresses={toutes.length ? toutes : [session.user?.email].filter(Boolean)} defaut={session.user?.email} close={close} />,
  });
  return choix;
};

const ChoixTest = ({ t, adresses, defaut, close }) => {
  const [choisies, setChoisies] = useState(() => new Set([defaut].filter(Boolean)));
  return (
    <div className="cmpForm">
      <p className="cmpAide">{t("testAide")}</p>
      {adresses.slice(0, 20).map((a) => (
        <label key={a} className="cmpCase">
          <input type="checkbox" checked={choisies.has(a)} disabled={!choisies.has(a) && choisies.size >= 5} onChange={() => setChoisies((s) => { const x = new Set(s); if (x.has(a)) x.delete(a); else x.add(a); return x; })} />
          <span>{a}</span>
        </label>
      ))}
      <div className="cmpActionsForm">
        <button type="button" className="cmpBtn" data-variante="secondaire" onClick={() => close(null)}>{t("annuler")}</button>
        <button type="button" className="cmpBtn" data-variante="principal" disabled={!choisies.size} onClick={() => close([...choisies])}>{t("envoyer")}</button>
      </div>
    </div>
  );
};
