import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../utils/general";
import { subscribeModals, closeModal } from "./modalRequest";
import { creerTraducteur } from "../utils/intl";
import "./modal.scss";

/// Boîtes de dialogue générales de CompanyOS. Rendu unique, monté au
/// niveau de App : tout le code applicatif passe par `modal.confirm` et
/// consorts (voir `modalRequest.js`) plutôt que par `window.confirm`, qui
/// bloque le fil d'exécution et ignore le thème de l'OS.

// Valeur avec laquelle une boîte se résout quand elle est écartée sans
// décision (Échap, clic sur le fond, croix) : on prend toujours l'issue
// la plus prudente.
const DISMISS = { confirm: false, alert: true, prompt: null, custom: null };

// Les libellés par défaut suivent la langue de l'OS ; un appelant qui
// passe confirmLabel/cancelLabel garde évidemment le sien.
const LIBELLES = {
  fr: { confirmer: "Confirmer", annuler: "Annuler", ok: "OK", valider: "Valider" },
  en: { confirmer: "Confirm", annuler: "Cancel", ok: "OK", valider: "Save" },
};
const tLibelle = creerTraducteur(LIBELLES);

const DEFAULTS = () => ({
  confirm: { confirmLabel: tLibelle("confirmer"), cancelLabel: tLibelle("annuler"), icon: "faCircleQuestion" },
  alert: { confirmLabel: tLibelle("ok"), cancelLabel: null, icon: "faCircleInfo" },
  prompt: { confirmLabel: tLibelle("valider"), cancelLabel: tLibelle("annuler"), icon: "faPenToSquare" },
  custom: { confirmLabel: null, cancelLabel: null, icon: null },
});

const TONE_ICONS = {
  success: "faCircleCheck",
  warning: "faTriangleExclamation",
  error: "faCircleExclamation",
};

const ModalBox = ({ entry, top }) => {
  const kind = entry.kind || "confirm";
  const defauts = DEFAULTS();
  const base = defauts[kind] || defauts.confirm;
  const tone = entry.danger ? "error" : entry.tone || "info";
  const icon = entry.icon || TONE_ICONS[tone] || base.icon;
  const confirmLabel =
    entry.confirmLabel !== undefined ? entry.confirmLabel : base.confirmLabel;
  const cancelLabel =
    entry.cancelLabel !== undefined ? entry.cancelLabel : base.cancelLabel;
  const required = entry.required !== false;

  const [value, setValue] = useState(entry.value ?? "");
  const fieldRef = useRef(null);
  const okRef = useRef(null);

  const close = (result) => closeModal(entry.id, result);
  const dismiss = () => close(DISMISS[kind]);

  const blocked = kind === "prompt" && required && !String(value).trim();
  const validate = () => {
    if (blocked) return;
    close(kind === "prompt" ? String(value).trim() : true);
  };

  // La saisie prend le focus dès l'ouverture, sinon le bouton de
  // validation : la boîte se pilote au clavier sans passer par la souris.
  useEffect(() => {
    if (!top) return;
    const target = fieldRef.current || okRef.current;
    target?.focus();
    if (fieldRef.current) fieldRef.current.select?.();
  }, [top]);

  // Échap n'écarte que la boîte du dessus, jamais celles empilées dessous.
  useEffect(() => {
    if (!top) return;
    const onKey = (e) => {
      if (e.key !== "Escape" || entry.persistent) return;
      e.stopPropagation();
      dismiss();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [top, entry.id, entry.persistent]);

  return (
    <div
      className="cosModalBack"
      data-top={top}
      onClick={() => !entry.persistent && dismiss()}
    >
      <div
        className="cosModal"
        data-tone={tone}
        // Une boîte « nue » porte sa propre mise en page — un sélecteur, un
        // éditeur. La coquille ne lui ajoute ni marge ni largeur imposée,
        // sinon il faudrait les défaire en CSS depuis chaque appelant.
        data-nu={entry.nu ? "true" : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={entry.title || entry.message || "Boîte de dialogue"}
        onClick={(e) => e.stopPropagation()}
      >
        {entry.title || icon ? (
          <div className="cosmHead">
            {icon ? <Icon fafa={icon} width={14} /> : null}
            <span className="cosmTitle">{entry.title || "CompanyOS"}</span>
          </div>
        ) : null}

        <div className="cosmBody">
          {kind === "custom" && entry.render ? (
            entry.render({ close })
          ) : (
            <>
              {entry.message ? (
                <div className="cosmMsg">{entry.message}</div>
              ) : null}
              {entry.detail ? (
                <div className="cosmDetail">{entry.detail}</div>
              ) : null}
              {kind === "prompt" ? (
                <div className="cosmField">
                  {entry.label ? (
                    <span className="cosmLabel">{entry.label}</span>
                  ) : null}
                  {entry.multiline ? (
                    <textarea
                      ref={fieldRef}
                      rows={entry.rows || 4}
                      value={value}
                      placeholder={entry.placeholder || ""}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  ) : (
                    <input
                      ref={fieldRef}
                      type={entry.inputType || "text"}
                      value={value}
                      placeholder={entry.placeholder || ""}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && validate()}
                    />
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>

        {confirmLabel || cancelLabel ? (
          <div className="cosmActions">
            {entry.extraAction ? (
              <>
                <div
                  className="cosmGhost handcr"
                  onClick={() => close(entry.extraAction.value)}
                >
                  {entry.extraAction.label}
                </div>
                <div className="cosmSpacer" />
              </>
            ) : (
              <div className="cosmSpacer" />
            )}
            {cancelLabel ? (
              <div className="cosmGhost handcr" onClick={dismiss}>
                {cancelLabel}
              </div>
            ) : null}
            {confirmLabel ? (
              <button
                ref={okRef}
                className="cosmPrimary handcr"
                data-danger={!!entry.danger}
                data-off={blocked}
                onClick={validate}
              >
                {confirmLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const ModalHost = () => {
  const [stack, setStack] = useState([]);

  useEffect(() => subscribeModals(setStack), []);

  if (!stack.length) return null;

  return (
    <>
      {stack.map((entry, i) => (
        <ModalBox key={entry.id} entry={entry} top={i === stack.length - 1} />
      ))}
    </>
  );
};
