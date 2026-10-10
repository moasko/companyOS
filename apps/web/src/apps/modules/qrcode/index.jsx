import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { saveAs } from "../../cloud";
import { scrollElementTo } from "../../scrollTo";
import { modal } from "../../modalRequest";
import { TYPES } from "./types";
import { buildMatrix, drawToCanvas, toSvg, toPdf, toEps } from "./render";
import { Avatar } from "../../Avatar";
import "./qrcode.scss";
import { manifest as descriptif } from "./manifest";

const SECTIONS = [
  { id: "contenu", label: "Contenu", icon: "faFileLines" },
  { id: "apparence", label: "Apparence", icon: "faPenNib" },
  { id: "personnalisation", label: "Personnalisation", icon: "faSliders" },
  { id: "avancees", label: "Options avancées", icon: "faGear" },
  { id: "analytics", label: "Analytics", icon: "faChartColumn" },
];

const FORMATS = ["PNG", "SVG", "PDF", "EPS"];

const LEVELS = [
  { id: "L", label: "L (7 %) — Plus compact" },
  { id: "M", label: "M (15 %) — Équilibré" },
  { id: "Q", label: "Q (25 %) — Robuste" },
  { id: "H", label: "H (30 %) — Meilleure qualité" },
];

const DEFAULTS = {
  pixels: 300,
  margin: 2,
  level: "H",
  dark: "#1A73E8",
  light: "#FFFFFF",
  transparent: false,
  rounded: false,
};

export const manifest = { ...descriptif, Window: QrApp };

function QrApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id || manifest.icon]);
  const session = useSelector((state) => state.session);

  const [section, setSection] = useState("contenu");
  const [typeId, setTypeId] = useState("url");
  const [values, setValues] = useState({});
  const [options, setOptions] = useState(DEFAULTS);
  const [format, setFormat] = useState("PNG");
  const [preview3d, setPreview3d] = useState(false);
  const [logo, setLogo] = useState(null); // { name, image }
  const [fileName, setFileName] = useState("");
  const [history, setHistory] = useState([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef(null);
  const logoInput = useRef(null);
  const scrollRef = useRef(null);
  const sectionRefs = useRef({});

  const type = TYPES.find((t) => t.id === typeId);
  const payload = useMemo(() => type.build(values), [type, values]);
  const validationError = type.validate ? type.validate(values) : null;

  const matrix = useMemo(() => {
    if (!payload.trim()) return null;
    try {
      return buildMatrix(payload, options.level);
    } catch {
      // Contenu trop volumineux pour la version/correction demandée.
      return null;
    }
  }, [payload, options.level]);

  // Le logo masque des modules : sous le niveau Q, le code devient illisible.
  const logoUnsafe = logo && (options.level === "L" || options.level === "M");

  useEffect(() => {
    if (!canvasRef.current || !matrix) return;
    drawToCanvas(canvasRef.current, matrix, options, logo?.image || null);
  }, [matrix, options, logo]);

  const loadHistory = async () => {
    try {
      setHistory(await api.records.list(manifest.slug, "history"));
    } catch {
      /* hors ligne : pas d'historique */
    }
  };

  useEffect(() => {
    if (wnapp && !wnapp.hide && session.status === "authenticated") loadHistory();
  }, [wnapp?.hide, session.status]);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3000);
  };

  const setValue = (key) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setValues((v) => ({ ...v, [key]: value }));
  };

  const setOption = (key, cast = (x) => x) => (e) => {
    const raw = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    const value = cast(raw);
    setOptions((o) => ({ ...o, [key]: value }));
  };

  // Les entrées de la barre latérale sont des onglets : on change de
  // panneau et on repart du haut, plutôt que de faire défiler une page.
  const goToSection = (id) => {
    setSection(id);
    scrollElementTo(scrollRef.current, 0);
  };

  const pickLogo = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setLogo({ name: file.name, image: img });
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  /// Produit le fichier dans le format demandé.
  const buildFile = () => {
    if (!matrix) return null;
    const base = (fileName.trim() || `qr-${typeId}`).replace(/[\\/:*?"<>|]/g, "-");

    if (format === "SVG") {
      return {
        name: `${base}.svg`,
        blob: new Blob([toSvg(matrix, options)], { type: "image/svg+xml" }),
      };
    }
    if (format === "PDF") {
      return {
        name: `${base}.pdf`,
        blob: new Blob([toPdf(matrix, options)], { type: "application/pdf" }),
      };
    }
    if (format === "EPS") {
      return {
        name: `${base}.eps`,
        blob: new Blob([toEps(matrix, options)], { type: "application/postscript" }),
      };
    }
    return null; // PNG : passe par le canvas, en asynchrone
  };

  const getBlob = () =>
    new Promise((resolve) => {
      const file = buildFile();
      if (file) return resolve(file);
      const base = (fileName.trim() || `qr-${typeId}`).replace(/[\\/:*?"<>|]/g, "-");
      canvasRef.current.toBlob((blob) => resolve({ name: `${base}.png`, blob }), "image/png");
    });

  /// Le fichier part dans le cloud de l'espace de travail : il apparaît
  /// aussitôt dans l'Explorateur, comme tout fichier produit par l'OS.
  const download = async () => {
    if (!matrix || busy) return;
    setBusy(true);
    try {
      const { name, blob } = await getBlob();
      const node = await saveAs(blob, name, { folder: "Générateur QR" });
      if (node) flash(`« ${node.name} » enregistré dans l'Explorateur`);
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadLocal = async () => {
    if (!matrix) return;
    const { name, blob } = await getBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const testQr = () => {
    if (!payload.trim()) return;
    // Ouvre la cible quand c'est une adresse ; sinon affiche la charge utile.
    if (/^(https?:|mailto:|tel:|geo:|SMSTO:)/i.test(payload)) {
      window.open(payload, "_blank", "noopener,noreferrer");
    } else {
      flash(`Contenu encodé : ${payload.slice(0, 90)}`);
    }
  };

  const reset = () => {
    setValues({});
    setOptions(DEFAULTS);
    setLogo(null);
    setFileName("");
    setFormat("PNG");
    flash("Réinitialisé");
  };

  const save = async () => {
    if (!matrix) return;
    try {
      await api.records.create(manifest.slug, "history", {
        name: fileName.trim() || `QR ${type.label}`,
        typeId,
        values,
        options,
        format,
      });
      await loadHistory();
      flash("Ajouté à l'historique");
    } catch (err) {
      flash(err.message);
    }
  };

  const restore = (record) => {
    setTypeId(record.data.typeId);
    setValues(record.data.values || {});
    setOptions({ ...DEFAULTS, ...record.data.options });
    setFileName(record.data.name || "");
    goToSection("contenu");
  };

  const removeRecord = async (record) => {
    const ok = await modal.confirm({
      title: "Retirer de l'historique",
      message: `Retirer « ${record.data.name || "ce QR code"} » de l'historique ?`,
      detail: "Le fichier déjà enregistré dans le cloud n'est pas touché.",
      confirmLabel: "Retirer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.records.remove(manifest.slug, "history", record.id);
      await loadHistory();
    } catch (err) {
      flash(err.message);
    }
  };

  const stats = useMemo(() => {
    const byType = {};
    history.forEach((h) => {
      const label = TYPES.find((t) => t.id === h.data.typeId)?.label || "?";
      byType[label] = (byType[label] || 0) + 1;
    });
    return Object.entries(byType).sort((a, b) => b[1] - a[1]);
  }, [history]);

  const registerSection = (id) => (el) => {
    sectionRefs.current[id] = el;
  };

  return (
    <ModuleWindow manifest={manifest} className="qrGen">
      {session.status !== "authenticated" ? (
        <div className="qrLocked">Connectez-vous pour utiliser le générateur.</div>
      ) : (
        <div className="qrShell">
          {/* Navigation latérale */}
          <aside className="qrNav">
            {SECTIONS.map((s) => (
              <div
                key={s.id}
                className="qrNavItem handcr"
                data-active={section === s.id}
                onClick={() => goToSection(s.id)}
              >
                <Icon fafa={s.icon} width={13} />
                <span>{s.label}</span>
              </div>
            ))}
          </aside>

          {/* Colonne centrale */}
          <div className="qrMain cosScroll" ref={scrollRef}>
            <section ref={registerSection("contenu")} className="qrSection" data-hidden={section !== "contenu"}>
              <h2>
                <span className="qrNum">1.</span> Type de contenu
              </h2>
              <p className="qrHint">
                Sélectionnez le type de données à encoder dans le QR Code
              </p>
              <div className="qrTypeGrid">
                {TYPES.map((t) => (
                  <div
                    key={t.id}
                    className="qrTypeChip handcr"
                    data-active={t.id === typeId}
                    onClick={() => {
                      setTypeId(t.id);
                      setValues({});
                    }}
                  >
                    <Icon fafa={t.icon} width={12} />
                    <span>{t.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="qrSection" data-hidden={section !== "contenu"}>
              <h2>
                <span className="qrNum">2.</span> Contenu
              </h2>
              <p className="qrHint">Entrez le contenu de votre QR Code</p>
              {type.fields.map((f) => (
                <label key={f.key} className="qrField">
                  <span className="qrLabel">{f.label}</span>
                  {f.select ? (
                    <select value={values[f.key] || f.select[0]} onChange={setValue(f.key)}>
                      {f.select.map((opt) => (
                        <option key={opt} value={opt}>
                          {(f.labels && f.labels[opt]) || opt}
                        </option>
                      ))}
                    </select>
                  ) : f.checkbox ? (
                    <label className="qrInlineCheck handcr">
                      <input
                        type="checkbox"
                        checked={!!values[f.key]}
                        onChange={setValue(f.key)}
                      />
                      <span>Oui</span>
                    </label>
                  ) : f.textarea ? (
                    <textarea
                      rows={f.rows || 3}
                      value={values[f.key] || ""}
                      placeholder={f.placeholder}
                      onChange={setValue(f.key)}
                    />
                  ) : (
                    <input
                      type={f.type || "text"}
                      value={values[f.key] || ""}
                      placeholder={f.placeholder}
                      onChange={setValue(f.key)}
                    />
                  )}
                </label>
              ))}

              {validationError ? (
                <div className="qrWarn">{validationError}</div>
              ) : null}

              {type.preview && type.preview(values) ? (
                <div className="qrLinkPreview">
                  <div className="qrLinkTitle">Aperçu du lien</div>
                  <a
                    href={type.preview(values)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="qrLinkValue"
                  >
                    {type.preview(values)}
                    <Icon fafa="faArrowUpRightFromSquare" width={9} />
                  </a>
                </div>
              ) : null}
            </section>

            <section ref={registerSection("apparence")} className="qrSection" data-hidden={section !== "apparence"}>
              <h2>
                <span className="qrNum">3.</span> Apparence
              </h2>
              <p className="qrHint">Personnalisez l'apparence de votre QR Code</p>

              <div className="qrRow">
                <div className="qrField">
                  <span className="qrLabel">Couleur du QR Code</span>
                  <div className="qrColorField">
                    <input
                      type="color"
                      value={options.dark}
                      onChange={setOption("dark")}
                    />
                    <input
                      type="text"
                      className="qrHex"
                      value={options.dark.toUpperCase()}
                      onChange={setOption("dark")}
                    />
                  </div>
                </div>
                <div className="qrField">
                  <span className="qrLabel">Couleur de fond</span>
                  <div className="qrColorField">
                    <input
                      type="color"
                      value={options.light}
                      disabled={options.transparent}
                      onChange={setOption("light")}
                    />
                    <input
                      type="text"
                      className="qrHex"
                      value={
                        options.transparent
                          ? "Transparent"
                          : options.light.toUpperCase()
                      }
                      disabled={options.transparent}
                      onChange={setOption("light")}
                    />
                  </div>
                </div>
              </div>

              <div className="qrRow">
                <div className="qrField">
                  <span className="qrLabel">Niveau de correction</span>
                  <select value={options.level} onChange={setOption("level")}>
                    {LEVELS.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="qrField">
                  <span className="qrLabel">Format</span>
                  <div className="qrRadios">
                    <label className="qrRadio handcr">
                      <input
                        type="radio"
                        checked={!options.rounded}
                        onChange={() => setOptions((o) => ({ ...o, rounded: false }))}
                      />
                      <span>Carré</span>
                    </label>
                    <label className="qrRadio handcr">
                      <input
                        type="radio"
                        checked={options.rounded}
                        onChange={() => setOptions((o) => ({ ...o, rounded: true }))}
                      />
                      <span>Arrondi</span>
                    </label>
                  </div>
                </div>
              </div>
            </section>

            <section ref={registerSection("personnalisation")} className="qrSection" data-hidden={section !== "personnalisation"}>
              <h2>
                <span className="qrNum">4.</span> Personnalisation
              </h2>
              <p className="qrHint">Logo, marge et fond du QR Code</p>

              <div className="qrToggleRow">
                <span className="qrLabel">Logo au centre</span>
                <div className="qrToggleRight">
                  <div
                    className="qrToggle handcr"
                    data-on={!!logo}
                    onClick={() =>
                      logo ? setLogo(null) : logoInput.current?.click()
                    }
                  >
                    <span />
                  </div>
                  <span className="qrFileName">
                    {logo ? logo.name : "Aucun fichier"}
                  </span>
                  <span
                    className="qrLink handcr"
                    onClick={() => logoInput.current?.click()}
                  >
                    Changer
                  </span>
                  <input
                    ref={logoInput}
                    type="file"
                    accept="image/*"
                    className="none"
                    onChange={pickLogo}
                  />
                </div>
              </div>
              {logoUnsafe ? (
                <div className="qrWarn">
                  Un logo masque une partie du code. Passez la correction en Q ou H
                  pour qu'il reste lisible.
                </div>
              ) : null}

              <div className="qrToggleRow">
                <span className="qrLabel">Fond transparent</span>
                <div
                  className="qrToggle handcr"
                  data-on={options.transparent}
                  onClick={() =>
                    setOptions((o) => ({ ...o, transparent: !o.transparent }))
                  }
                >
                  <span />
                </div>
              </div>

              <div className="qrField">
                <span className="qrLabel">Marge : {options.margin} modules</span>
                <input
                  type="range"
                  min="0"
                  max="8"
                  value={options.margin}
                  onChange={setOption("margin", Number)}
                />
              </div>
            </section>

            <section ref={registerSection("avancees")} className="qrSection" data-hidden={section !== "avancees"}>
              <h2>
                <span className="qrNum">5.</span> Options avancées
              </h2>
              <p className="qrHint">Nom du fichier et contenu encodé</p>

              <div className="qrField">
                <span className="qrLabel">Nom du fichier</span>
                <input
                  type="text"
                  value={fileName}
                  placeholder={`qr-${typeId}`}
                  onChange={(e) => setFileName(e.target.value)}
                />
              </div>

              <div className="qrField">
                <span className="qrLabel">
                  Données encodées ({payload.length} caractères)
                </span>
                <pre className="qrPayload">{payload || "—"}</pre>
              </div>

              <div className="qrBtnRow">
                <div className="qrBtnGhost handcr" data-off={!matrix} onClick={save}>
                  Ajouter à l'historique
                </div>
                <div
                  className="qrBtnGhost handcr"
                  data-off={!matrix}
                  onClick={downloadLocal}
                >
                  Télécharger sur cet appareil
                </div>
              </div>
            </section>

            <section ref={registerSection("analytics")} className="qrSection" data-hidden={section !== "analytics"}>
              <h2>
                <span className="qrNum">6.</span> Analytics
              </h2>
              <p className="qrHint">
                QR Codes enregistrés par votre espace de travail
              </p>

              <div className="qrStatRow">
                <div className="qrStatCard">
                  <div className="qrStatVal">{history.length}</div>
                  <div className="qrStatLbl">enregistrés</div>
                </div>
                <div className="qrStatCard">
                  <div className="qrStatVal">{stats.length}</div>
                  <div className="qrStatLbl">types utilisés</div>
                </div>
                <div className="qrStatCard">
                  <div className="qrStatVal">{stats[0]?.[0] || "—"}</div>
                  <div className="qrStatLbl">le plus fréquent</div>
                </div>
              </div>

              {history.length === 0 ? (
                <div className="qrHistEmpty">
                  Aucun QR Code enregistré pour l'instant.
                </div>
              ) : (
                <div className="qrHistList">
                  {history.map((record) => (
                    <div key={record.id} className="qrHistRow">
                      {/* L'historique est partagé par tout l'espace : sans
                          visage, on ne sait pas de qui vient un code. */}
                      <Avatar
                        user={record.auteur}
                        nom={record.auteur?.name || "?"}
                        taille={24}
                      />
                      <div className="qrHistInfo handcr" onClick={() => restore(record)}>
                        <div className="qrHistName">{record.data.name}</div>
                        <div className="qrHistMeta">
                          {TYPES.find((t) => t.id === record.data.typeId)?.label}
                          {" · "}
                          {record.auteur?.name || "compte supprimé"}
                          {" · "}
                          {new Date(record.createdAt).toLocaleDateString("fr-FR")}
                        </div>
                      </div>
                      <div
                        className="qrHistDel handcr"
                        onClick={() => removeRecord(record)}
                      >
                        ✕
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Panneau d'aperçu */}
          <aside className="qrSide cosScroll">
            <div className="qrSideTitle">Aperçu en direct</div>

            <div className="qrPreviewCard" data-3d={preview3d}>
              {matrix ? (
                <canvas ref={canvasRef} className="qrCanvas" />
              ) : (
                <div className="qrPreviewEmpty">
                  {payload.trim()
                    ? "Contenu trop volumineux pour ce niveau de correction"
                    : "Renseignez le contenu pour générer le QR Code"}
                </div>
              )}
            </div>

            <div className="qrToggleRow qrCompact">
              <div
                className="qrToggle handcr"
                data-on={preview3d}
                onClick={() => setPreview3d(!preview3d)}
              >
                <span />
              </div>
              <span className="qrLabel">Aperçu 3D</span>
            </div>

            <div className="qrSizeRow">
              <span className="qrLabel">Taille</span>
              <div className="qrSizeControl">
                <input
                  type="range"
                  min="128"
                  max="1024"
                  step="8"
                  value={options.pixels}
                  onChange={setOption("pixels", Number)}
                />
                <span className="qrSizeVal">{options.pixels}</span>
                <span className="qrSizeUnit">px</span>
              </div>
            </div>

            <div
              className="qrDownload handcr"
              data-off={!matrix || busy}
              onClick={download}
            >
              <Icon fafa="faDownload" width={12} />
              <span>{busy ? "Enregistrement…" : "Télécharger le QR Code"}</span>
            </div>

            <div className="qrFormats">
              {FORMATS.map((f) => (
                <div
                  key={f}
                  className="qrFormat handcr"
                  data-active={format === f}
                  onClick={() => setFormat(f)}
                >
                  <Icon fafa="faFile" width={10} />
                  <span>{f}</span>
                </div>
              ))}
            </div>

            <div className="qrQuick">
              <div className="qrQuickTitle">Options rapides</div>
              <div className="qrQuickBtns">
                <div className="qrQuickBtn handcr" data-off={!matrix} onClick={testQr}>
                  <Icon fafa="faEye" width={10} />
                  <span>Tester le QR Code</span>
                </div>
                <div className="qrQuickBtn handcr" onClick={reset}>
                  <Icon fafa="faRotateLeft" width={10} />
                  <span>Réinitialiser</span>
                </div>
              </div>
            </div>

            {notice ? <div className="qrNotice">{notice}</div> : null}
          </aside>
        </div>
      )}
    </ModuleWindow>
  );
}
