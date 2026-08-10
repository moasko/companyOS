// Les douze types de contenu encodables, dans l'ordre de la maquette.
// Chaque type déclare ses champs et la chaîne qu'il produit.

const esc = (s = "") => String(s).replace(/([\\;,:"])/g, "\\$1");

export const TYPES = [
  {
    id: "url",
    label: "URL",
    icon: "faLink",
    fields: [{ key: "url", label: "URL", placeholder: "https://companyos.app/dashboard" }],
    build: (v) => v.url || "",
    preview: (v) => v.url,
  },
  {
    id: "texte",
    label: "Texte",
    icon: "faAlignLeft",
    fields: [
      { key: "texte", label: "Texte", placeholder: "Votre texte…", textarea: true },
    ],
    build: (v) => v.texte || "",
  },
  {
    id: "email",
    label: "Email",
    icon: "faEnvelope",
    fields: [
      { key: "to", label: "Destinataire", placeholder: "contact@entreprise.com" },
      { key: "subject", label: "Objet", placeholder: "Demande de devis" },
      { key: "body", label: "Message", placeholder: "Bonjour…", textarea: true },
    ],
    build: (v) => {
      const p = new URLSearchParams();
      if (v.subject) p.set("subject", v.subject);
      if (v.body) p.set("body", v.body);
      const q = p.toString();
      return `mailto:${v.to || ""}${q ? "?" + q : ""}`;
    },
  },
  {
    id: "telephone",
    label: "Téléphone",
    icon: "faPhone",
    fields: [{ key: "phone", label: "Numéro", placeholder: "+225 07 00 00 00 00" }],
    build: (v) => `tel:${v.phone || ""}`,
  },
  {
    id: "sms",
    label: "SMS",
    icon: "faComment",
    fields: [
      { key: "phone", label: "Numéro", placeholder: "+225 07 00 00 00 00" },
      { key: "message", label: "Message", placeholder: "Bonjour…", textarea: true },
    ],
    build: (v) => `SMSTO:${v.phone || ""}:${v.message || ""}`,
  },
  {
    id: "wifi",
    label: "WiFi",
    icon: "faWifi",
    fields: [
      { key: "ssid", label: "Nom du réseau (SSID)", placeholder: "Boutique-WiFi" },
      { key: "password", label: "Mot de passe", placeholder: "••••••••" },
      {
        key: "security",
        label: "Sécurité",
        select: ["WPA", "WEP", "nopass"],
        labels: { WPA: "WPA / WPA2", WEP: "WEP", nopass: "Réseau ouvert" },
      },
      { key: "hidden", label: "Réseau masqué", checkbox: true },
    ],
    build: (v) =>
      `WIFI:T:${v.security || "WPA"};S:${esc(v.ssid)};P:${esc(v.password)};${v.hidden ? "H:true;" : ""};`,
  },
  {
    id: "vcard",
    label: "vCard",
    icon: "faAddressCard",
    fields: [
      { key: "name", label: "Nom complet", placeholder: "Awa Koné" },
      { key: "org", label: "Entreprise", placeholder: "Kone Distribution" },
      { key: "title", label: "Fonction", placeholder: "Directrice" },
      { key: "phone", label: "Téléphone", placeholder: "+225 07 00 00 00 00" },
      { key: "email", label: "E-mail", placeholder: "awa@konedist.ci" },
      { key: "website", label: "Site web", placeholder: "https://konedist.ci" },
      { key: "address", label: "Adresse", placeholder: "Abidjan, Côte d'Ivoire" },
    ],
    build: (v) =>
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${v.name || ""}`,
        v.org ? `ORG:${v.org}` : null,
        v.title ? `TITLE:${v.title}` : null,
        v.phone ? `TEL;TYPE=CELL:${v.phone}` : null,
        v.email ? `EMAIL:${v.email}` : null,
        v.website ? `URL:${v.website}` : null,
        v.address ? `ADR:;;${v.address};;;;` : null,
        "END:VCARD",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  {
    id: "localisation",
    label: "Localisation",
    icon: "faLocationDot",
    fields: [
      { key: "lat", label: "Latitude", placeholder: "5.3599517" },
      { key: "lon", label: "Longitude", placeholder: "-4.0082563" },
    ],
    build: (v) => `geo:${v.lat || 0},${v.lon || 0}`,
  },
  {
    id: "evenement",
    label: "Événement",
    icon: "faCalendarDay",
    fields: [
      { key: "title", label: "Titre", placeholder: "Réunion commerciale" },
      { key: "location", label: "Lieu", placeholder: "Siège, Abidjan" },
      { key: "start", label: "Début", type: "datetime-local" },
      { key: "end", label: "Fin", type: "datetime-local" },
    ],
    build: (v) => {
      // Format iCalendar : AAAAMMJJTHHMMSS, sans séparateurs.
      const stamp = (s) => (s ? s.replace(/[-:]/g, "").replace(/\.\d+/, "") + "00" : "");
      return [
        "BEGIN:VEVENT",
        `SUMMARY:${v.title || ""}`,
        v.location ? `LOCATION:${v.location}` : null,
        v.start ? `DTSTART:${stamp(v.start)}` : null,
        v.end ? `DTEND:${stamp(v.end)}` : null,
        "END:VEVENT",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    id: "paiement",
    label: "Paiement",
    icon: "faCreditCard",
    fields: [
      { key: "beneficiaire", label: "Bénéficiaire", placeholder: "Ma Petite Entreprise" },
      { key: "iban", label: "IBAN / compte", placeholder: "CI93 CI00 0000 0000 0000 0000 000" },
      { key: "montant", label: "Montant", placeholder: "250000", type: "number" },
      { key: "devise", label: "Devise", select: ["XOF", "EUR", "USD"] },
      { key: "motif", label: "Motif", placeholder: "Facture 2026-014" },
    ],
    // Format EPC / SEPA « virement » : lu par la plupart des applis bancaires.
    build: (v) =>
      [
        "BCD",
        "002",
        "1",
        "SCT",
        "",
        v.beneficiaire || "",
        (v.iban || "").replace(/\s/g, ""),
        v.montant ? `${v.devise || "XOF"}${v.montant}` : "",
        "",
        "",
        v.motif || "",
      ].join("\n"),
  },
  {
    id: "identifiant",
    label: "Identifiant",
    icon: "faIdBadge",
    fields: [
      { key: "id", label: "Identifiant", placeholder: "EMP-00427" },
      { key: "nom", label: "Nom", placeholder: "Yao Bertin" },
      { key: "service", label: "Service", placeholder: "Logistique" },
    ],
    build: (v) =>
      `ID:${v.id || ""}|NOM:${v.nom || ""}|SERVICE:${v.service || ""}`,
  },
  {
    id: "json",
    label: "JSON",
    icon: "faCode",
    fields: [
      {
        key: "json",
        label: "JSON",
        placeholder: '{ "produit": "REF-001", "lot": 42 }',
        textarea: true,
        rows: 5,
      },
    ],
    build: (v) => v.json || "",
    // Signale une syntaxe invalide sans empêcher de générer le code.
    validate: (v) => {
      if (!v.json || !v.json.trim()) return null;
      try {
        JSON.parse(v.json);
        return null;
      } catch (err) {
        return "JSON invalide : " + err.message;
      }
    },
  },
];

export const typeById = Object.fromEntries(TYPES.map((t) => [t.id, t]));
