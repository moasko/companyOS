// Campagnes — le formulaire d'inscription public, avec double opt-in.

import React, { useEffect, useState } from "react";
import { Icon } from "../../../../utils/general";
import { api } from "../../../../api/client";
import { Bouton, Carte, Entete, Kpi, useC } from "../commun";

export const Formulaire = () => {
  const { t, n, clients, aller } = useC();
  const [url, setUrl] = useState("");
  const [copie, setCopie] = useState("");
  useEffect(() => {
    api.campagnesFormulaire().then((r) => setUrl(r.url)).catch(() => {});
  }, []);

  const inscrits = clients.filter((c) => c.data.source === "formulaire" || c.data.consentement?.source === "formulaire" || c.data.consentementDemande?.source === "formulaire");
  const confirmes = inscrits.filter((c) => c.data.consentement?.confirmeLe && !c.data.emailAConfirmer).length;
  const attente = inscrits.filter((c) => c.data.emailAConfirmer).length;
  const lienHtml = `<a href="${url}" style="display:inline-block;padding:12px 22px;border-radius:9px;background:#c2410c;color:#fff;font-weight:bold;text-decoration:none">${t("boutonInscription")}</a>`;
  const iframe = `<iframe src="${url}" width="460" height="560" style="border:0;max-width:100%"></iframe>`;

  const copier = async (texte, quoi) => {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(quoi);
      window.setTimeout(() => setCopie(""), 2000);
    } catch {
      /* presse-papiers refusé : le texte reste sélectionnable */
    }
  };

  return (
    <div className="cmpVue">
      <Entete titre={t("navFormulaire")} sous={t("sousFormulaire")}>
        {url ? <Bouton icone="faArrowUpRightFromSquare" onClick={() => window.open(url, "_blank", "noopener")}>{t("ouvrirFormulaire")}</Bouton> : null}
      </Entete>
      <div className="cmpConteneur">
        <section className="cmpKpis">
          <Kpi label={t("inscritsFormulaire")} valeur={n(inscrits.length)} onClick={() => aller("contacts", { filtre: "tous" })} />
          <Kpi label={t("confirmes")} valeur={n(confirmes)} ton={confirmes ? "vert" : ""} />
          <Kpi label={t("enAttenteConfirmation")} valeur={n(attente)} ton={attente ? "orange" : ""} onClick={() => aller("contacts", { filtre: "aConfirmer" })} />
          <Kpi label={t("doubleOptin")} valeur={t("actif")} aide={t("doubleOptinD")} />
        </section>
        <div className="cmpGrille">
          <div className="cmpLarge">
            <Carte titre={t("lienFormulaire")} aide={t("lienFormulaireAide")}>
              <div className="cmpCopie">
                <input readOnly value={url} aria-label={t("lienFormulaire")} onFocus={(e) => e.target.select()} />
                <Bouton icone={copie === "lien" ? "faCheck" : "faCopy"} disabled={!url} onClick={() => copier(url, "lien")}>{copie === "lien" ? t("copie") : t("copier")}</Bouton>
              </div>
            </Carte>
            <Carte titre={t("surVotreSite")} aide={t("surVotreSiteAide")}>
              <label className="cmpChamp"><span>{t("boutonLien")}</span><textarea readOnly rows={3} value={lienHtml} onFocus={(e) => e.target.select()} /></label>
              <Bouton icone={copie === "bouton" ? "faCheck" : "faCopy"} disabled={!url} onClick={() => copier(lienHtml, "bouton")}>{copie === "bouton" ? t("copie") : t("copier")}</Bouton>
              <label className="cmpChamp"><span>{t("formulaireIntegre")}</span><textarea readOnly rows={2} value={iframe} onFocus={(e) => e.target.select()} /></label>
              <Bouton icone={copie === "iframe" ? "faCheck" : "faCopy"} disabled={!url} onClick={() => copier(iframe, "iframe")}>{copie === "iframe" ? t("copie") : t("copier")}</Bouton>
            </Carte>
          </div>
          <aside className="cmpColonne">
            <Carte titre={t("commentCaMarche")}>
              <ol className="cmpEtapesTexte">
                <li><Icon fafa="faPenToSquare" width={12} />{t("formEtape1")}</li>
                <li><Icon fafa="faEnvelope" width={12} />{t("formEtape2")}</li>
                <li><Icon fafa="faCircleCheck" width={12} />{t("formEtape3")}</li>
                <li><Icon fafa="faBolt" width={12} />{t("formEtape4")}</li>
              </ol>
              <p className="cmpAide">{t("formProtection")}</p>
            </Carte>
          </aside>
        </div>
      </div>
    </div>
  );
};
