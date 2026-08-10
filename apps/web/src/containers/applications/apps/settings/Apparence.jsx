import React from "react";
import { changeTheme } from "../../../../actions";
import { Image } from "../../../../utils/general";
import {
  POLICES,
  choisirFond,
  retirerFond,
  choisirPolice,
} from "../../../../apps/appearance";
import { ApercuFond, Row, Toggle } from "./commun";

export const SectionApparence = ({
  section,
  theme,
  appearance,
  wall,
  busy,
  flash,
  policeInput,
  importerUnePolice,
  fondInput,
  importerUnFond,
  fondsPerso,
  supprimerFond,
  changerFond,
}) => (
  <section className="setSection" data-hidden={section !== "apparence"}>
    <h2>Apparence</h2>
    <p className="setHint">Thème et fond d'écran</p>

    <Row
      title="Thème sombre"
      desc="S'applique à tout le système et à toutes les applications"
    >
      <Toggle on={theme === "dark"} onClick={() => changeTheme()} />
    </Row>

    <div className="setSubTitle">Police de l'interface</div>
    <div className="setFonts">
      {POLICES.map((p) => (
        <div
          key={p.id}
          className="setFont handcr"
          data-active={
            !appearance.fontNodeId && appearance.fontId === p.id
          }
          style={{ fontFamily: p.stack }}
          onClick={() => {
            choisirPolice(p.id);
            flash(`Police « ${p.label} » appliquée`);
          }}
        >
          <div className="setFontName">{p.label}</div>
          <div className="setFontSample">Aa — Facture 2026-014</div>
        </div>
      ))}
    </div>

    <Row
      title="Police personnalisée"
      desc={
        appearance.fontName
          ? `${appearance.fontName} — importée dans le cloud`
          : "Fichier .ttf, .otf, .woff ou .woff2"
      }
    >
      {appearance.fontNodeId ? (
        <div
          className="setBtnGhost handcr"
          onClick={() => {
            choisirPolice("systeme");
            flash("Police système rétablie");
          }}
        >
          Retirer
        </div>
      ) : null}
      <div
        className="setBtnGhost handcr"
        data-off={busy}
        onClick={() => policeInput.current?.click()}
      >
        Importer une police
      </div>
      <input
        ref={policeInput}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/*"
        className="none"
        onChange={importerUnePolice}
      />
    </Row>

    <div className="setSubTitle">Fond d'écran</div>
    <div className="setWalls">
      {wall.themes.map((nom) => (
        <Image
          key={nom}
          className={
            !appearance.wallUrl && wall.src.includes(nom)
              ? "setWall selected"
              : "setWall"
          }
          src={`img/wallpaper/${nom}/img0.svg`}
          ext
          onClick={() => {
            retirerFond();
            changerFond(`${nom}/img0.svg`);
          }}
        />
      ))}
    </div>
    <p className="setHint">
      Choisir un fond livré ajuste le thème pour rester lisible.
    </p>

    <div className="setSubTitle">Vos fonds d'écran</div>
    {fondsPerso.length === 0 ? (
      <div className="setEmptyBox">
        Aucune image importée. Vos fonds sont rangés dans le dossier
        « Fonds d'écran » du cloud et comptent dans votre quota.
      </div>
    ) : (
      // Une grille de vignettes, comme les fonds livrés juste
      // au-dessus : on choisit un fond d'écran en le regardant,
      // pas en lisant « IMG_2847.jpg ».
      <div className="setWalls">
        {fondsPerso.map((f) => (
          <ApercuFond
            key={f.id}
            node={f}
            actif={appearance.wallNodeId === f.id}
            onChoisir={async () => {
              await choisirFond(f.id);
              flash(`« ${f.name} » appliqué`);
            }}
            onSupprimer={() => supprimerFond(f)}
          />
        ))}
      </div>
    )}

    <div className="setActionsRow" style={{ marginTop: 12 }}>
      <div
        className="setPrimary handcr"
        data-off={busy}
        onClick={() => fondInput.current?.click()}
      >
        {busy ? "…" : "Importer une image"}
      </div>
      {appearance.wallUrl ? (
        <div
          className="setBtnGhost handcr"
          onClick={async () => {
            await retirerFond();
            flash("Fond personnalisé retiré");
          }}
        >
          Revenir aux fonds livrés
        </div>
      ) : null}
      <input
        ref={fondInput}
        type="file"
        accept="image/*"
        className="none"
        onChange={importerUnFond}
      />
    </div>
  </section>
);
