import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import { iconeDeFichier } from "../../iconesFichiers";
import { adresseValide, htmlDeTexte, listeAdresses, nomAffiche, taillePiece, texteDeHtml } from "@companyos/shared/courrier";
import { ChoixFichier } from "./ChoixFichier";
import { EMOJIS, PROGRAMMATIONS, dossierPiecesEnvoyees, initiales, quand, teinte } from "./outils";

// Le composeur : intégré sous une conversation (réponse), ou en plein
// volet (nouveau message). Brouillon enregistré tout seul, envoi annulable
// pendant 5 secondes, ou programmé.

const PIECES_MAX = 10;
const DELAI_ANNULATION = 5;

// ---- Destinataires en pastilles ------------------------------------------------

const ChampAdresses = ({ libelle, valeur, onChange, autoFocus, suffixe }) => {
  const [saisie, setSaisie] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [actif, setActif] = useState(0);
  const champ = useRef(null);

  useEffect(() => {
    const q = saisie.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let vivant = true;
    const t = setTimeout(async () => {
      const r = await api.messagerie.contacts(q).catch(() => []);
      if (vivant) {
        setSuggestions((Array.isArray(r) ? r : []).filter((c) => !valeur.some((v) => v.email === c.email)).slice(0, 7));
        setActif(0);
      }
    }, 180);
    return () => {
      vivant = false;
      clearTimeout(t);
    };
  }, [saisie, valeur]);

  const ajouter = (brut) => {
    const nouvelles = listeAdresses(brut).filter((a) => !valeur.some((v) => v.email === a.email));
    if (nouvelles.length) onChange([...valeur, ...nouvelles]);
    setSaisie("");
    setSuggestions([]);
  };

  const choisir = (c) => {
    onChange([...valeur, { nom: c.nom, email: c.email }]);
    setSaisie("");
    setSuggestions([]);
    champ.current?.focus();
  };

  return (
    <div className="crrAdresses" onClick={() => champ.current?.focus()}>
      <span className="crrAdressesLibelle">{libelle}</span>
      <div className="crrAdressesListe">
        {valeur.map((a) => (
          <span key={a.email} className="crrPuce" data-invalide={!adresseValide(a.email)} title={a.email}>
            <span className="crrAvatar crrAvatarMini" style={{ background: teinte(a.email) }}>
              {initiales(a)}
            </span>
            <span className="crrPuceNom">{nomAffiche(a)}</span>
            <button type="button" aria-label={`Retirer ${a.email}`} onClick={(e) => (e.stopPropagation(), onChange(valeur.filter((v) => v.email !== a.email)))}>
              <Icon fafa="faXmark" width={9} />
            </button>
          </span>
        ))}
        <input
          ref={champ}
          value={saisie}
          autoFocus={autoFocus}
          aria-label={libelle}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]\s*$/.test(v)) ajouter(v.replace(/[,;]\s*$/, ""));
            else setSaisie(v);
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[,;\n]/.test(t)) {
              e.preventDefault();
              ajouter(t.replace(/\n/g, ","));
            }
          }}
          onKeyDown={(e) => {
            if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setActif((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
            } else if ((e.key === "Enter" || e.key === "Tab") && suggestions.length && saisie.trim()) {
              e.preventDefault();
              choisir(suggestions[actif]);
            } else if ((e.key === "Enter" || e.key === "Tab") && saisie.trim()) {
              e.preventDefault();
              ajouter(saisie);
            } else if (e.key === "Backspace" && !saisie && valeur.length) {
              onChange(valeur.slice(0, -1));
            }
          }}
          onBlur={() => setTimeout(() => saisie.trim() && ajouter(saisie), 150)}
        />
      </div>
      {suffixe}
      {suggestions.length ? (
        <div className="crrSuggestions" role="listbox">
          {suggestions.map((c, i) => (
            <div
              key={c.email}
              role="option"
              aria-selected={i === actif}
              className="crrSuggestion"
              data-actif={i === actif}
              onMouseDown={(e) => {
                e.preventDefault();
                choisir(c);
              }}
            >
              <span className="crrAvatar crrAvatarMini" style={{ background: teinte(c.email) }}>
                {initiales(c)}
              </span>
              <span className="crrSuggestionTexte">
                <strong>{c.nom || c.email}</strong>
                <small>{c.email}</small>
              </span>
              <span className="crrSource">{c.source}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

// ---- Éditeur riche ----------------------------------------------------------------

const commande = (cmd, valeur = null) => document.execCommand(cmd, false, valeur);

const BarreFormat = ({ onLien, flottante, style }) => (
  <div className={flottante ? "crrFormat crrFormatFlottant" : "crrFormat"} style={style} onMouseDown={(e) => e.preventDefault()}>
    <button type="button" title="Gras (Ctrl+B)" onClick={() => commande("bold")}>
      <Icon fafa="faBold" width={11} />
    </button>
    <button type="button" title="Italique (Ctrl+I)" onClick={() => commande("italic")}>
      <Icon fafa="faItalic" width={11} />
    </button>
    <button type="button" title="Souligné (Ctrl+U)" onClick={() => commande("underline")}>
      <Icon fafa="faUnderline" width={11} />
    </button>
    <button type="button" title="Barré" onClick={() => commande("strikeThrough")}>
      <Icon fafa="faStrikethrough" width={11} />
    </button>
    <button type="button" title="Lien" onClick={onLien}>
      <Icon fafa="faLink" width={11} />
    </button>
    {!flottante ? (
      <>
        <span className="crrFormatSep" />
        <button type="button" title="Liste à puces" onClick={() => commande("insertUnorderedList")}>
          <Icon fafa="faListUl" width={11} />
        </button>
        <button type="button" title="Liste numérotée" onClick={() => commande("insertOrderedList")}>
          <Icon fafa="faListOl" width={11} />
        </button>
        <button type="button" title="Citation" onClick={() => commande("formatBlock", "blockquote")}>
          <Icon fafa="faQuoteRight" width={11} />
        </button>
        <button type="button" title="Effacer la mise en forme" onClick={() => commande("removeFormat")}>
          <Icon fafa="faEraser" width={11} />
        </button>
      </>
    ) : null}
  </div>
);

// ---- Composeur ------------------------------------------------------------------------

export const Composeur = ({ initial, boites = [], modeles = [], variante = "plein", onFerme, onEnvoye, onBrouillon }) => {
  const [a, setA] = useState(initial.a || []);
  const [cc, setCc] = useState(initial.cc || []);
  const [cci, setCci] = useState(initial.cci || []);
  const [avecCc, setAvecCc] = useState(!!initial.cc?.length);
  const [avecCci, setAvecCci] = useState(!!initial.cci?.length);
  const [sujet, setSujet] = useState(initial.sujet || "");
  const [pieces, setPieces] = useState(initial.pieces || []);
  const [boiteId, setBoiteId] = useState(initial.boiteId ?? boites.find((b) => b.mienne)?.id ?? boites[0]?.id ?? null);
  const [brouillonId, setBrouillonId] = useState(initial.brouillonId || null);
  const [etatSauvegarde, setEtatSauvegarde] = useState(initial.brouillonId ? "Brouillon" : "");
  const [barre, setBarre] = useState(false);
  const [flottante, setFlottante] = useState(null);
  const [menu, setMenu] = useState(null); // "programmer" | "emoji" | null
  const [compteARebours, setCompteARebours] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [import_, setImport] = useState(null);
  const [survol, setSurvol] = useState(false);
  const editeur = useRef(null);
  const sale = useRef(false);
  const minuteurSauvegarde = useRef(null);
  const minuteurEnvoi = useRef(null);
  const plage = useRef(null);
  const fichierInput = useRef(null);
  const etat = useRef({});

  // L'éditeur n'est pas contrôlé : son contenu initial est posé une fois.
  useEffect(() => {
    if (editeur.current) editeur.current.innerHTML = initial.html || (initial.texte ? htmlDeTexte(initial.texte) : "<p><br></p>");
    if (variante === "integre" && editeur.current) {
      // Curseur au début, au-dessus de la citation.
      const r = document.createRange();
      r.setStart(editeur.current, 0);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      editeur.current.focus();
    }
  }, []);

  const message = useCallback(
    () => ({
      boiteId: boiteId || null,
      a,
      cc,
      cci,
      sujet,
      html: editeur.current?.innerHTML || "",
      piecesIds: pieces.map((p) => p.fsNodeId).filter(Boolean),
      inReplyTo: initial.inReplyTo || null,
      references: initial.references || [],
      filId: initial.filId || null,
      liens: initial.liens || [],
    }),
    [boiteId, a, cc, cci, sujet, pieces, initial],
  );
  etat.current = { message, brouillonId };

  const enregistrer = useCallback(async () => {
    if (!sale.current) return;
    const { message: m, brouillonId: id } = etat.current;
    const msg = m();
    const vide = !msg.a.length && !msg.sujet.trim() && !texteDeHtml(msg.html).trim() && !msg.piecesIds.length;
    if (vide) return;
    sale.current = false;
    setEtatSauvegarde("Enregistrement…");
    try {
      const r = id ? await api.messagerie.majBrouillon(id, msg) : await api.messagerie.creerBrouillon(msg);
      if (!id) setBrouillonId(r.id);
      setEtatSauvegarde(`Brouillon enregistré ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`);
      onBrouillon?.();
    } catch (e) {
      sale.current = true;
      setEtatSauvegarde(`Brouillon non enregistré : ${e.message}`);
    }
  }, [onBrouillon]);

  const modifie = () => {
    sale.current = true;
    clearTimeout(minuteurSauvegarde.current);
    minuteurSauvegarde.current = setTimeout(enregistrer, 2500);
  };

  // Chaque changement de champ relance la sauvegarde différée.
  const premier = useRef(true);
  useEffect(() => {
    if (premier.current) {
      premier.current = false;
      return;
    }
    modifie();
  }, [a, cc, cci, sujet, pieces, boiteId]);

  // En quittant : on enregistre ce qui ne l'est pas encore.
  useEffect(
    () => () => {
      clearTimeout(minuteurSauvegarde.current);
      clearTimeout(minuteurEnvoi.current);
      if (sale.current) enregistrer();
    },
    [enregistrer],
  );

  // ---- Barre flottante sur sélection ----
  const suivreSelection = () => {
    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed || !editeur.current?.contains(sel.anchorNode)) return setFlottante(null);
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const cadre = editeur.current.closest(".crrComposeur").getBoundingClientRect();
    setFlottante({ left: Math.max(8, r.left - cadre.left + r.width / 2 - 90), top: r.top - cadre.top - 42 });
  };

  const memoriserPlage = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && editeur.current?.contains(sel.anchorNode)) plage.current = sel.getRangeAt(0).cloneRange();
  };
  const restaurerPlage = () => {
    editeur.current?.focus();
    if (!plage.current) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(plage.current);
  };

  const lien = async () => {
    memoriserPlage();
    const url = await modal.prompt({ title: "Insérer un lien", label: "Adresse", placeholder: "https://", confirmLabel: "Insérer" });
    if (!url) return;
    restaurerPlage();
    const propre = /^(https?:|mailto:|tel:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    if (window.getSelection()?.isCollapsed) commande("insertHTML", `<a href="${propre.replace(/"/g, "%22")}">${propre.replace(/</g, "&lt;")}</a>`);
    else commande("createLink", propre);
    modifie();
  };

  const emoji = (e) => {
    restaurerPlage();
    commande("insertText", e);
    setMenu(null);
    modifie();
  };

  // ---- Pièces jointes ----
  const ajouterPieces = (liste) =>
    setPieces((p) => {
      const out = [...p];
      for (const x of liste) if (!out.some((y) => y.fsNodeId === x.fsNodeId)) out.push(x);
      return out.slice(0, PIECES_MAX);
    });

  const depuisCloud = async () => {
    const noeuds = await modal.open({
      title: "Joindre depuis le Cloud",
      render: ({ close }) => <ChoixFichier dejaPris={pieces.map((p) => p.fsNodeId)} placesLibres={PIECES_MAX - pieces.length} onValider={close} />,
    });
    if (noeuds?.length) ajouterPieces(noeuds.map((n) => ({ fsNodeId: n.id, nom: n.name, taille: Number(n.size) || 0, type: n.mimeType })));
  };

  const depuisOrdinateur = async (fichiers) => {
    const liste = [...(fichiers || [])].slice(0, PIECES_MAX - pieces.length);
    if (!liste.length) return;
    try {
      const dossier = await dossierPiecesEnvoyees();
      for (let i = 0; i < liste.length; i++) {
        setImport(`Import de « ${liste[i].name} » (${i + 1}/${liste.length})…`);
        const n = await api.uploadFile(liste[i], dossier, { conflit: "renommer" });
        ajouterPieces([{ fsNodeId: n.id, nom: n.name, taille: Number(n.size) || liste[i].size, type: n.mimeType }]);
      }
    } catch (e) {
      modal.alert({ title: "Pièce jointe impossible", message: e.message, tone: "error" });
    } finally {
      setImport(null);
    }
  };

  // ---- Modèles ----
  const appliquerModele = async () => {
    const m = await modal.open({
      title: "Insérer un modèle",
      render: ({ close }) => (
        <div className="crrModeles cosScroll">
          {modeles.map((x) => (
            <button type="button" key={x.id} className="crrModeleChoix" onClick={() => close(x)}>
              <strong>{x.data.nom}</strong>
              <small>{x.data.sujet}</small>
            </button>
          ))}
        </div>
      ),
    });
    if (!m) return;
    if (!sujet.trim()) setSujet(m.data.sujet || "");
    restaurerPlage();
    commande("insertHTML", htmlDeTexte(m.data.texte || ""));
    modifie();
  };

  // ---- Envoi ----
  const verifier = () => {
    const m = message();
    if (!m.a.length) return "Ajoutez au moins un destinataire.";
    const invalide = [...m.a, ...m.cc, ...m.cci].find((x) => !adresseValide(x.email));
    if (invalide) return `Adresse invalide : ${invalide.email}`;
    if (!m.sujet.trim()) return "Ajoutez un objet.";
    if (!texteDeHtml(m.html).trim() && !m.piecesIds.length) return "Le message est vide.";
    return null;
  };

  const partir = async (envoiLe = null) => {
    setEnvoi(true);
    clearTimeout(minuteurSauvegarde.current);
    sale.current = false;
    try {
      const r = await api.messagerie.envoyer({ ...message(), brouillonId, envoiLe: envoiLe ? envoiLe.toISOString() : null });
      onEnvoye?.(r, envoiLe);
    } catch (e) {
      sale.current = true;
      setEnvoi(false);
      setCompteARebours(null);
      modal.alert({ title: envoiLe ? "Programmation impossible" : "Envoi impossible", message: e.message, tone: "error" });
    }
  };

  const envoyer = () => {
    const probleme = verifier();
    if (probleme) return modal.alert({ title: "Pas encore prêt", message: probleme, tone: "warning" });
    // Quelques secondes pour se raviser : la pièce jointe oubliée, le
    // mauvais destinataire.
    let n = DELAI_ANNULATION;
    setCompteARebours(n);
    const tic = () => {
      n -= 1;
      if (n <= 0) {
        setCompteARebours(0);
        partir();
      } else {
        setCompteARebours(n);
        minuteurEnvoi.current = setTimeout(tic, 1000);
      }
    };
    minuteurEnvoi.current = setTimeout(tic, 1000);
  };

  const annulerEnvoi = () => {
    clearTimeout(minuteurEnvoi.current);
    setCompteARebours(null);
  };

  const programmer = async (date) => {
    setMenu(null);
    const probleme = verifier();
    if (probleme) return modal.alert({ title: "Pas encore prêt", message: probleme, tone: "warning" });
    let d = date;
    if (!d) {
      const saisie = await modal.open({
        title: "Programmer l'envoi",
        render: ({ close }) => <ChoixDate onValider={close} />,
      });
      if (!saisie) return;
      d = new Date(saisie);
    }
    partir(d);
  };

  const abandonner = async () => {
    clearTimeout(minuteurSauvegarde.current);
    if (brouillonId) {
      const ok = await modal.confirm({ title: "Supprimer ce brouillon ?", message: "Le message en cours sera perdu.", confirmLabel: "Supprimer", danger: true });
      if (!ok) return;
      sale.current = false;
      await api.messagerie.supprimer(brouillonId).catch(() => {});
      onBrouillon?.();
    }
    sale.current = false;
    onFerme?.();
  };

  const boite = boites.find((b) => b.id === boiteId);

  return (
    <div
      className="crrComposeur"
      data-variante={variante}
      data-survol={survol}
      onDragOver={(e) => {
        if ([...(e.dataTransfer?.types || [])].includes("Files")) {
          e.preventDefault();
          setSurvol(true);
        }
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setSurvol(false)}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        setSurvol(false);
        depuisOrdinateur(e.dataTransfer.files);
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          envoyer();
        }
      }}
    >
      {variante === "plein" ? (
        <div className="crrComposeurTete">
          <h3>{initial.titre || "Nouveau message"}</h3>
          <span className="crrSauvegarde">{etatSauvegarde}</span>
          <button type="button" className="crrIconeBtn" aria-label="Fermer" onClick={() => (enregistrer(), onFerme?.())}>
            <Icon fafa="faXmark" width={12} />
          </button>
        </div>
      ) : null}

      {boites.length > 1 ? (
        <div className="crrLigneChamp">
          <span className="crrAdressesLibelle">De</span>
          <select value={boiteId || ""} onChange={(e) => setBoiteId(e.target.value || null)} aria-label="Boîte d'envoi">
            {boites.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nom} — {b.adresse}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <ChampAdresses
        libelle="À"
        valeur={a}
        onChange={setA}
        autoFocus={variante === "plein" && !a.length}
        suffixe={
          <span className="crrCcBcc">
            {!avecCc ? (
              <button type="button" onClick={() => setAvecCc(true)}>
                Cc
              </button>
            ) : null}
            {!avecCci ? (
              <button type="button" onClick={() => setAvecCci(true)}>
                Cci
              </button>
            ) : null}
          </span>
        }
      />
      {avecCc ? <ChampAdresses libelle="Cc" valeur={cc} onChange={setCc} /> : null}
      {avecCci ? <ChampAdresses libelle="Cci" valeur={cci} onChange={setCci} /> : null}

      <div className="crrLigneChamp">
        <span className="crrAdressesLibelle">Objet</span>
        <input className="crrSujet" value={sujet} aria-label="Objet" placeholder="Objet du message" onChange={(e) => setSujet(e.target.value)} />
      </div>

      {barre ? <BarreFormat onLien={lien} /> : null}

      <div className="crrEditeurCadre">
        {flottante ? <BarreFormat flottante onLien={lien} style={flottante} /> : null}
        <div
          ref={editeur}
          className="crrEditeur cosScroll"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Message"
          data-placeholder="Écrivez votre message…"
          onInput={modifie}
          onMouseUp={suivreSelection}
          onKeyUp={(e) => {
            suivreSelection();
            memoriserPlage();
            if (e.key === "Escape") setFlottante(null);
          }}
          onBlur={() => {
            memoriserPlage();
            setTimeout(() => setFlottante(null), 150);
          }}
        />
      </div>

      {pieces.length || import_ ? (
        <div className="crrPiecesComposeur">
          {pieces.map((p) => (
            <div key={p.fsNodeId} className="crrCartePiece">
              <img src={`img/icon/cos/${iconeDeFichier({ type: "FILE", name: p.nom, mimeType: p.type })}.svg`} alt="" width={26} />
              <span className="crrCartePieceTexte">
                <strong title={p.nom}>{p.nom}</strong>
                <small>{taillePiece(p.taille)}</small>
              </span>
              <button type="button" className="crrIconeBtn" aria-label={`Retirer ${p.nom}`} onClick={() => setPieces((l) => l.filter((x) => x.fsNodeId !== p.fsNodeId))}>
                <Icon fafa="faXmark" width={10} />
              </button>
            </div>
          ))}
          {import_ ? <div className="crrImport">{import_}</div> : null}
        </div>
      ) : null}

      {survol ? (
        <div className="crrDepot">
          <Icon fafa="faCloudArrowUp" width={22} />
          Déposez pour joindre — les fichiers sont aussi rangés dans le Cloud
        </div>
      ) : null}

      <div className="crrComposeurPied">
        <button type="button" className="crrIconeBtn" title={brouillonId ? "Supprimer le brouillon" : "Abandonner"} onClick={abandonner}>
          <Icon fafa="faTrashCan" width={13} />
        </button>
        {variante === "integre" ? <span className="crrSauvegarde">{etatSauvegarde}</span> : null}
        <span className="crrPiedEspace" />
        <button type="button" className="crrIconeBtn" data-actif={barre} title="Mise en forme" onClick={() => setBarre((v) => !v)}>
          <Icon fafa="faFont" width={13} />
        </button>
        {modeles.length ? (
          <button type="button" className="crrIconeBtn" title="Insérer un modèle" onClick={appliquerModele}>
            <Icon fafa="faClone" width={13} />
          </button>
        ) : null}
        <button type="button" className="crrIconeBtn" title="Insérer un lien" onClick={lien}>
          <Icon fafa="faLink" width={13} />
        </button>
        <span className="crrMenuHote">
          <button type="button" className="crrIconeBtn" title="Émoticônes" onMouseDown={memoriserPlage} onClick={() => setMenu(menu === "emoji" ? null : "emoji")}>
            <Icon fafa="faFaceSmile" width={13} />
          </button>
          {menu === "emoji" ? (
            <div className="crrPopover crrEmojis">
              {EMOJIS.map((e) => (
                <button type="button" key={e} onMouseDown={(ev) => ev.preventDefault()} onClick={() => emoji(e)}>
                  {e}
                </button>
              ))}
            </div>
          ) : null}
        </span>
        <button type="button" className="crrIconeBtn" title="Joindre depuis le Cloud" disabled={pieces.length >= PIECES_MAX} onClick={depuisCloud}>
          <Icon fafa="faCloud" width={13} />
        </button>
        <button type="button" className="crrIconeBtn" title="Joindre depuis l'ordinateur" disabled={pieces.length >= PIECES_MAX} onClick={() => fichierInput.current?.click()}>
          <Icon fafa="faPaperclip" width={13} />
        </button>
        <input ref={fichierInput} type="file" multiple hidden onChange={(e) => (depuisOrdinateur(e.target.files), (e.target.value = ""))} />

        {compteARebours != null ? (
          <div className="crrEnvoiAttente" role="status">
            {compteARebours > 0 ? `Envoi dans ${compteARebours} s` : "Envoi…"}
            {compteARebours > 0 ? (
              <button type="button" onClick={annulerEnvoi}>
                Annuler
              </button>
            ) : null}
          </div>
        ) : (
          <span className="crrEnvoyerGroupe crrMenuHote">
            <button type="button" className="crrEnvoyer" disabled={envoi} onClick={envoyer} title="Envoyer (Ctrl+Entrée)">
              {boite && boites.length > 1 ? `Envoyer depuis ${boite.adresse.split("@")[0]}` : "Envoyer"}
            </button>
            <button type="button" className="crrEnvoyerPlus" disabled={envoi} aria-label="Programmer l'envoi" title="Programmer l'envoi" onClick={() => setMenu(menu === "programmer" ? null : "programmer")}>
              <Icon fafa="faClock" width={12} />
            </button>
            {menu === "programmer" ? (
              <div className="crrPopover crrProgrammer">
                <div className="crrPopoverTitre">Programmer l'envoi</div>
                {PROGRAMMATIONS().map((p) => (
                  <button type="button" key={p.libelle} onClick={() => programmer(p.date)}>
                    <span>{p.libelle}</span>
                    <small>{quand(p.date)}</small>
                  </button>
                ))}
                <button type="button" onClick={() => programmer(null)}>
                  <span>Choisir la date et l'heure…</span>
                </button>
              </div>
            ) : null}
          </span>
        )}
      </div>
    </div>
  );
};

const ChoixDate = ({ onValider }) => {
  const demain = new Date(Date.now() + 86400_000);
  demain.setHours(8, 0, 0, 0);
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [v, setV] = useState(local(demain));
  const ok = new Date(v) > new Date();
  return (
    <div className="crrChoixDate">
      <input type="datetime-local" value={v} min={local(new Date())} onChange={(e) => setV(e.target.value)} />
      <button type="button" className="crrEnvoyer" disabled={!ok} onClick={() => onValider(v)}>
        Programmer
      </button>
    </div>
  );
};
