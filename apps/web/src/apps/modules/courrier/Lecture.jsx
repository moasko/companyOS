import React, { useEffect, useRef, useState } from "react";
import { api, apiFetch } from "../../../api/client";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import { iconeDeFichier } from "../../iconesFichiers";
import { applicationManquante, ouvrirFichier } from "../../openRequest";
import { ouvrirDossier } from "../../explorerRequest";
import { suivreLien } from "../../notifications";
import { formaterAdresse, nomAffiche, taillePiece } from "@companyos/shared/courrier";
import { initiales, noeudDePiece, quand, teinte } from "./outils";

// Lecture d'une conversation : les messages du fil, le dernier ouvert,
// les précédents repliés ; chaque corps HTML dans un cadre isolé.

const DISTANTES = /<img[^>]+src=["']?https?:/i;

/// Le HTML d'un courriel, dans un cadre sans scripts. Les images distantes
/// (souvent des pixels de suivi) ne se chargent que sur demande.
export const CadreHtml = ({ html, images }) => {
  const cadre = useRef(null);
  const [hauteur, setHauteur] = useState(120);
  const csp = `default-src 'none'; img-src data: ${images ? "https: http:" : ""}; style-src 'unsafe-inline'; font-src data:;`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
    html,body{margin:0;padding:0;background:#fff;color:#1f2733;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;overflow-wrap:anywhere}
    body{padding:2px 2px 8px}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0 0 0 .8ex;border-left:2px solid #d0d5dd;padding-left:1ex;color:#5b6573}
    a{color:#1a56c4}pre{white-space:pre-wrap}</style></head><body>${html}</body></html>`;

  useEffect(() => {
    const f = cadre.current;
    if (!f) return undefined;
    let obs;
    const mesurer = () => {
      const corps = f.contentDocument?.documentElement;
      if (corps) setHauteur(Math.min(20000, Math.max(60, corps.scrollHeight + 4)));
    };
    const charge = () => {
      mesurer();
      try {
        obs = new ResizeObserver(mesurer);
        obs.observe(f.contentDocument.body);
      } catch {
        // navigateur sans ResizeObserver : la mesure au chargement suffit
      }
    };
    f.addEventListener("load", charge);
    return () => {
      f.removeEventListener("load", charge);
      obs?.disconnect();
    };
  }, [html, images]);

  return (
    <iframe
      ref={cadre}
      className="crrCadre"
      title="Contenu du courriel"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ height: hauteur }}
    />
  );
};

const telecharger = async (p) => {
  const r = await apiFetch(api.downloadUrl(p.fsNodeId), {});
  if (!r.ok) throw new Error("Téléchargement impossible");
  const url = URL.createObjectURL(await r.blob());
  const lien = Object.assign(document.createElement("a"), { href: url, download: p.nom });
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const ouvrirPiece = (p) => {
  const noeud = noeudDePiece(p);
  if (ouvrirFichier(noeud)) return;
  if (applicationManquante(noeud)) {
    modal.alert({ title: "Application à installer", message: `« ${p.nom} » s'ouvre avec une application qui n'est pas installée. Ouvrez-le depuis l'Explorateur pour l'installer.` });
    return;
  }
  telecharger(p).catch((e) => modal.alert({ title: "Ouverture impossible", message: e.message, tone: "error" }));
};

export const CartesPieces = ({ pieces }) =>
  pieces?.length ? (
    <div className="crrPieces">
      <div className="crrPiecesTitre">
        Pièces jointes <span>{pieces.length}</span>
      </div>
      <div className="crrPiecesGrille">
        {pieces.map((p, i) => (
          <div key={p.fsNodeId || `${p.nom}-${i}`} className="crrCartePiece" data-indispo={!p.fsNodeId}>
            <img src={`img/icon/cos/${iconeDeFichier({ type: "FILE", name: p.nom, mimeType: p.type })}.svg`} alt="" width={30} />
            <span className="crrCartePieceTexte">
              <strong title={p.nom}>{p.nom}</strong>
              <small>
                {p.taille ? taillePiece(p.taille) : ""}
                {p.fsNodeId ? (
                  <>
                    {p.taille ? " · " : ""}
                    <button type="button" onClick={() => ouvrirPiece(p)}>
                      Ouvrir
                    </button>
                    <button type="button" onClick={() => telecharger(p).catch((e) => modal.alert({ title: "Téléchargement impossible", message: e.message, tone: "error" }))}>
                      Télécharger
                    </button>
                  </>
                ) : (
                  ` · ${p.erreur || "indisponible"}`
                )}
              </small>
            </span>
          </div>
        ))}
      </div>
      {pieces.some((p) => p.fsNodeId) ? (
        <button
          type="button"
          className="crrLienDiscret"
          onClick={async () => {
            const id = pieces.find((p) => p.fsNodeId).fsNodeId;
            const arbre = await api.arborescence().catch(() => null);
            ouvrirDossier(arbre?.noeuds?.find((n) => n.id === id)?.parentId || null);
          }}
        >
          <Icon fafa="faFolderOpen" width={10} /> Voir dans l'Explorateur
        </button>
      ) : null}
    </div>
  ) : null;

const LIBELLES_APPS = { projets: "Projets", agenda: "Agenda", crm: "CRM", facturation: "Facturation" };

const Message = ({ m, ouvert, onBasculer, onRepondre, onTransferer, images, setImages }) => {
  const de = m.de || {};
  const html = m.html || null;
  const distantes = html && DISTANTES.test(html);
  return (
    <article className="crrMessage" data-ouvert={ouvert}>
      <header className="crrMessageTete" onClick={onBasculer}>
        <span className="crrAvatar" style={{ background: teinte(de.email) }}>
          {initiales(de)}
        </span>
        <div className="crrMessageQui">
          <div className="crrMessageNom">
            <strong>{nomAffiche(de)}</strong>
            {ouvert ? <span className="crrMessageEmail">{de.email}</span> : null}
            {m.statut === "echec" ? <span className="crrEtat" data-ton="echec">Non envoyé</span> : null}
            {m.statut === "programme" ? <span className="crrEtat" data-ton="programme">Programmé {quand(m.envoiLe)}</span> : null}
          </div>
          {ouvert ? (
            <div className="crrMessageA">
              À {(m.a || []).map((x) => nomAffiche(x)).join(", ") || "—"}
              {m.cc?.length ? ` · Cc ${m.cc.map((x) => nomAffiche(x)).join(", ")}` : ""}
            </div>
          ) : (
            <div className="crrMessageExtrait">{m.extrait}</div>
          )}
        </div>
        <time className="crrMessageDate" dateTime={m.date}>
          {quand(m.date)}
        </time>
        {ouvert ? (
          <span className="crrMessageActions" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="crrIconeBtn" title="Répondre" onClick={() => onRepondre(m)}>
              <Icon fafa="faReply" width={12} />
            </button>
            <button type="button" className="crrIconeBtn" title="Transférer" onClick={() => onTransferer(m)}>
              <Icon fafa="faShare" width={12} />
            </button>
          </span>
        ) : null}
      </header>
      {ouvert ? (
        <div className="crrMessageCorps">
          {m.erreur ? <div className="crrAlerte">Le relais a refusé ce message : {m.erreur}</div> : null}
          {distantes && !images ? (
            <div className="crrBandeau">
              <Icon fafa="faImage" width={11} />
              Images distantes masquées pour protéger votre vie privée.
              <button type="button" onClick={() => setImages(true)}>
                Afficher
              </button>
            </div>
          ) : null}
          {html ? <CadreHtml html={html} images={images} /> : <div className="crrTexte">{m.texte}</div>}
          <CartesPieces pieces={m.pieces} />
        </div>
      ) : null}
    </article>
  );
};

export const Lecture = ({ fil, conversation, onRepondre, onRepondreTous, onTransferer, onAction, onSuivi, contexteOuvert, onContexte, telephone, onRetour, enfant }) => {
  const [ouverts, setOuverts] = useState(() => new Set());
  const [images, setImages] = useState(false);
  const fin = useRef(null);
  const messages = fil?.messages || [];
  const dernier = messages[messages.length - 1];

  useEffect(() => {
    setOuverts(new Set(dernier ? [dernier.id, ...messages.filter((m) => !m.lu).map((m) => m.id)] : []));
    setImages(false);
  }, [fil]);

  if (!fil) return null;
  const premier = messages[0];
  const liens = messages.flatMap((m) => m.liens || []).filter((l, i, t) => t.findIndex((x) => x.app === l.app && x.id === l.id) === i);
  const suivi = messages.some((m) => m.suivi);
  const dossier = conversation?.dossier || dernier?.dossier;

  return (
    <div className="crrLecture">
      <div className="crrLectureBarre">
        {telephone ? (
          <button type="button" className="crrIconeBtn" aria-label="Retour" onClick={onRetour}>
            <Icon fafa="faArrowLeft" width={13} />
          </button>
        ) : null}
        <button type="button" className="crrAction" onClick={() => onRepondre(dernier)}>
          <Icon fafa="faReply" width={11} /> <span>Répondre</span>
        </button>
        <button type="button" className="crrAction" onClick={() => onRepondreTous(dernier)}>
          <Icon fafa="faReplyAll" width={11} /> <span>Répondre à tous</span>
        </button>
        <button type="button" className="crrAction" onClick={() => onTransferer(dernier)}>
          <Icon fafa="faShare" width={11} /> <span>Transférer</span>
        </button>
        <span className="crrPiedEspace" />
        <button type="button" className="crrIconeBtn" title={suivi ? "Ne plus suivre" : "Suivre"} data-actif={suivi} onClick={() => onSuivi(!suivi)}>
          <Icon fafa="faStar" width={13} />
        </button>
        {dossier !== "archives" ? (
          <button type="button" className="crrIconeBtn" title="Archiver (E)" onClick={() => onAction("archiver")}>
            <Icon fafa="faBoxArchive" width={13} />
          </button>
        ) : (
          <button type="button" className="crrIconeBtn" title="Remettre en boîte de réception" onClick={() => onAction("reception")}>
            <Icon fafa="faInbox" width={13} />
          </button>
        )}
        <button type="button" className="crrIconeBtn" title="Marquer comme non lu (U)" onClick={() => onAction("nonlu")}>
          <Icon fafa="faEnvelope" width={13} />
        </button>
        {dossier === "corbeille" ? (
          <button type="button" className="crrIconeBtn" title="Restaurer" onClick={() => onAction("reception")}>
            <Icon fafa="faTrashArrowUp" width={13} />
          </button>
        ) : (
          <button type="button" className="crrIconeBtn" title="Mettre à la corbeille (#)" onClick={() => onAction("corbeille")}>
            <Icon fafa="faTrashCan" width={13} />
          </button>
        )}
        {!telephone ? (
          <button type="button" className="crrIconeBtn" title={contexteOuvert ? "Masquer le volet du correspondant" : "Volet du correspondant"} data-actif={contexteOuvert} onClick={onContexte}>
            <Icon fafa="faAddressCard" width={13} />
          </button>
        ) : null}
      </div>

      <div className="crrLectureDefile cosScroll">
        <h2 className="crrLectureSujet">
          {premier?.sujet || "(sans sujet)"}
          {messages.length > 1 ? <span className="crrCompte">{messages.length}</span> : null}
        </h2>
        {liens.length ? (
          <div className="crrLiens">
            {liens.map((l) => (
              <button type="button" key={`${l.app}-${l.id}`} className="crrPuceLien" onClick={() => suivreLien({ lien: { app: l.app, params: l.app === "projets" ? { carte: l.id } : l.app === "crm" ? { client: l.id } : l.app === "facturation" ? { facture: l.id } : { id: l.id } } })}>
                <Icon fafa={l.app === "projets" ? "faTableColumns" : l.app === "agenda" ? "faCalendarDays" : l.app === "crm" ? "faUserTie" : "faLink"} width={10} />
                {LIBELLES_APPS[l.app] || l.app} · {l.libelle || "fiche"}
              </button>
            ))}
          </div>
        ) : null}
        <div className="crrFil">
          {messages.map((m) => (
            <Message
              key={m.id}
              m={m}
              ouvert={ouverts.has(m.id)}
              images={images}
              setImages={setImages}
              onBasculer={() =>
                setOuverts((s) => {
                  const n = new Set(s);
                  if (n.has(m.id)) n.delete(m.id);
                  else n.add(m.id);
                  return n;
                })
              }
              onRepondre={onRepondre}
              onRepondreTous={onRepondreTous}
              onTransferer={onTransferer}
            />
          ))}
        </div>
        {enfant ? <div className="crrReponse">{enfant}</div> : null}
        <div ref={fin} />
      </div>
    </div>
  );
};

/// « Awa <awa@…> » pour le tooltip d'une puce.
export const etiquetteAdresse = (x) => formaterAdresse(x);
