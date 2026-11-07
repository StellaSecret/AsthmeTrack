// ══════════════════════════════════════════
//  CONFIG GOOGLE DRIVE
//  ⚠️  Remplacer par votre Client ID Google Cloud
//  (type "Application Android" ou "Application de bureau")
//  Les données vont dans le Drive de CHAQUE utilisateur — pas le vôtre.
// ══════════════════════════════════════════
// GOOGLE_CLIENT_ID is injected at build time via: sed -i "s/__GOOGLE_CLIENT_ID__/$GOOGLE_CLIENT_ID/g" www/index.html
// Never commit a real Client ID here. Keep __GOOGLE_CLIENT_ID__ as the placeholder.
const GOOGLE_CLIENT_ID = '__GOOGLE_CLIENT_ID__';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email';
const GDRIVE_FILENAME = 'chronictrack_data.json';
const GDRIVE_LEGACY_FILENAMES = ['asthmetrack_data.json'];

function _driveBackupQuery(fields) {
  const names = [GDRIVE_FILENAME, ...GDRIVE_LEGACY_FILENAMES].map(n => `name='${n}'`).join(' or ');
  return `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=(${names})&fields=${fields}`;
}

function _pickDriveBackup(files) {
  if (!Array.isArray(files) || !files.length) return null;
  return files.find(f => f.name === GDRIVE_FILENAME) || files[0];
}
const IS_CAPACITOR = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// Pure business logic (loaded from logic.js). DOM-free, unit-tested, mutation-tested.
const { depZone, spo2Zone, predictedDEP, calcTrend, isCrisis } = window.AsthmeTrackLogic;


// ══════════════════════════════════════════
//  HTML ESCAPE HELPER  (FIX #1–3, #7–8 — XSS)
//  Always call esc() before inserting user-controlled strings into innerHTML.
// ══════════════════════════════════════════
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ══════════════════════════════════════════
//  DATA
// ══════════════════════════════════════════
const DB = {
  _state: {
    measures: [],
    bestDEP: 450,
    reminders: [],
    profile: {},
    driveToken: null,
    driveTokenExpiry: 0,
    driveFileId: null,
    driveUser: null,
    driveAvatar: null,
    conditions: { enabled: ['asthma','hypertension','diabetes'] },
    conditionEntries: [],
    medications: []
  },
  async load() {
    try {
      const [m, b, r, p, dt, de, df, du, da, ce, meds, conds] = await Promise.all([
        SecureStore.load('at_measures'),
        SecureStore.load('at_bestDEP'),
        SecureStore.load('at_reminders'),
        SecureStore.load('at_profile'),
        SecureStore.load('at_driveToken'),
        SecureStore.load('at_driveTokenExpiry'),
        SecureStore.load('at_driveFileId'),
        SecureStore.load('at_driveUser'),
        SecureStore.load('at_driveAvatar'),
        SecureStore.load('at_conditionEntries'),
        SecureStore.load('at_medications'),
        SecureStore.load('at_conditions')
      ]);
      this._state.measures = JSON.parse(m || '[]');
      this._state.bestDEP = parseFloat(b || '450');
      this._state.reminders = JSON.parse(r || '[]');
      this._state.profile = JSON.parse(p || '{}');
      this._state.driveToken = dt || null;
      this._state.driveTokenExpiry = parseInt(de || '0');
      this._state.driveFileId = df || null;
      this._state.driveUser = du || null;
      this._state.driveAvatar = da || null;
      this._state.conditionEntries = JSON.parse(ce || '[]');
      this._state.medications = JSON.parse(meds || '[]');
      this._state.conditions = JSON.parse(conds || '{"enabled":["asthma","hypertension","diabetes"]}');
      // Legacy default was asthma-only: upgrade unless the user chose it explicitly in Settings
      { const c=this._state.conditions;
        if(c && Array.isArray(c.enabled) && !c.custom && c.enabled.length===1 && c.enabled[0]==='asthma'){
          c.enabled=['asthma','hypertension','diabetes'];
        } }
      // Migrate existing asthma measures to conditionEntries if empty
      if((!this._state.conditionEntries || this._state.conditionEntries.length===0) && this._state.measures && this._state.measures.length>0){
        try {
          this._state.conditionEntries = migrateLegacyMeasures(this._state.measures);
          SecureStore.save('at_conditionEntries', JSON.stringify(this._state.conditionEntries));
        } catch(e){}
      }
    } catch(e) { console.error('DB.load failed', e); }
  },
  get measures() { return this._state.measures; },
  set measures(v) { this._state.measures = v; SecureStore.save('at_measures', JSON.stringify(v)); },
  get bestDEP() { return this._state.bestDEP; },
  set bestDEP(v) { this._state.bestDEP = v; SecureStore.save('at_bestDEP', String(v)); },
  get reminders() { return this._state.reminders; },
  set reminders(v) { this._state.reminders = v; SecureStore.save('at_reminders', JSON.stringify(v)); },
  get profile() { return this._state.profile; },
  set profile(v) { this._state.profile = v; SecureStore.save('at_profile', JSON.stringify(v)); },
  get conditions() { return this._state.conditions; },
  set conditions(v) { this._state.conditions = v; SecureStore.save('at_conditions', JSON.stringify(v)); },
  get conditionEntries() { return this._state.conditionEntries; },
  set conditionEntries(v) { this._state.conditionEntries = v; SecureStore.save('at_conditionEntries', JSON.stringify(v)); },
  get medications() { return this._state.medications; },
  set medications(v) { this._state.medications = v; SecureStore.save('at_medications', JSON.stringify(v)); },

  // ── token fields stay in SecureStore for asynchronous access ──────────
  // On Capacitor the token is persisted in CapacitorPreferences (secure
  // storage backed by EncryptedSharedPreferences on Android / Keychain on iOS).
  // Call SecureStore.save/load at connect & restore time.
  getDriveToken: async function() { return this._state.driveToken; },
  setDriveToken: async function(v) {
    this._state.driveToken = v;
    if (v) { await SecureStore.save('at_driveToken', v); }
    else   { await SecureStore.remove('at_driveToken'); }
  },
  getDriveTokenExpiry: async function() { return this._state.driveTokenExpiry; },
  setDriveTokenExpiry: async function(v) {
    this._state.driveTokenExpiry = v;
    await SecureStore.save('at_driveTokenExpiry', String(v));
  },
  get driveFileId() { return this._state.driveFileId; },
  set driveFileId(v) { this._state.driveFileId = v; if (v) SecureStore.save('at_driveFileId', v); else SecureStore.remove('at_driveFileId'); },
  get driveUser() { return this._state.driveUser; },
  set driveUser(v) { this._state.driveUser = v; if (v) SecureStore.save('at_driveUser', v); else SecureStore.remove('at_driveUser'); },
  get driveAvatar() { return this._state.driveAvatar; },
  set driveAvatar(v) { this._state.driveAvatar = v; if (v) SecureStore.save('at_driveAvatar', v); else SecureStore.remove('at_driveAvatar'); },
};

// ══════════════════════════════════════════
//  SECURE STORAGE  (Capacitor Preferences → IndexedDB fallback)
//  Wraps @capacitor/preferences so the OAuth token is stored in
//  EncryptedSharedPreferences (Android) / Keychain (iOS) instead of
//  plain localStorage.  Falls back to IndexedDB on web for better
//  isolation than localStorage.
// ══════════════════════════════════════════
const SecureStore = {
  _db: null,
  _prefs() { return IS_CAPACITOR && window.Capacitor?.Plugins?.Preferences || null; },
  async _getDB() {
    if (this._db) return this._db;
    const dbName = localStorage.getItem('__TEST_DB_NAME__') || 'ChroniTrackDB';
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        this._db = req.result;
        this._db.onversionchange = () => {
          this._db.close();
          this._db = null;
        };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  },
  async save(key, value) {
    try {
      const p = this._prefs();
      if (p) { await p.set({ key, value }); return; }
      const db = await this._getDB();
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
    } catch(e) { console.warn('SecureStore.save', e); }
  },
  async load(key) {
    try {
      const p = this._prefs();
      if (p) { const { value } = await p.get({ key }); return value; }
      const db = await this._getDB();
      return new Promise((resolve) => {
        const req = db.transaction('kv').objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
    } catch(e) { console.warn('SecureStore.load', e); return null; }
  },
  async remove(key) {
    try {
      const p = this._prefs();
      if (p) { await p.remove({ key }); return; }
      const db = await this._getDB();
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
    } catch(e) { console.warn('SecureStore.remove', e); }
  },
  /** No longer need init() to copy to localStorage as we now use async accessors */
  async init() {},
  async close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
};

// ══════════════════════════════════════════

  // I18N — Internationalisation (fr / en)

// ══════════════════════════════════════════
const LANG = {
  fr: {
    // nav
    nav_dashboard: 'Accueil', nav_history: 'Historique', nav_meds: 'Rx', nav_settings: 'Réglages',
    // dashboard
    db_no_data: 'Aucune mesure.<br/>Ajoutez votre première mesure.',
    db_active_reminders: 'Rappels actifs',
    db_last_measure: 'Dernière mesure',
    db_dep_avg: 'DEP (moy.)',
    db_best_pct: '% du meilleur',
    db_dep_chart: 'DEP — 14 derniers jours',
    db_spo2_chart: 'SpO₂ — 14 derniers jours',
    // zones
    zone_green: '🟢 Vert', zone_yellow: '🟡 Jaune', zone_red: '🔴 Rouge',
    // saisie
    new_measure: 'Nouvelle mesure',
    label_datetime: 'Date & heure',
    label_dep: 'DEP — Moyenne sur 3 souffles (L/min)',
    label_breath: (n) => `Souffle ${n}`,
    label_avg_calc: 'Moyenne calculée',
    label_spo2: 'SpO₂ — Oxymétrie de pouls (%)',
    label_spo2_ph: 'ex. 97',
    dep_hint: '⚠ Hors limites (50–900)',
    spo2_hint: '⚠ Hors limites (70–100)',
    label_easyhaler: "Prises Easyhaler aujourd'hui",
    label_comment: 'Commentaire (facultatif)',
    comment_ph: 'Symptômes, contexte, météo…',
    btn_save_measure: 'Enregistrer la mesure',
    // history
    history_title: 'Historique',
    history_empty: 'Aucune mesure enregistrée.',
    history_load_more: 'Afficher plus',
    dep_avg_suffix: ' (moy.)',
    breaths_label: 'Souffles',
    // edit modal
    edit_title: 'Modifier la mesure',
    label_dep_3: 'DEP — 3 souffles (L/min)',
    label_spo2_short: 'SpO₂ (%)',
    label_easyhaler_short: 'Prises Easyhaler',
    label_comment_short: 'Commentaire',
    comment_ph2: 'Symptômes, contexte…',
    btn_save_edit: 'Enregistrer les modifications',
    // settings
    settings_drive_title: '☁️ Google Drive',
    settings_drive_desc: "Sauvegardez vos données sur votre Google Drive personnel. Vos données n'appartiennent qu'à vous.",
    settings_drive_connected: '✓ Connecté — sync auto activée',
    btn_drive_upload: '⬆ Sauvegarder',
    btn_drive_download: '⬇ Restaurer',
    btn_drive_disconnect: 'Déconnecter',
    btn_drive_browse: '🔎 Inspecter ma sauvegarde',
    btn_google_signin: 'Se connecter avec Google',
    settings_dep_title: 'Calibration DEP',
    settings_dep_label: 'Votre meilleur DEP personnel (L/min)',
    btn_save_dep: 'Enregistrer',
    settings_reminders_title: 'Rappels de prises',
    reminders_empty: 'Aucun rappel configuré.',
    reminder_ph_label: 'ex. Matin',
    btn_add_reminder: '+ Ajouter',
    settings_data_title: 'Données',
    settings_export_pdf_label: 'Exporter PDF',
    settings_export_pdf_sub: 'Rapport complet de vos mesures',
    btn_export_pdf: '⬇ PDF',
    settings_export_json_label: 'Exporter JSON',
    settings_export_json_sub: 'Sauvegarde brute — tous appareils',
    btn_export_json: '⬇ JSON',
    settings_import_json_label: 'Importer JSON',
    settings_import_json_sub: 'Restaurer depuis un fichier .json',
    btn_import_json: '⬆ Importer',
    settings_clear_label: 'Supprimer tout',
    settings_clear_sub: 'Action irréversible',
    btn_clear: 'Effacer',
    settings_appearance_title: 'Apparence',
    settings_theme_label: 'Thème sombre',
    settings_lang_label: 'Langue / Language',
    settings_font_label: 'Police de caractères',
    settings_font_system: 'Système',
    settings_font_custom: 'Lexend',
    settings_zones_title: 'Zones de référence',
    zone_green_desc: 'DEP ≥ 80% · SpO₂ ≥ 95%',
    zone_yellow_desc: 'DEP 60–80% · SpO₂ 90–94%',
    zone_red_desc: 'DEP < 60% · SpO₂ < 90%',
    // toasts & confirms
    toast_saved: '✓ Mesure enregistrée',
    toast_edited: '✓ Mesure modifiée',
    toast_deleted_confirm: 'Supprimer cette mesure ?',
    toast_best_dep_saved: '✓ Meilleur DEP sauvegardé',
    toast_best_dep_invalid: '⚠️ Valeur invalide',
    toast_clear_confirm: 'Effacer TOUTES les mesures ?',
    toast_cleared: '✓ Données supprimées',
    toast_reminder_added: '✓ Rappel ajouté',
    toast_reminder_no_time: '⚠️ Choisir une heure',
    toast_pdf_no_data: 'Aucune donnée',
    toast_pdf_error: 'Erreur: jsPDF non chargé',
    toast_pdf_done: '✓ PDF généré',
    toast_json_exported: '✓ Sauvegarde JSON téléchargée',
    toast_json_imported: (n) => `✓ ${n} mesures importées`,
    toast_json_import_err: (m) => `Erreur import : ${m}`,
    toast_json_invalid: 'Format invalide — champ "measures" manquant.',
    import_confirm: (n, existing) => `Importer ${n} mesures ?\nCela remplacera vos ${existing} mesures actuelles.`,
    err_no_dep: '⚠️ Saisir au moins un souffle DEP',
    err_spo2: '⚠️ SpO₂ invalide',
    err_easy: '⚠️ Choisir nbre de prises',
    err_storage: '⚠️ Stockage plein — donnée non sauvegardée',
    err_date: '⚠️ Date manquante',
    err_date_future: '⚠️ La date ne peut pas être dans le futur',
    err_dep_range: '⚠️ Valeur DEP hors limites (50–900) ignorée',
    dose_singular: 'prise', dose_plural: 'prises',
    // drive
    drive_connected_toast: '✓ Google Drive connecté',
    drive_disconnect_confirm: 'Déconnecter Google Drive ?',
    drive_disconnect_toast: '✓ Déconnecté',
    drive_no_backup: 'Aucune sauvegarde sur Drive.\nSauvegarder vos données locales (%n mesures) ?',
    drive_conflict: (local, date) => `Données locales : ${local} mesures.\nSauvegarde Drive : modifiée le ${date}.\n\nOK → Restaurer depuis Drive (écrase les données locales)\nAnnuler → Sauvegarder les données locales sur Drive`,
    drive_restored: '✓ Données restaurées depuis Drive',
    drive_saved: '✓ Sauvegardé sur Drive',
    drive_connected_no_backup: 'Drive connecté — aucune sauvegarde existante',
    drive_no_backup_found: 'Aucune sauvegarde trouvée',
    drive_not_connected: 'Non connecté à Drive',
    drive_plugin_unavailable: 'Plugin non disponible',
    prise_short: 'pr',
    // pdf
    pdf_title: 'ChroniTrack — Export des mesures',
    pdf_generated: (date, time) => `Généré le ${date} à ${time}`,
    pdf_select_sub: 'Choisissez les données à inclure dans le rapport',
    pdf_select_count: (n) => `${n} entrée${n > 1 ? 's' : ''}`,
    pdf_select_none: 'Sélectionnez au moins une catégorie',
    btn_pdf_export: 'Exporter le PDF',
    pdf_cols: ['Date','Heure','DEP','Souffles','Zone','SpO₂','Zone','Prises','Commentaire'],
    pdf_footer: (n) => `ChroniTrack • ${n} mesures exportées`,
    pdf_charts_title: 'Graphes — évolution sur 14 jours',
    pdf_dep_label: 'DEP (L/min)',
    pdf_spo2_label: 'SpO₂ (%)',
    pdf_bp_label: 'Tension artérielle (mmHg)',
    pdf_sys_label: 'Systolique',
    pdf_dia_label: 'Diastolique',
    pdf_glucose_label: 'Glycémie (mg/dL)',
    pdf_charts_footer: 'Graphes générés depuis les 14 dernières mesures enregistrées',
    pdf_save_error: (m) => `Erreur sauvegarde: ${m}`,
    locale: 'fr-FR',
    // Profile / predicted DEP
    profile_title: 'Profil & DEP théorique',
    profile_sex: 'Sexe',
    profile_male: 'Homme',
    profile_female: 'Femme',
    profile_age: 'Âge (ans)',
    profile_height: 'Taille (cm)',
    profile_calc: 'Calculer',
    profile_result_label: 'DEP théorique',
    profile_result_range: (lo, hi) => `Plage normale : ${lo}–${hi} L/min`,
    profile_formula_note: 'Formule ECSC/Quanjer — valeurs de référence adultes',
    profile_set_best: 'Utiliser comme meilleur DEP',
    profile_age_sub: 'Valeurs de référence pour adultes (18–70 ans)',
    profile_no_result: 'Remplissez le profil pour calculer',
    // crisis
    crisis_title: '⚠️ Zone Rouge — plusieurs mesures consécutives',
    crisis_sub: 'Votre DEP est en zone rouge depuis plusieurs mesures. Consultez votre médecin si les symptômes persistent.',
    // trend
    trend_label: '7j',
    // offline
    offline_msg: 'Hors ligne — la synchronisation Drive reprendra automatiquement',
    // csv
    settings_export_csv_label: 'Exporter CSV',
    settings_export_csv_sub: 'Tableur — Excel, Numbers…',
    btn_export_csv: '⬇ CSV',
    toast_csv_exported: '✓ CSV téléchargé',
    // settings profile link
    settings_profile_label: 'DEP théorique',
    settings_profile_sub: 'Calculer selon votre profil',
    btn_profile_open: 'Calculer',
    hub_title: 'Suivi',
    hub_sub: 'Choisissez une condition',
    panel_open: 'Ouvrir',
    panel_add: 'Nouvelle mesure',
    panel_no_data: 'Aucune donnée',
    panel_last: 'Dernière',
    cond_asthma: 'Asthme',
    cond_hypertension: 'Hypertension',
    cond_diabetes: 'Diabète',
    cond_bp_title: 'Tension artérielle',
    bp_short: 'TA',
    cond_glucose_title: 'Glycémie',
    detail_back: '← Accueil',
    detail_history: 'Mesures récentes',
    cat_normal: 'Normale', cat_elevated: 'Élevée', cat_stage1: 'Stade 1', cat_stage2: 'Stade 2', cat_crisis: 'Crise',
    bp_chart: 'Tension — dernières mesures',
    glucose_chart: 'Glycémie — dernières mesures',
    toast_bp_saved: '✓ Tension enregistrée',
    toast_bp_invalid: 'TA invalide',
    toast_glucose_saved: '✓ Glycémie enregistrée',
    toast_glucose_invalid: 'Glycémie invalide',
    demo_banner: 'Mode Démo : données simulées (asthme, tension, diabète)',
  },
  en: {
    // nav
    nav_dashboard: 'Home', nav_history: 'History', nav_meds: 'Meds', nav_settings: 'Settings',
    // dashboard
    db_no_data: 'No measurements.<br/>Add your first measurement.',
    db_active_reminders: 'Active reminders',
    db_last_measure: 'Latest measurement',
    db_dep_avg: 'PEF (avg)',
    db_best_pct: '% of best',
    db_dep_chart: 'PEF — last 14 days',
    db_spo2_chart: 'SpO₂ — last 14 days',
    // zones
    zone_green: '🟢 Green', zone_yellow: '🟡 Yellow', zone_red: '🔴 Red',
    // saisie
    new_measure: 'New measurement',
    label_datetime: 'Date & time',
    label_dep: 'PEF — Average over 3 blows (L/min)',
    label_breath: (n) => `Blow ${n}`,
    label_avg_calc: 'Calculated average',
    label_spo2: 'SpO₂ — Pulse oximetry (%)',
    label_spo2_ph: 'e.g. 97',
    dep_hint: '⚠ Out of range (50–900)',
    spo2_hint: '⚠ Out of range (70–100)',
    label_easyhaler: 'Easyhaler doses today',
    label_comment: 'Comment (optional)',
    comment_ph: 'Symptoms, context, weather…',
    btn_save_measure: 'Save measurement',
    // history
    history_title: 'History',
    history_empty: 'No measurements recorded.',
    history_load_more: 'Load more',
    dep_avg_suffix: ' (avg)',
    breaths_label: 'Blows',
    // edit modal
    edit_title: 'Edit measurement',
    label_dep_3: 'PEF — 3 blows (L/min)',
    label_spo2_short: 'SpO₂ (%)',
    label_easyhaler_short: 'Easyhaler doses',
    label_comment_short: 'Comment',
    comment_ph2: 'Symptoms, context…',
    btn_save_edit: 'Save changes',
    // settings
    settings_drive_title: '☁️ Google Drive',
    settings_drive_desc: "Back up your data to your personal Google Drive. Your data belongs to you only.",
    settings_drive_connected: '✓ Connected — auto sync on',
    btn_drive_upload: '⬆ Save',
    btn_drive_download: '⬇ Restore',
    btn_drive_disconnect: 'Disconnect',
    btn_drive_browse: '🔎 Inspect my backup',
    btn_google_signin: 'Sign in with Google',
    settings_dep_title: 'PEF Calibration',
    settings_dep_label: 'Your personal best PEF (L/min)',
    btn_save_dep: 'Save',
    settings_reminders_title: 'Dose reminders',
    reminders_empty: 'No reminders set.',
    reminder_ph_label: 'e.g. Morning',
    btn_add_reminder: '+ Add',
    settings_data_title: 'Data',
    settings_export_pdf_label: 'Export PDF',
    settings_export_pdf_sub: 'Full report of your measurements',
    btn_export_pdf: '⬇ PDF',
    settings_export_json_label: 'Export JSON',
    settings_export_json_sub: 'Raw backup — any device',
    btn_export_json: '⬇ JSON',
    settings_import_json_label: 'Import JSON',
    settings_import_json_sub: 'Restore from a .json file',
    btn_import_json: '⬆ Import',
    settings_clear_label: 'Delete all',
    settings_clear_sub: 'Irreversible action',
    btn_clear: 'Delete',
    settings_appearance_title: 'Appearance',
    settings_theme_label: 'Dark theme',
    settings_lang_label: 'Langue / Language',
    settings_font_label: 'Font',
    settings_font_system: 'System',
    settings_font_custom: 'Lexend',
    settings_zones_title: 'Reference zones',
    zone_green_desc: 'PEF ≥ 80% · SpO₂ ≥ 95%',
    zone_yellow_desc: 'PEF 60–80% · SpO₂ 90–94%',
    zone_red_desc: 'PEF < 60% · SpO₂ < 90%',
    // toasts & confirms
    toast_saved: '✓ Measurement saved',
    toast_edited: '✓ Measurement updated',
    toast_deleted_confirm: 'Delete this measurement?',
    toast_best_dep_saved: '✓ Personal best PEF saved',
    toast_best_dep_invalid: '⚠️ Invalid value',
    toast_clear_confirm: 'Delete ALL measurements?',
    toast_cleared: '✓ Data deleted',
    toast_reminder_added: '✓ Reminder added',
    toast_reminder_no_time: '⚠️ Choose a time',
    toast_pdf_no_data: 'No data',
    toast_pdf_error: 'Error: jsPDF not loaded',
    toast_pdf_done: '✓ PDF generated',
    toast_json_exported: '✓ JSON backup downloaded',
    toast_json_imported: (n) => `✓ ${n} measurements imported`,
    toast_json_import_err: (m) => `Import error: ${m}`,
    toast_json_invalid: 'Invalid format — "measures" field missing.',
    import_confirm: (n, existing) => `Import ${n} measurements?\nThis will replace your ${existing} current measurements.`,
    err_no_dep: '⚠️ Enter at least one PEF blow',
    err_spo2: '⚠️ Invalid SpO₂',
    err_easy: '⚠️ Choose number of doses',
    err_storage: '⚠️ Storage full — data not saved',
    err_date: '⚠️ Date missing',
    err_date_future: '⚠️ Date cannot be in the future',
    err_dep_range: '⚠️ PEF value out of range (50–900) ignored',
    dose_singular: 'dose', dose_plural: 'doses',
    // drive
    drive_connected_toast: '✓ Google Drive connected',
    drive_disconnect_confirm: 'Disconnect Google Drive?',
    drive_disconnect_toast: '✓ Disconnected',
    drive_no_backup: 'No Drive backup.\nSave your local data (%n measurements)?',
    drive_conflict: (local, date) => `Local data: ${local} measurements.\nDrive backup: modified ${date}.\n\nOK → Restore from Drive (overwrites local data)\nCancel → Save local data to Drive`,
    drive_restored: '✓ Data restored from Drive',
    drive_saved: '✓ Saved to Drive',
    drive_connected_no_backup: 'Drive connected — no existing backup',
    drive_no_backup_found: 'No backup found',
    drive_not_connected: 'Not connected to Drive',
    drive_plugin_unavailable: 'Plugin unavailable',
    prise_short: 'dose',
    // pdf
    pdf_title: 'ChroniTrack — Measurement export',
    pdf_generated: (date, time) => `Generated on ${date} at ${time}`,
    pdf_select_sub: 'Choose which data to include in the report',
    pdf_select_count: (n) => `${n} entr${n === 1 ? 'y' : 'ies'}`,
    pdf_select_none: 'Select at least one category',
    btn_pdf_export: 'Export PDF',
    pdf_cols: ['Date','Time','PEF','Blows','Zone','SpO₂','Zone','Doses','Comment'],
    pdf_footer: (n) => `ChroniTrack • ${n} measurements exported`,
    pdf_charts_title: 'Charts — last 14 days',
    pdf_dep_label: 'PEF (L/min)',
    pdf_spo2_label: 'SpO₂ (%)',
    pdf_bp_label: 'Blood pressure (mmHg)',
    pdf_sys_label: 'Systolic',
    pdf_dia_label: 'Diastolic',
    pdf_glucose_label: 'Blood glucose (mg/dL)',
    pdf_charts_footer: 'Charts generated from the last 14 recorded measurements',
    pdf_save_error: (m) => `Save error: ${m}`,
    locale: 'en-GB',
    // Profile / predicted DEP
    profile_title: 'Profile & predicted PEF',
    profile_sex: 'Sex',
    profile_male: 'Male',
    profile_female: 'Female',
    profile_age: 'Age (years)',
    profile_height: 'Height (cm)',
    profile_calc: 'Calculate',
    profile_result_label: 'Predicted PEF',
    profile_result_range: (lo, hi) => `Normal range: ${lo}–${hi} L/min`,
    profile_formula_note: 'ECSC/Quanjer reference equations — adults',
    profile_set_best: 'Use as personal best PEF',
    profile_age_sub: 'Reference values for adults (18–70 years)',
    profile_no_result: 'Fill in your profile to calculate',
    // crisis
    crisis_title: '⚠️ Red Zone — multiple consecutive readings',
    crisis_sub: 'Your PEF has been in the red zone for several readings. Contact your doctor if symptoms persist.',
    // trend
    trend_label: '7d',
    // offline
    offline_msg: 'Offline — Drive sync will resume automatically',
    // csv
    settings_export_csv_label: 'Export CSV',
    settings_export_csv_sub: 'Spreadsheet — Excel, Numbers…',
    btn_export_csv: '⬇ CSV',
    toast_csv_exported: '✓ CSV downloaded',
    // settings profile link
    settings_profile_label: 'Predicted PEF',
    settings_profile_sub: 'Calculate from your profile',
    btn_profile_open: 'Calculate',
    hub_title: 'Tracking',
    hub_sub: 'Choose a condition',
    panel_open: 'Open',
    panel_add: 'New entry',
    panel_no_data: 'No data',
    panel_last: 'Latest',
    cond_asthma: 'Asthma',
    cond_hypertension: 'Hypertension',
    cond_diabetes: 'Diabetes',
    cond_bp_title: 'Blood pressure',
    bp_short: 'BP',
    cond_glucose_title: 'Blood glucose',
    detail_back: '← Home',
    detail_history: 'Recent entries',
    cat_normal: 'Normal', cat_elevated: 'Elevated', cat_stage1: 'Stage 1', cat_stage2: 'Stage 2', cat_crisis: 'Crisis',
    bp_chart: 'Blood pressure — recent',
    glucose_chart: 'Blood glucose — recent',
    toast_bp_saved: '✓ Blood pressure saved',
    toast_bp_invalid: 'Invalid blood pressure',
    toast_glucose_saved: '✓ Glucose saved',
    toast_glucose_invalid: 'Invalid glucose',
    demo_banner: 'Demo mode: simulated data (asthma, blood pressure, diabetes)',
  },
};

// Active language — reads from localStorage, defaults to 'fr'
let _lang = localStorage.getItem('at_lang') || 'fr';
document.documentElement.lang = _lang; // set immediately, before any render
function t(key, ...args) {
  const v = LANG[_lang]?.[key] ?? LANG['fr'][key];
  return (typeof v === 'function') ? v(...args) : (v ?? key);
}
function setLang(l) {
  _lang = l;
  localStorage.setItem('at_lang', l);
  document.documentElement.lang = l;
  _rerender();
}
function _rerender() {
  // Re-render every visible section and static HTML strings
  renderNav();
  renderStaticHTML();
  _translateProfileModal();
  // Re-apply font so CSS var stays in sync after hot rerender
  applyFont(isCustomFont());
  const page = currentPage;
  if (page === 'dashboard')   renderDashboard();
  if (page === 'historique')  renderHistory();
  if (page === 'settings')    renderSettings();
  if (page === 'condition')   renderConditionDetail();
  if (page === 'saisie')      renderSaisieLabels();
}


// ══════════════════════════════════════════
//  THEME  (dark / light)
// ══════════════════════════════════════════
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem('at_theme', dark ? 'dark' : 'light');
  const meta = document.getElementById('metaThemeColor');
  if (meta) meta.content = dark ? '#0d0f14' : '#f0ede8';
}
function isDark() { return localStorage.getItem('at_theme') !== 'light'; }

// ── Font preference ──────────────────────────────────────────────────────────
// 'system'           → standard sans-serif system stack
// 'custom' (default) → Lexend (modern aesthetic)
const SYSTEM_MONO  = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const CUSTOM_MONO  = "'Lexend',sans-serif";

function isCustomFont() {
  const saved = localStorage.getItem('at_font');
  return saved === null || saved === 'custom'; // Lexend is now default
}

function applyFont(custom) {
  localStorage.setItem('at_font', custom ? 'custom' : 'system');
  document.documentElement.style.setProperty(
    '--font-mono', custom ? CUSTOM_MONO : SYSTEM_MONO
  );
}

// Apply immediately — before any render — to prevent flash
applyTheme(isDark());
applyFont(isCustomFont());

// ══════════════════════════════════════════
//  ZONES
// ══════════════════════════════════════════
function zoneLabel(z){return{green:t('zone_green'),yellow:t('zone_yellow'),red:t('zone_red')}[z];}
function zoneClass(z){return'zone-'+z;}


// ══════════════════════════════════════════
//  DYNAMIC LABEL HELPERS
// ══════════════════════════════════════════
function renderNav() {
  const keys = ['nav_dashboard','nav_history','nav_meds','nav_settings'];
  document.querySelectorAll('.nav-btn').forEach((btn, i) => {
    const span = btn.querySelector('span');
    if (span && keys[i]) span.textContent = t(keys[i]);
  });
}

function renderSaisieLabels() {
  // 1. Handle data-i18n attributes (simple text substitution, no args)
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = LANG[_lang]?.[key] ?? LANG['fr'][key];
    if (val && typeof val === 'string') el.textContent = val;
  });
  // Use a helper that skips null elements silently
  const set = (sel, txt) => { const el = document.querySelector(sel); if (el) el.textContent = txt; };

  // ── Measure form (page-saisie) ──────────────────────────────────────────
  set('#page-saisie .card-title', t('new_measure'));

  // Use :scope-safe individual field IDs and known structure instead of
  // fragile nth-child indexing (dep-field labels pollute the NodeList).
  // datetime label: first direct label inside the first .field
  const fields = document.querySelectorAll('#page-saisie .field');
  // fields[0] = datetime, fields[1] = DEP, fields[2] = SpO2, fields[3] = easyhaler, fields[4] = comment
  if (fields[0]) { const l = fields[0].querySelector(':scope > label'); if (l) l.textContent = t('label_datetime'); }
  if (fields[1]) { const l = fields[1].querySelector(':scope > label'); if (l) l.textContent = t('label_dep'); }
  // breath sub-labels (children of .dep-field inside the DEP field)
  document.querySelectorAll('#page-saisie .dep-field label').forEach((el, i) => {
    el.textContent = t('label_breath', i + 1);
  });
  const avgLabel = document.querySelector('#page-saisie .dep-avg-label');
  if (avgLabel) avgLabel.textContent = t('label_avg_calc');
  if (fields[2]) { const l = fields[2].querySelector(':scope > label'); if (l) l.textContent = t('label_spo2'); }
  const spo2Input = document.getElementById('inputSpO2');
  if (spo2Input) spo2Input.placeholder = t('label_spo2_ph');
  const spo2Hint = document.getElementById('spo2Hint');
  if (spo2Hint) spo2Hint.textContent = t('spo2_hint');
  if (fields[3]) { const l = fields[3].querySelector(':scope > label'); if (l) l.textContent = t('label_easyhaler'); }
  if (fields[4]) { const l = fields[4].querySelector(':scope > label'); if (l) l.textContent = t('label_comment'); }
  const commentTA = document.getElementById('inputComment');
  if (commentTA) commentTA.placeholder = t('comment_ph');
  const saveBtn = document.querySelector('#page-saisie .btn-primary');
  if (saveBtn) saveBtn.textContent = t('btn_save_measure');

  // ── History header ───────────────────────────────────────────────────────
  const histTitle = document.querySelector('#page-historique .card-title');
  if (histTitle) histTitle.textContent = t('history_title');

  // ── Edit modal ───────────────────────────────────────────────────────────
  set('#editModal .modal-title', t('edit_title'));
  const editFields = document.querySelectorAll('#editModal .field');
  // editFields[0] = datetime, editFields[1] = DEP, editFields[2] = SpO2, editFields[3] = easyhaler, editFields[4] = comment
  if (editFields[0]) { const l = editFields[0].querySelector(':scope > label'); if (l) l.textContent = t('label_datetime'); }
  if (editFields[1]) { const l = editFields[1].querySelector(':scope > label'); if (l) l.textContent = t('label_dep_3'); }
  document.querySelectorAll('#editModal .dep-field label').forEach((el, i) => {
    el.textContent = t('label_breath', i + 1);
  });
  const editAvgLabel = document.querySelector('#editModal .dep-avg-label');
  if (editAvgLabel) editAvgLabel.textContent = t('label_avg_calc');
  const editSpo2Hint = document.getElementById('editSpo2Hint');
  if (editSpo2Hint) editSpo2Hint.textContent = t('spo2_hint');
  if (editFields[2]) { const l = editFields[2].querySelector(':scope > label'); if (l) l.textContent = t('label_spo2_short'); }
  if (editFields[3]) { const l = editFields[3].querySelector(':scope > label'); if (l) l.textContent = t('label_easyhaler_short'); }
  if (editFields[4]) { const l = editFields[4].querySelector(':scope > label'); if (l) l.textContent = t('label_comment_short'); }
  const editCommentTA = document.getElementById('editComment');
  if (editCommentTA) editCommentTA.placeholder = t('comment_ph2');
  const editSaveBtn = document.querySelector('#editModal .btn-primary');
  if (editSaveBtn) editSaveBtn.textContent = t('btn_save_edit');
}

function renderStaticHTML() {
  renderNav();
  renderSaisieLabels();
}


// ══════════════════════════════════════════
//  PREDICTED DEP  (ECSC / Quanjer reference equations)
//  Ref: Quanjer PH et al. Eur Respir J 1993;6(Suppl 16):5–40
//  Male:   PEF = (((height_m * 5.48) + 1.58) - (age * 0.041)) × 60
//  Female: PEF = (((height_m * 3.72) + 2.24) - (age * 0.030)) × 60
//  Normal range ±20% around predicted value.
// ══════════════════════════════════════════
function openProfileModal() {
  const p = DB.profile;
  document.getElementById('profileSex').value    = p.sex    || 'M';
  document.getElementById('profileAge').value    = p.age    || '';
  document.getElementById('profileHeight').value = p.height || '';
  calcPredictedDEP(); // show result if already filled
  document.getElementById('profileModal').classList.add('open');
}
function closeProfileModal() { document.getElementById('profileModal').classList.remove('open'); }

function _translateProfileModal() {
  const set = (sel, key) => { const el = document.querySelector(sel); if (el) el.textContent = t(key); };
  set('#profileModal .modal-title', 'profile_title');
  set('#profileModal [data-i18n="profile_age_sub"]', 'profile_age_sub');
  const mOpt = document.querySelector('#profileSex option[value="M"]');
  const fOpt = document.querySelector('#profileSex option[value="F"]');
  if (mOpt) mOpt.textContent = t('profile_male');
  if (fOpt) fOpt.textContent = t('profile_female');
  set('#profileModal label[data-i18n="profile_sex"]', 'profile_sex');
  set('#profileModal label[data-i18n="profile_age"]', 'profile_age');
  set('#profileModal label[data-i18n="profile_height"]', 'profile_height');
  calcPredictedDEP(); // refresh result text in new language
}

function calcPredictedDEP() {
  const sex    = document.getElementById('profileSex').value;
  const age    = parseInt(document.getElementById('profileAge').value);
  const height = parseInt(document.getElementById('profileHeight').value);
  // Save profile regardless
  DB.profile = { sex, age: age||null, height: height||null };

  const res = document.getElementById('profileResult');
  if (!age || !height || age < 18 || age > 70 || height < 100 || height > 220) {
    res.innerHTML = '';
    const lbl=document.createElement('div');lbl.className='profile-result-label';lbl.style.color='var(--muted)';lbl.textContent=t('profile_no_result');
    res.appendChild(lbl);
    return;
  }
  const pred = predictedDEP(sex, age, height);
  const lo   = Math.round(pred * 0.80);
  const hi   = Math.round(pred * 1.20);
  res.innerHTML = '';
  const valEl=document.createElement('div');valEl.className='profile-result-value';valEl.textContent=pred;
  const lblEl=document.createElement('div');lblEl.className='profile-result-label';lblEl.textContent=`${t('profile_result_label')} (L/min)`;
  const rangeEl=document.createElement('div');rangeEl.className='profile-result-range';rangeEl.textContent=t('profile_result_range',lo,hi);
  const noteEl=document.createElement('div');noteEl.className='profile-formula-note';noteEl.textContent=t('profile_formula_note');
  const setBtn=document.createElement('button');setBtn.className='btn-secondary';setBtn.style.cssText='margin-top:14px;width:100%';
  setBtn.textContent=t('profile_set_best');setBtn.addEventListener('click',()=>useProfileDEP(pred));
  res.appendChild(valEl);res.appendChild(lblEl);res.appendChild(rangeEl);res.appendChild(noteEl);res.appendChild(setBtn);
}

function useProfileDEP(val) {
  DB.bestDEP = val;
  showToast(t('toast_best_dep_saved'));
  closeProfileModal();
  if (currentPage === 'settings') renderSettings();
  if (currentPage === 'dashboard') renderDashboard();
}

// ══════════════════════════════════════════
//  TREND  (compare last 7 days vs previous 7 days)
//  ── calcTrend lives in logic.js ──
function trendArrow(trend, field) {
  if (!trend) return '';
  const isGoodUp = field === 'dep' || field === 'spo2'; // higher = better for both
  const cls = trend === 'flat' ? 'trend-flat'
            : (trend === 'up') === isGoodUp ? 'trend-up' : 'trend-down';
  const sym = trend === 'flat' ? '→' : trend === 'up' ? '↑' : '↓';
  return `<span class="${cls}" title="${t('trend_label')}">${sym}</span>`;
}

// ══════════════════════════════════════════
//  CRISIS DETECTION
//  Fires when last N consecutive readings are red-zone DEP
//  ── isCrisis + CRISIS_THRESHOLD live in logic.js ──
// ══════════════════════════════════════════

// ══════════════════════════════════════════
//  CSV EXPORT
// ══════════════════════════════════════════
async function exportCSV() {
  const measures = DB.measures;
  if (!measures.length) { showToast(t('toast_pdf_no_data'), 'error'); return; }
  const cols = t('pdf_cols'); // reuse same column names
  const rows = [...measures]
    .sort((a, b) => new Date(a.dt) - new Date(b.dt))
    .map(m => {
      const d = new Date(m.dt);
      const date = d.toLocaleDateString(t('locale'));
      const time = d.toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' });
      const blows = [m.dep1, m.dep2, m.dep3].filter(Boolean).join(' / ');
      return [
        date, time, m.dep, blows,
        zoneLabel(depZone(m.dep, DB.bestDEP)).replace(/🟢|🟡|🔴/g, '').trim(),
        m.spo2,
        zoneLabel(spo2Zone(m.spo2)).replace(/🟢|🟡|🔴/g, '').trim(),
        m.easy != null ? m.easy : '',
        (m.comment || '').replace(/"/g, '""'),
      ].map(v => `"${v}"`).join(',');
    });

  const csv   = [cols.map(c => `"${c}"`).join(','), ...rows].join('\r\n');
  const fname = 'asthmetrack_' + new Date().toISOString().slice(0, 10) + '.csv';

  if (IS_CAPACITOR) {
    try {
      const Filesystem = window.Capacitor?.Plugins?.Filesystem;
      const Share      = window.Capacitor?.Plugins?.Share;
      if (!Filesystem) throw new Error('Filesystem plugin unavailable');
      const b64 = btoa(unescape(encodeURIComponent(csv)));
      await Filesystem.writeFile({ path: fname, data: b64, directory: 'DOCUMENTS', recursive: true });
      showToast(t('toast_csv_exported'));
      if (Share) {
        const uri = await Filesystem.getUri({ path: fname, directory: 'DOCUMENTS' });
        await Share.share({ title: fname, url: uri.uri });
      }
    } catch (e) {
      showToast(t('pdf_save_error', (e.message||'').slice(0,60)), 'error');
    }
  } else {
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM for Excel
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = fname; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 2000);
    showToast(t('toast_csv_exported'));
  }
}

// ══════════════════════════════════════════
//  OFFLINE DETECTION
// ══════════════════════════════════════════
function updateOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  if (navigator.onLine) banner.classList.remove('visible');
  else { banner.textContent = t('offline_msg'); banner.classList.add('visible'); }
}

// ══════════════════════════════════════════
//  NAV
// ══════════════════════════════════════════
let currentPage='dashboard';
function showPage(id,btn){
  if(id==='saisie'||id==='saisie-htn'||id==='saisie-diabete') _editingEntryId=null;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  const target = document.getElementById('page-'+id);
  if(target) target.classList.add('active');
  if(btn)btn.classList.add('active');
  else {
    document.querySelectorAll('.nav-btn').forEach(b=>{ if(b.dataset.val===id) b.classList.add('active'); });
  }
  currentPage=id;
  if(id==='dashboard')renderDashboard();
  if(id==='condition')renderConditionDetail();
  if(id==='historique')renderHistory();
  if(id==='settings')renderSettings();
  if(id==='medications'){ try{ if(typeof renderMedications==='function') renderMedications(); }catch(e){} }
  if(id==='saisie-htn'){ const el=document.getElementById('htnDatetime'); if(el){ try{ const now=new Date(); now.setSeconds(0,0); el.value=now.toISOString().slice(0,16); }catch(e){} }}
  if(id==='saisie-diabete'){ const el=document.getElementById('dmDatetime'); if(el){ try{ const now=new Date(); now.setSeconds(0,0); el.value=now.toISOString().slice(0,16); }catch(e){} }}
  if(id==='saisie')initForm();
  if(id==='saisie-htn'){ const el=document.getElementById('htnDatetime'); if(el){ const now=new Date(); now.setSeconds(0,0); el.value=now.toISOString().slice(0,16); }}
  if(id==='saisie-diabete'){ const el=document.getElementById('dmDatetime'); if(el){ const now=new Date(); now.setSeconds(0,0); el.value=now.toISOString().slice(0,16); }}
}

// ══════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════
function showToast(msg,type=''){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='toast'+(type?' '+type:'')+' show';
  setTimeout(()=>t.classList.remove('show'),2500);
}

// ══════════════════════════════════════════
//  DEP AVERAGE
// ══════════════════════════════════════════
function _depFieldId(prefix,n){return prefix?prefix+'Dep'+n:'dep'+n;}
function calcDepAvg(prefix=''){
  const vals=[1,2,3].map(n=>{const el=document.getElementById(_depFieldId(prefix,n));return el?parseFloat(el.value):NaN;}).filter(v=>!isNaN(v)&&v>=50&&v<=900);
  if(!vals.length)return null;
  return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
}
function calcDepAvgWithWarn(prefix=''){
  const raw=[1,2,3].map(n=>{const el=document.getElementById(_depFieldId(prefix,n));const v=parseFloat(el?el.value:NaN);return{n,v};});
  const ignored=raw.filter(x=>!isNaN(x.v)&&(x.v<50||x.v>900));
  if(ignored.length)showToast(t('err_dep_range'),'error');
  const vals=raw.map(x=>x.v).filter(v=>!isNaN(v)&&v>=50&&v<=900);
  if(!vals.length)return null;
  return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
}
function updateSpo2Display(el){
  const v=parseFloat(el.value),hintId=el.id==='inputSpO2'?'spo2Hint':'editSpo2Hint',hint=document.getElementById(hintId);
  if(!el.value){el.classList.remove('spo2-invalid');if(hint)hint.classList.remove('visible');return;}
  if(!isNaN(v)&&(v<70||v>100)){el.classList.add('spo2-invalid');if(hint)hint.classList.add('visible');}
  else{el.classList.remove('spo2-invalid');if(hint)hint.classList.remove('visible');}
}
function updateDepAvg(){
  const avg=calcDepAvg(''),d=document.getElementById('depAvgDisplay'),v=document.getElementById('depAvgValue');
  if(avg!==null){d.style.display='flex';v.textContent=avg+' L/min';}else d.style.display='none';
  [1,2,3].forEach(n=>{
    const el=document.getElementById('dep'+n);
    const hint=document.getElementById('depHint'+n);
    if(!el||el.value===''){el&&el.classList.remove('dep-invalid');if(hint)hint.classList.remove('visible');return;}
    const v2=parseFloat(el.value);
    const bad=!isNaN(v2)&&(v2<50||v2>900);
    el.classList.toggle('dep-invalid',bad);
    if(hint){hint.textContent=t('dep_hint');hint.classList.toggle('visible',bad);}
  });
}
function updateEditDepAvg(){
  const avg=calcDepAvg('edit'),d=document.getElementById('editDepAvgDisplay'),v=document.getElementById('editDepAvgValue');
  if(avg!==null){d.style.display='flex';v.textContent=avg+' L/min';}else d.style.display='none';
  [1,2,3].forEach(n=>{
    const el=document.getElementById('editDep'+n);
    const hint=document.getElementById('editDepHint'+n);
    if(!el||el.value===''){el&&el.classList.remove('dep-invalid');if(hint)hint.classList.remove('visible');return;}
    const v2=parseFloat(el.value);
    const bad=!isNaN(v2)&&(v2<50||v2>900);
    el.classList.toggle('dep-invalid',bad);
    if(hint){hint.textContent=t('dep_hint');hint.classList.toggle('visible',bad);}
  });
}

// ══════════════════════════════════════════
//  FORM
// ══════════════════════════════════════════
let selectedEasy=null;
function initForm(){
  const now=new Date();now.setSeconds(0,0);
  document.getElementById('inputDatetime').value=now.toISOString().slice(0,16);
  ['dep1','dep2','dep3'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('depAvgDisplay').style.display='none';
  document.getElementById('inputSpO2').value='';
  document.getElementById('inputComment').value='';
  selectedEasy=null;
  document.querySelectorAll('#page-saisie .easyh-btn').forEach(b=>b.classList.remove('selected'));
}
function selectEasy(n){
  selectedEasy=n;
  document.querySelectorAll('#page-saisie .easyh-btn').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.val)===n));
}
function saveHTN(){
  const sysEl=document.getElementById('htnSys'), diaEl=document.getElementById('htnDia'), pulEl=document.getElementById('htnPulse');
  const sys = parseInt(sysEl&&sysEl.value);
  const dia = parseInt(diaEl&&diaEl.value);
  const pulse = parseInt(pulEl&&pulEl.value);
  const posEl=document.getElementById('htnPos');
  const pos = (posEl&&posEl.value)||'assis';
  const comEl=document.getElementById('htnComment');
  const comment = (comEl&&comEl.value)||'';
  const dtEl=document.getElementById('htnDatetime');
  const dt = (dtEl&&dtEl.value) || new Date().toISOString().slice(0,16);
  if(isNaN(sys)||isNaN(dia)){ showToast(t('toast_bp_invalid')||'TA invalide','error'); return; }
  const isEdit = !!_editingEntryId && (DB.conditionEntries||[]).some(x=>x.id===_editingEntryId && x.conditionId==='hypertension');
  const editId = isEdit ? _editingEntryId : null;
  const entry = { id: editId||nextId(), conditionId:'hypertension', type:'reading', timestamp: new Date(dt).toISOString(), data:{systolic:sys,diastolic:dia,pulse:isNaN(pulse)?null:pulse,position:pos,comment}, meta:{} };
  if(isEdit) DB.conditionEntries = (DB.conditionEntries||[]).map(x=>x.id===editId?entry:x);
  else DB.conditionEntries = [...(DB.conditionEntries||[]), entry];
  _editingEntryId=null;
  try{ if(sysEl) sysEl.value=''; if(diaEl) diaEl.value=''; if(pulEl) pulEl.value=''; if(comEl) comEl.value=''; }catch(e){}
  showToast(t('toast_bp_saved')||'✓ Tension enregistrée');
  driveAutoSync();
  if(isEdit){ showPage('historique'); }
  else { _activeCondition='hypertension'; setTimeout(()=>showCondition('hypertension'), 500); }
}
function saveDM(){
  const glEl=document.getElementById('dmGlucose'), unEl=document.getElementById('dmUnit'), ctxEl=document.getElementById('dmContext'), inEl=document.getElementById('dmInsulin'), comEl=document.getElementById('dmComment'), dtEl=document.getElementById('dmDatetime');
  const glucose = parseFloat(glEl&&glEl.value);
  const unit = (unEl&&unEl.value)||'mg/dL';
  const context = (ctxEl&&ctxEl.value)||'';
  const insulin = parseFloat(inEl&&inEl.value);
  const comment = (comEl&&comEl.value)||'';
  const dt = (dtEl&&dtEl.value) || new Date().toISOString().slice(0,16);
  if(isNaN(glucose)){ showToast(t('toast_glucose_invalid')||'Glycémie invalide','error'); return; }
  const isEdit = !!_editingEntryId && (DB.conditionEntries||[]).some(x=>x.id===_editingEntryId && x.conditionId==='diabetes');
  const editId = isEdit ? _editingEntryId : null;
  const entry = { id: editId||nextId(), conditionId:'diabetes', type:'reading', timestamp: new Date(dt).toISOString(), data:{glucose,unit,context,insulin: isNaN(insulin)?null:insulin,meals:comment,comment}, meta:{} };
  if(isEdit) DB.conditionEntries = (DB.conditionEntries||[]).map(x=>x.id===editId?entry:x);
  else DB.conditionEntries = [...(DB.conditionEntries||[]), entry];
  _editingEntryId=null;
  try{ if(glEl) glEl.value=''; if(inEl) inEl.value=''; if(comEl) comEl.value=''; }catch(e){}
  showToast(t('toast_glucose_saved')||'✓ Glycémie enregistrée');
  driveAutoSync();
  if(isEdit){ showPage('historique'); }
  else { _activeCondition='diabetes'; setTimeout(()=>showCondition('diabetes'), 500); }
}
function addMedication(){
  const name = (document.getElementById('medName')||{}).value||'';
  const dose = (document.getElementById('medDose')||{}).value||'';
  const freq = (document.getElementById('medFreq')||{}).value||'';
  const cond = (document.getElementById('medCond')||{}).value||'asthma';
  if(!name.trim()){ showToast('Nom requis','error'); return; }
  DB.medications = [...(DB.medications||[]), {id: Date.now().toString(36), name:name.trim(), dose:dose.trim(), freq:freq.trim(), conditionId: cond, active:true}];
  try{ document.getElementById('medName').value=''; document.getElementById('medDose').value=''; document.getElementById('medFreq').value=''; }catch(e){}
  showToast('✓ Médicament ajouté');
  if(typeof renderMedications==='function') renderMedications();
  if(currentPage==='dashboard'&&typeof renderDashboard==='function') renderDashboard();
}
function renderMedications(){
  const list = document.getElementById('medList');
  if(!list) return;
  const meds = DB.medications||[];
  if(!meds.length){ list.innerHTML='<div style="color:var(--muted);padding:8px 0">Aucun médicament</div>'; return; }
  list.innerHTML = meds.map((m,i)=>`<div style="padding:8px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px"><div><b>${esc(m.name||'')}</b> ${esc(m.dose||'')} ${esc(m.freq||'')}<div style="font-size:12px;color:var(--muted)">${esc(m.conditionId||'')}</div></div><button class="icon-action-btn del" data-action="removeMed" data-val="${i}" aria-label="Supprimer">✕</button></div>`).join('');
}
window.addMedication = addMedication;
window.renderMedications = renderMedications;
function saveMeasure(){
  const dep=calcDepAvgWithWarn(''),spo2=parseFloat(document.getElementById('inputSpO2').value),dt=document.getElementById('inputDatetime').value,comment=document.getElementById('inputComment').value.trim();
  const dep1=parseFloat(document.getElementById('dep1').value)||null,dep2=parseFloat(document.getElementById('dep2').value)||null,dep3=parseFloat(document.getElementById('dep3').value)||null;
  if(!dt){showToast(t('err_date'),'error');return;}
  if(new Date(dt)>new Date()){showToast(t('err_date_future'),'error');_flashFieldError('inputDatetime');return;}
  if(!dep){showToast(t('err_no_dep'),'error');_flashFieldError('dep1');return;}
  if(!spo2||spo2<70||spo2>100){showToast(t('err_spo2'),'error');_flashFieldError('inputSpO2');return;}
  if(selectedEasy===null){showToast(t('err_easy'),'error');return;}
  const measures=DB.measures;
  const measure = {id:nextId(),dt,dep,dep1,dep2,dep3,spo2,easy:selectedEasy,comment};
  measures.unshift(measure);
  DB.measures=measures;
  // Also add to conditionEntries
  try {
    const entry = { id: measure.id, conditionId:'asthma', type:'measure', timestamp: dt, data:{ dep, spo2, easyhaler: selectedEasy, comment, dep1,dep2,dep3 }, meta:{} };
    DB.conditionEntries = [...(DB.conditionEntries||[]), entry];
  } catch(e){}
  showToast(t('toast_saved'));
  driveAutoSync();
  setTimeout(()=>{ _activeCondition='asthma'; showCondition('asthma'); },800);
}

// ══════════════════════════════════════════
//  EDIT MODAL
// ══════════════════════════════════════════
let editingId=null,selectedEditEasy=null;
function openEditModal(id){
  const m=DB.measures.find(x=>x.id===id);if(!m)return;
  editingId=id;selectedEditEasy=m.easy;
  document.getElementById('editDatetime').value=m.dt;
  document.getElementById('editDep1').value=m.dep1||m.dep||'';
  document.getElementById('editDep2').value=m.dep2||'';
  document.getElementById('editDep3').value=m.dep3||'';
  updateEditDepAvg();
  document.getElementById('editSpO2').value=m.spo2;
  document.getElementById('editComment').value=m.comment||'';
  document.querySelectorAll('#editEasyBtns .easyh-btn').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.val)===m.easy));
  document.getElementById('editModal').classList.add('open');
}
function closeEditModal(){
  document.getElementById('editModal').classList.remove('open');
  editingId=null;
  // Clear any lingering field-error highlights
  document.querySelectorAll('#editModal .field-error').forEach(f=>f.classList.remove('field-error'));
}
function _flashFieldError(inputId){
  const el=document.getElementById(inputId);
  if(!el)return;
  const field=el.closest('.field');
  if(!field)return;
  field.classList.remove('field-error'); // reset to retrigger animation
  void field.offsetWidth;               // force reflow
  field.classList.add('field-error');
  setTimeout(()=>field.classList.remove('field-error'),2000);
}
function selectEditEasy(n){selectedEditEasy=n;document.querySelectorAll('#editEasyBtns .easyh-btn').forEach(b=>b.classList.toggle('selected',parseInt(b.dataset.val)===n));}
function saveEdit(){
  const dep=calcDepAvgWithWarn('edit'),spo2=parseFloat(document.getElementById('editSpO2').value),dt=document.getElementById('editDatetime').value,comment=document.getElementById('editComment').value.trim();
  const dep1=parseFloat(document.getElementById('editDep1').value)||null,dep2=parseFloat(document.getElementById('editDep2').value)||null,dep3=parseFloat(document.getElementById('editDep3').value)||null;
  if(!dt){showToast(t('err_date'),'error');_flashFieldError('editDatetime');return;}
  if(new Date(dt)>new Date()){showToast(t('err_date_future')||'⚠️ Date dans le futur','error');_flashFieldError('editDatetime');return;}
  if(!dep){showToast(t('err_no_dep'),'error');_flashFieldError('editDep1');return;}
  if(!spo2||spo2<70||spo2>100){showToast(t('err_spo2'),'error');_flashFieldError('editSpO2');return;}
  if(selectedEditEasy===null){showToast(t('err_easy'),'error');return;}
  DB.measures=DB.measures.map(m=>m.id!==editingId?m:{...m,dt,dep,dep1,dep2,dep3,spo2,easy:selectedEditEasy,comment});
  closeEditModal();showToast(t('toast_edited'));driveAutoSync();
  renderHistory();if(currentPage==='dashboard')renderDashboard();
}
document.getElementById('editModal').addEventListener('click',function(e){if(e.target===this)closeEditModal();});

// ══════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════
function escHtml(x){ return (x==null?'':String(x)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function enabledConditions(){ return ((DB.conditions&&DB.conditions.enabled)||['asthma','hypertension','diabetes']).filter(Boolean); }
function conditionEntriesOf(id){ return (DB.conditionEntries||[]).filter(e=>e&&e.conditionId===id).slice().sort((a,b)=>new Date(b.timestamp||0)-new Date(a.timestamp||0)); }
function asthmaMeasures(){ return (DB.measures||[]).slice().sort((a,b)=>new Date(b.dt||0)-new Date(a.dt||0)); }
function conditionLabel(id){
  if(id==='asthma') return t('cond_asthma');
  if(id==='hypertension') return t('cond_hypertension');
  if(id==='diabetes') return t('cond_diabetes');
  return id;
}
function conditionColor(id){ return (id==='hypertension'?'#f97316':id==='diabetes'?'#a78bfa':'#4f9cf9'); }
function htnCategory(s,d){
  const def=window.HypertensionCondition; if(def&&def.getCategory) return def.getCategory(s,d);
  s=Number(s); d=Number(d); if(s>=180||d>=120) return 'crisis'; if(s>=140||d>=90) return 'stage2'; if(s>=130||d>=80) return 'stage1'; if(s>=120&&d<80) return 'elevated'; return 'normal';
}
function catLabel(c){ const k='cat_'+c; const v=t(k); return v===k?c:v; }
function glucoseFlag(g,unit){
  const mg = unit==='mmol/L' ? Number(g)*18 : Number(g);
  if(!isFinite(mg)) return '';
  if(mg<70) return 'low';
  if(mg>180) return 'high';
  return 'ok';
}

let _activeCondition = null;
function showCondition(id){
  _activeCondition = id;
  showPage('condition');
}

function renderDashboard(){
  const cont=document.getElementById('dashboardContent');
  if(!cont) return;
  cont.innerHTML='';
  const enabled=enabledConditions();
  const measures=asthmaMeasures();
  const crisis=isCrisis ? isCrisis(measures, DB.bestDEP) : false;

  // Crisis banner on Accueil (safety)
  if(crisis && enabled.includes('asthma')){
    cont.insertAdjacentHTML('beforeend', `<div class="crisis-banner"><div class="crisis-banner-icon">🚨</div><div class="crisis-banner-text"><div class="crisis-banner-title">${escHtml(t('crisis_title'))}</div><div class="crisis-banner-sub">${escHtml(t('crisis_sub'))}</div></div></div>`);
  }
  // Reminders on Accueil
  const activeRem=(DB.reminders||[]).filter(r=>r&&r.active);
  if(activeRem.length){
    const remCard=document.createElement('div');remCard.className='card';
    const remTitle=document.createElement('div');remTitle.className='card-title';remTitle.textContent=t('db_active_reminders');
    const remBody=document.createElement('div');
    activeRem.forEach(r=>{ const badge=document.createElement('span');badge.className='reminder-badge';badge.textContent=`🔔 ${r.time||''} — ${r.label||''}`;remBody.appendChild(badge); });
    remCard.appendChild(remTitle);remCard.appendChild(remBody);cont.appendChild(remCard);
  }

  const head=document.createElement('div');head.className='section-header';
  head.innerHTML=`<div><div class="card-title" style="margin:0">${escHtml(t('hub_title'))}</div><div style="font-size:13px;color:var(--muted);margin-top:2px">${escHtml(t('hub_sub'))}</div></div>`;
  cont.appendChild(head);

  if(!enabled.length){
    cont.insertAdjacentHTML('beforeend', `<div class="empty-state"><p>${escHtml(t('panel_no_data'))}</p></div>`);
    return;
  }
  const panels=document.createElement('div');panels.className='condition-panels';
  enabled.forEach(id=>{
    const p=document.createElement('button');p.type='button';p.className='condition-panel';p.style.borderLeftColor=conditionColor(id);
    p.setAttribute('data-action','showCondition');p.setAttribute('data-val',id);
    let value=t('panel_no_data'), sub='', meta='';
    if(id==='asthma'){
      const last=measures[0];
      if(last){
        const dz=depZone?depZone(last.dep,DB.bestDEP):'green';
        const pct = DB.bestDEP?Math.round((last.dep/DB.bestDEP)*100):null;
        value = `${last.dep||'—'} L/min`;
        sub = `${t('panel_last')}: ${new Date(last.dt).toLocaleDateString(t('locale'),{day:'2-digit',month:'short'})}`;
        meta = `<span class="zone-badge ${zoneClass?zoneClass(dz):'zone-green'}">${escHtml(zoneLabel?zoneLabel(dz):dz)}</span>${pct!=null?`<span class="condition-chip">${pct}%</span>`:''}<span class="condition-chip">${measures.length}</span>`;
      }
    } else if(id==='hypertension'){
      const e=conditionEntriesOf('hypertension')[0]; const d=e&&e.data||{};
      if(e && d.systolic!=null){
        value = `${d.systolic}/${d.diastolic} mmHg`;
        const cat=htnCategory(d.systolic,d.diastolic);
        sub = `${t('panel_last')}: ${new Date(e.timestamp).toLocaleDateString(t('locale'),{day:'2-digit',month:'short'})}`;
        meta = `<span class="condition-chip">${escHtml(catLabel(cat))}</span>${d.pulse?`<span class="condition-chip">${d.pulse} bpm</span>`:''}<span class="condition-chip">${conditionEntriesOf('hypertension').length}</span>`;
      }
    } else if(id==='diabetes'){
      const e=conditionEntriesOf('diabetes')[0]; const d=e&&e.data||{};
      if(e && d.glucose!=null){
        value = `${d.glucose} ${d.unit||'mg/dL'}`;
        const fl=glucoseFlag(d.glucose,d.unit);
        sub = `${t('panel_last')}: ${new Date(e.timestamp).toLocaleDateString(t('locale'),{day:'2-digit',month:'short'})}`;
        meta = `${fl?`<span class="condition-chip">${escHtml(fl)}</span>`:''}${d.context?`<span class="condition-chip">${escHtml(d.context)}</span>`:''}<span class="condition-chip">${conditionEntriesOf('diabetes').length}</span>`;
      }
    }
    p.innerHTML = `<div class="condition-panel-head"><div class="condition-panel-title">${escHtml(conditionLabel(id))}</div><div class="condition-panel-chevron">›</div></div><div class="condition-panel-value">${escHtml(String(value))}</div><div class="condition-panel-sub">${escHtml(sub)}</div><div class="condition-panel-meta">${meta}</div>`;
    panels.appendChild(p);
  });
  cont.appendChild(panels);
}

function renderConditionDetail(){
  const cont=document.getElementById('conditionDetail');
  if(!cont) return;
  const id=_activeCondition || enabledConditions()[0] || 'asthma';
  _activeCondition=id;
  cont.innerHTML='';
  const back=document.createElement('button');back.className='condition-detail-back';back.type='button';back.setAttribute('data-action','showPage');back.setAttribute('data-val','dashboard');back.textContent=t('detail_back');
  cont.appendChild(back);
  if(id==='asthma') renderAsthmaDetail(cont);
  else if(id==='hypertension') renderHypertensionDetail(cont);
  else if(id==='diabetes') renderDiabetesDetail(cont);
  else cont.insertAdjacentHTML('beforeend', `<div class="empty-state"><p>${escHtml(t('panel_no_data'))}</p></div>`);
}

function renderAsthmaDetail(cont){
  const measures=asthmaMeasures();
  const crisis=isCrisis?isCrisis(measures,DB.bestDEP):false;
  const head=document.createElement('div');head.className='section-header';
  head.innerHTML=`<div class="card-title" style="margin:0">${escHtml(t('cond_asthma'))}</div><button class="btn-inline primary" data-action="showPage" data-val="saisie">${escHtml(t('panel_add'))}</button>`;
  cont.appendChild(head);
  if(crisis){
    cont.insertAdjacentHTML('beforeend', `<div class="crisis-banner"><div class="crisis-banner-icon">🚨</div><div class="crisis-banner-text"><div class="crisis-banner-title">${escHtml(t('crisis_title'))}</div><div class="crisis-banner-sub">${escHtml(t('crisis_sub'))}</div></div></div>`);
  }
  if(!measures.length){
    cont.insertAdjacentHTML('beforeend', `<div class="empty-state"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg><p>${escHtml(t('db_no_data').replace(/<br\/?\s*>/gi,' '))}</p></div>`);
    return;
  }
  const last=measures[0], dz=depZone(last.dep,DB.bestDEP), sz=spo2Zone(last.spo2), depPct=DB.bestDEP?Math.round((last.dep/DB.bestDEP)*100):null;
  const depDetail=[last.dep1,last.dep2,last.dep3].filter(Boolean);
  const recent=[...measures].sort((a,b)=>new Date(a.dt)-new Date(b.dt)).slice(-14);
  const labels=recent.map(m=>{const d=new Date(m.dt);return d.getDate()+'/'+(d.getMonth()+1);});
  const depTrend=calcTrend(measures,'dep');
  const spo2Trend=calcTrend(measures,'spo2');

  const card=document.createElement('div');card.className='card';
  const cardTitle=document.createElement('div');cardTitle.className='card-title';
  cardTitle.textContent=`${t('db_last_measure')} — ${new Date(last.dt).toLocaleDateString(t('locale'),{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}`;
  card.appendChild(cardTitle);
  const grid=document.createElement('div');grid.className='metrics-grid';
  const depBox=document.createElement('div');depBox.className=`metric-box ${dz}`;
  depBox.innerHTML=`<div class="metric-label">${escHtml(t('db_dep_avg'))}</div><div class="metric-value">${escHtml(String(last.dep))}${trendArrow(depTrend,'dep')}</div><div class="metric-unit">L/min</div>${depPct!=null?`<div class="metric-pct">${depPct}% ${escHtml(t('db_best_pct'))}</div>`:''}${depDetail.length>1?`<div class="dep-measurements">${escHtml(depDetail.join(' · '))}</div>`:''}`;
  const spo2Box=document.createElement('div');spo2Box.className=`metric-box ${sz}`;
  spo2Box.innerHTML=`<div class="metric-label">SpO₂</div><div class="metric-value">${escHtml(String(last.spo2))}${trendArrow(spo2Trend,'spo2')}</div><div class="metric-unit">%</div>`;
  grid.appendChild(depBox);grid.appendChild(spo2Box);card.appendChild(grid);
  const badges=document.createElement('div');badges.style.cssText='margin-top:12px;display:flex;gap:8px;flex-wrap:wrap';
  badges.innerHTML=`<span class="zone-badge ${zoneClass(dz)}">${escHtml(zoneLabel(dz))}</span><span class="zone-badge ${zoneClass(sz)}">${escHtml(zoneLabel(sz))}</span><span class="zone-badge" style="background:rgba(79,156,249,.1);color:var(--accent)">💊 ${escHtml(String(last.easy))} ${escHtml(last.easy>1?t('dose_plural'):t('dose_singular'))}</span>`;
  card.appendChild(badges);
  if(last.comment){ const c=document.createElement('div');c.style.cssText='margin-top:10px;font-size:14px;color:var(--muted);font-style:italic';c.textContent=`"${last.comment}"`;card.appendChild(c); }
  cont.appendChild(card);
  cont.insertAdjacentHTML('beforeend', `<div class="card"><div class="card-title">${escHtml(t('db_dep_chart'))}</div><div class="chart-wrap"><canvas id="chartDEP"></canvas></div></div>`);
  cont.insertAdjacentHTML('beforeend', `<div class="card"><div class="card-title">${escHtml(t('db_spo2_chart'))}</div><div class="chart-wrap"><canvas id="chartSPO2"></canvas></div></div>`);
  drawLineChart('chartDEP',labels,recent.map(m=>m.dep),'#4f9cf9');
  drawLineChart('chartSPO2',labels,recent.map(m=>m.spo2),'#10d9a0');
}

function renderHypertensionDetail(cont){
  const entries=conditionEntriesOf('hypertension');
  const head=document.createElement('div');head.className='section-header';
  head.innerHTML=`<div class="card-title" style="margin:0">${escHtml(t('cond_bp_title'))}</div><button class="btn-inline primary" data-action="showPage" data-val="saisie-htn">${escHtml(t('panel_add'))}</button>`;
  cont.appendChild(head);
  if(!entries.length){ cont.insertAdjacentHTML('beforeend', `<div class="empty-state"><p>${escHtml(t('panel_no_data'))}</p></div>`); return; }
  const last=entries[0], d=last.data||{}, cat=htnCategory(d.systolic,d.diastolic);
  const card=document.createElement('div');card.className='card';
  card.innerHTML=`<div class="card-title">${escHtml(t('panel_last'))}</div><div class="condition-panel-value">${d.systolic||'—'}/${d.diastolic||'—'} <span style="font-size:16px;font-weight:600">mmHg</span></div><div class="condition-panel-meta"><span class="condition-chip">${escHtml(catLabel(cat))}</span>${d.pulse?`<span class="condition-chip">${d.pulse} bpm</span>`:''}${d.position?`<span class="condition-chip">${escHtml(d.position)}</span>`:''}</div><div class="condition-panel-sub" style="margin-top:8px">${escHtml(new Date(last.timestamp).toLocaleString(t('locale')))}</div>`;
  cont.appendChild(card);
  const recent=[...entries].reverse().slice(-14);
  cont.insertAdjacentHTML('beforeend', `<div class="card"><div class="card-title">${escHtml(t('bp_chart'))}</div><div style="display:flex;gap:14px;margin:-4px 0 6px;font-size:11px;color:var(--muted)"><span style="display:flex;align-items:center;gap:5px"><i style="width:10px;height:3px;border-radius:2px;background:#f97316;display:inline-block"></i>${escHtml(t('pdf_sys_label'))}</span><span style="display:flex;align-items:center;gap:5px"><i style="width:10px;height:3px;border-radius:2px;background:#4f9cf9;display:inline-block"></i>${escHtml(t('pdf_dia_label'))}</span></div><div class="chart-wrap"><canvas id="chartBP"></canvas></div></div>`);
  const labels=recent.map(e=>{const dt=new Date(e.timestamp);return dt.getDate()+'/'+(dt.getMonth()+1);});
  drawLineChart('chartBP',labels,[
    {values:recent.map(e=>Number((e.data||{}).systolic)||0),color:'#f97316',label:t('pdf_sys_label')},
    {values:recent.map(e=>Number((e.data||{}).diastolic)||0),color:'#4f9cf9',label:t('pdf_dia_label')},
  ]);
  const list=document.createElement('div');list.className='card';list.innerHTML=`<div class="card-title">${escHtml(t('detail_history'))}</div>`;
  entries.slice(0,10).forEach(e=>{ const x=e.data||{}; const c=htnCategory(x.systolic,x.diastolic); list.insertAdjacentHTML('beforeend', `<div style="padding:8px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:8px"><div><b>${x.systolic}/${x.diastolic}</b> mmHg ${x.pulse?`• ${x.pulse}`:''}<div style="font-size:12px;color:var(--muted)">${escHtml(catLabel(c))}</div></div><div style="font-size:12px;color:var(--muted);text-align:right">${new Date(e.timestamp).toLocaleDateString(t('locale'))}</div></div>`); });
  cont.appendChild(list);
}

function renderDiabetesDetail(cont){
  const entries=conditionEntriesOf('diabetes');
  const head=document.createElement('div');head.className='section-header';
  head.innerHTML=`<div class="card-title" style="margin:0">${escHtml(t('cond_glucose_title'))}</div><button class="btn-inline primary" data-action="showPage" data-val="saisie-diabete">${escHtml(t('panel_add'))}</button>`;
  cont.appendChild(head);
  if(!entries.length){ cont.insertAdjacentHTML('beforeend', `<div class="empty-state"><p>${escHtml(t('panel_no_data'))}</p></div>`); return; }
  const last=entries[0], d=last.data||{}, fl=glucoseFlag(d.glucose,d.unit);
  const card=document.createElement('div');card.className='card';
  card.innerHTML=`<div class="card-title">${escHtml(t('panel_last'))}</div><div class="condition-panel-value">${d.glucose||'—'} <span style="font-size:16px;font-weight:600">${escHtml(d.unit||'mg/dL')}</span></div><div class="condition-panel-meta">${fl?`<span class="condition-chip">${escHtml(fl)}</span>`:''}${d.context?`<span class="condition-chip">${escHtml(d.context)}</span>`:''}${d.insulin!=null?`<span class="condition-chip">ins ${d.insulin}</span>`:''}</div><div class="condition-panel-sub" style="margin-top:8px">${escHtml(new Date(last.timestamp).toLocaleString(t('locale')))}</div>`;
  cont.appendChild(card);
  const recent=[...entries].reverse().slice(-14);
  cont.insertAdjacentHTML('beforeend', `<div class="card"><div class="card-title">${escHtml(t('glucose_chart'))}</div><div class="chart-wrap"><canvas id="chartGlucose"></canvas></div></div>`);
  drawLineChart('chartGlucose',recent.map(e=>{const dt=new Date(e.timestamp);return dt.getDate()+'/'+(dt.getMonth()+1);}),recent.map(e=>(e.data||{}).glucose||0),'#a78bfa');
  const list=document.createElement('div');list.className='card';list.innerHTML=`<div class="card-title">${escHtml(t('detail_history'))}</div>`;
  entries.slice(0,10).forEach(e=>{ const x=e.data||{}; list.insertAdjacentHTML('beforeend', `<div style="padding:8px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:8px"><div><b>${x.glucose}</b> ${escHtml(x.unit||'mg/dL')} ${x.context?`• ${escHtml(x.context)}`:''}</div><div style="font-size:12px;color:var(--muted);text-align:right">${new Date(e.timestamp).toLocaleDateString(t('locale'))}</div></div>`); });
  cont.appendChild(list);
}

function drawLineChart(id,labels,data,color,yMin,yMax){
  const canvas=document.getElementById(id);if(!canvas)return;
  // H matches .chart-wrap height in CSS (180px). Use 2x DPR minimum for sharpness.
  const dpr=Math.max(window.devicePixelRatio||1,2),W=canvas.offsetWidth||600,H=180;
  canvas.width=W*dpr;canvas.height=H*dpr;canvas.style.width=W+'px';canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const FONT_SIZE=11,pad={top:10,right:12,bottom:28,left:42},w=W-pad.left-pad.right,h=H-pad.top-pad.bottom;
  const FONT='500 '+FONT_SIZE+'px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  const series=(Array.isArray(data)&&data.length&&typeof data[0]==='object')?data:[{values:data,color}];
  const all=series.flatMap(s=>s.values||[]);
  // Tight dynamic range: add 5% padding around actual data min/max
  if(all.length){
    const lo=Math.min(...all),hi=Math.max(...all);
    const margin=(hi-lo)*0.15||5;
    yMin=lo-margin; yMax=hi+margin;
  }
  const range=yMax-yMin||1,toX=i=>pad.left+(i/(labels.length-1||1))*w,toY=v=>pad.top+h-((v-yMin)/range)*h;
  ctx.clearRect(0,0,W,H);if(!all.length)return;
  const _gridCol='rgba(200,210,220,0.12)';
  const _mutedCol=getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()||'#6b7280';
  // Y grid lines and labels — pick 4 nice round values
  const nTicks=4;
  ctx.strokeStyle=_gridCol;ctx.lineWidth=1;
  for(let i=0;i<=nTicks;i++){
    const v=yMin+(range/nTicks)*i,y=toY(v);
    ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(pad.left+w,y);ctx.stroke();
    ctx.fillStyle=_mutedCol;ctx.font=FONT;ctx.textAlign='right';
    ctx.fillText(Math.round(v),pad.left-6,y+FONT_SIZE*0.35);
  }
  series.forEach(s=>{
    const vals=s.values||[],c=s.color||color;
    // Gradient fill under line
    const grad=ctx.createLinearGradient(0,pad.top,0,pad.top+h);grad.addColorStop(0,c+'55');grad.addColorStop(1,c+'00');
    if(vals.length>1){ctx.beginPath();ctx.moveTo(toX(0),toY(vals[0]));vals.forEach((v,i)=>{if(i>0)ctx.lineTo(toX(i),toY(v));});ctx.lineTo(toX(vals.length-1),pad.top+h);ctx.lineTo(toX(0),pad.top+h);ctx.closePath();ctx.fillStyle=grad;ctx.fill();}
    // Line
    ctx.beginPath();ctx.strokeStyle=c;ctx.lineWidth=2;ctx.lineJoin='round';ctx.lineCap='round';
    vals.forEach((v,i)=>{if(i===0)ctx.moveTo(toX(i),toY(v));else ctx.lineTo(toX(i),toY(v));});ctx.stroke();
    // Dots — small solid filled circles, no ring
    vals.forEach((v,i)=>{ctx.beginPath();ctx.arc(toX(i),toY(v),3,0,Math.PI*2);ctx.fillStyle=c;ctx.fill();});
  });
  // X labels
  ctx.fillStyle=_mutedCol;ctx.font=FONT;ctx.textAlign='center';
  const step=Math.max(1,Math.ceil(labels.length/7));
  labels.forEach((l,i)=>{if(i%step===0||i===labels.length-1)ctx.fillText(l,toX(i),H-8);});
}


// ══════════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════════
const HISTORY_PAGE_SIZE = 30;
let _historyShown = HISTORY_PAGE_SIZE;

function _buildHistoryItem(m) {
  const dz=depZone(m.dep,DB.bestDEP),sz=spo2Zone(m.spo2),d=new Date(m.dt);
  const dateStr=d.toLocaleDateString(t('locale'),{weekday:'short',day:'2-digit',month:'short'})+' '+d.toLocaleTimeString(t('locale'),{hour:'2-digit',minute:'2-digit'});
  const depDetail=[m.dep1,m.dep2,m.dep3].filter(Boolean);

  const item=document.createElement('div');item.className='history-item';
  const delBtn=document.createElement('button');delBtn.className='history-swipe-bg icon-action-btn del';delBtn.textContent='🗑';
  delBtn.addEventListener('click',()=>deleteMeasure(m.id));
  item.appendChild(delBtn);

  const body=document.createElement('div');body.style.flex='1';
  const dateLine=document.createElement('div');dateLine.className='history-date';dateLine.textContent=dateStr;
  body.appendChild(dateLine);

  const vals=document.createElement('div');vals.className='history-vals';
  const depChip=document.createElement('span');depChip.className=`history-chip zone-badge ${zoneClass(dz)}`;
  depChip.textContent=`${t('db_dep_avg').split(' ')[0]} ${m.dep}${depDetail.length>1?t('dep_avg_suffix'):''}`;
  const spo2Chip=document.createElement('span');spo2Chip.className=`history-chip zone-badge ${zoneClass(sz)}`;
  spo2Chip.textContent=`SpO₂ ${m.spo2}%`;
  const easyChip=document.createElement('span');easyChip.className='history-chip';easyChip.style.color='var(--accent)';
  easyChip.textContent=`💊 ${m.easy}`;
  vals.appendChild(depChip);vals.appendChild(spo2Chip);vals.appendChild(easyChip);
  body.appendChild(vals);

  if(depDetail.length>1){
    const dm=document.createElement('div');dm.className='dep-measurements';dm.style.marginTop='4px';
    dm.textContent=`${t('breaths_label')} : ${depDetail.join(' · ')}`;
    body.appendChild(dm);
  }
  if(m.comment){
    const commentEl=document.createElement('div');commentEl.className='history-comment';
    commentEl.textContent=`"${m.comment}"`;
    body.appendChild(commentEl);
  }
  item.appendChild(body);

  const actions=document.createElement('div');actions.className='history-actions';
  const editBtn=document.createElement('button');editBtn.className='icon-action-btn edit';editBtn.textContent='✏️';
  editBtn.addEventListener('click',()=>openEditModal(m.id));
  actions.appendChild(editBtn);
  item.appendChild(actions);

  return item;
}
function _htnZoneClass(cat){ return cat==='normal'?'green':(cat==='elevated'||cat==='stage1')?'yellow':'red'; }
function _glucoseZoneClass(fl){ return fl==='ok'?'green':fl==='low'?'red':'yellow'; }

function _buildConditionHistoryItem(e){
  const d=e.data||{},ts=new Date(e.timestamp||0);
  const dateStr=ts.toLocaleDateString(t('locale'),{weekday:'short',day:'2-digit',month:'short'})+' '+ts.toLocaleTimeString(t('locale'),{hour:'2-digit',minute:'2-digit'});

  const item=document.createElement('div');item.className='history-item';
  const delBtn=document.createElement('button');delBtn.className='history-swipe-bg icon-action-btn del';delBtn.textContent='🗑';
  delBtn.addEventListener('click',()=>deleteConditionEntry(e.id));
  item.appendChild(delBtn);

  const body=document.createElement('div');body.style.flex='1';
  const dateLine=document.createElement('div');dateLine.className='history-date';dateLine.textContent=dateStr;
  body.appendChild(dateLine);

  const vals=document.createElement('div');vals.className='history-vals';
  if(e.conditionId==='hypertension'){
    const cat=htnCategory(d.systolic,d.diastolic);
    const bpChip=document.createElement('span');bpChip.className=`history-chip zone-badge ${zoneClass(_htnZoneClass(cat))}`;
    bpChip.textContent=`${t('bp_short')||'TA'} ${d.systolic||'—'}/${d.diastolic||'—'} mmHg`;
    vals.appendChild(bpChip);
    if(d.pulse){const c=document.createElement('span');c.className='history-chip';c.textContent=`♥ ${d.pulse} bpm`;vals.appendChild(c);}
    if(d.position){const c=document.createElement('span');c.className='history-chip';c.textContent=`📍 ${d.position}`;vals.appendChild(c);}
  } else if(e.conditionId==='diabetes'){
    const fl=glucoseFlag(d.glucose,d.unit);
    const glChip=document.createElement('span');glChip.className=`history-chip zone-badge ${zoneClass(_glucoseZoneClass(fl))}`;
    glChip.textContent=`${t('cond_glucose_title')} ${d.glucose||'—'} ${d.unit||'mg/dL'}`;
    vals.appendChild(glChip);
    if(d.context){const c=document.createElement('span');c.className='history-chip';c.textContent=d.context;vals.appendChild(c);}
    if(d.insulin!=null){const c=document.createElement('span');c.className='history-chip';c.style.color='var(--accent)';c.textContent=`💉 ${d.insulin} U`;vals.appendChild(c);}
  }
  body.appendChild(vals);

  const note=e.conditionId==='hypertension'?d.comment:(d.comment||d.meals);
  if(note){
    const commentEl=document.createElement('div');commentEl.className='history-comment';
    commentEl.textContent=`"${note}"`;
    body.appendChild(commentEl);
  }
  item.appendChild(body);

  const actions=document.createElement('div');actions.className='history-actions';
  const editBtn=document.createElement('button');editBtn.className='icon-action-btn edit';editBtn.textContent='✏️';
  editBtn.addEventListener('click',()=>openEntryEdit(e.id));
  actions.appendChild(editBtn);
  item.appendChild(actions);

  return item;
}

function renderHistory(reset=true){
  const cont=document.getElementById('historyList');
  const measures=DB.measures||[];
  const entries=(DB.conditionEntries||[]).filter(e=>e.conditionId && e.conditionId!=='asthma');
  const items=[
    ...measures.map(m=>({kind:'measure',ts:new Date(m.dt||0).getTime(),m})),
    ...entries.map(e=>({kind:'entry',ts:new Date(e.timestamp||0).getTime(),e}))
  ].sort((a,b)=>b.ts-a.ts);
  if(!items.length){
    cont.innerHTML=`<div class="empty-state"><p>${t('history_empty')}</p><button class="empty-state-cta" data-action="showPage" data-val="saisie">${t('btn_save_measure')}</button></div>`;
    return;
  }
  if(reset) _historyShown=HISTORY_PAGE_SIZE;
  cont.innerHTML='';
  items.slice(0,_historyShown).forEach(it=>{
    cont.appendChild(it.kind==='measure'?_buildHistoryItem(it.m):_buildConditionHistoryItem(it.e));
  });
  if(items.length>_historyShown){
    const remaining=items.length-_historyShown;
    const loadBtn=document.createElement('button');
    loadBtn.className='btn-secondary';
    loadBtn.style.cssText='display:block;width:100%;margin:12px 0;';
    loadBtn.textContent=`${t('history_load_more')} (${remaining})`;
    loadBtn.addEventListener('click',()=>{
      _historyShown+=HISTORY_PAGE_SIZE;
      renderHistory(false);
    });
    cont.appendChild(loadBtn);
  }
}
function deleteMeasure(id){if(!confirm(t('toast_deleted_confirm')))return;DB.measures=DB.measures.filter(m=>m.id!==id);driveAutoSync();renderHistory();}
function deleteConditionEntry(id){if(!confirm(t('toast_deleted_confirm')))return;DB.conditionEntries=(DB.conditionEntries||[]).filter(e=>e.id!==id);driveAutoSync();renderHistory();}

let _editingEntryId=null;
function _toLocalInput(iso){
  const d=new Date(iso||Date.now()); if(isNaN(d)) return '';
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function openEntryEdit(id){
  const e=(DB.conditionEntries||[]).find(x=>x.id===id); if(!e) return;
  const d=e.data||{};
  const set=(k,v)=>{const el=document.getElementById(k);if(el)el.value=v==null?'':v;};
  if(e.conditionId==='hypertension'){
    showPage('saisie-htn');
    set('htnSys',d.systolic); set('htnDia',d.diastolic); set('htnPulse',d.pulse);
    set('htnPos',d.position||'assis'); set('htnComment',d.comment||''); set('htnDatetime',_toLocalInput(e.timestamp));
  } else if(e.conditionId==='diabetes'){
    showPage('saisie-diabete');
    set('dmGlucose',d.glucose); set('dmUnit',d.unit||'mg/dL'); set('dmContext',d.context||'');
    set('dmInsulin',d.insulin); set('dmComment',d.comment||d.meals||''); set('dmDatetime',_toLocalInput(e.timestamp));
  }
  _editingEntryId=id;
}

// ══════════════════════════════════════════
//  PDF EXPORT
// ══════════════════════════════════════════
function _pdfConditionCount(id){
  return id==='asthma' ? (DB.measures||[]).length : conditionEntriesOf(id).length;
}
function exportPDF(){
  const ids=['asthma','hypertension','diabetes'];
  if(ids.every(id=>!_pdfConditionCount(id))){showToast(t('toast_pdf_no_data'),'error');return;}
  if(!window.jspdf){showToast(t('toast_pdf_error'),'error');return;}
  openPdfModal();
}
function openPdfModal(){
  const list=document.getElementById('pdfConditionList');
  const modal=document.getElementById('pdfModal');
  if(!list||!modal){ _doExportPDF(['asthma','hypertension','diabetes']); return; }
  list.innerHTML='';
  ['asthma','hypertension','diabetes'].forEach(id=>{
    const n=_pdfConditionCount(id);
    const row=document.createElement('label');row.className='pdf-cond-row'+(n?'':' disabled');
    const cb=document.createElement('input');cb.type='checkbox';cb.value=id;cb.checked=n>0;cb.disabled=!n;
    const name=document.createElement('span');name.className='pdf-cond-name';name.textContent=conditionLabel(id);
    const count=document.createElement('span');count.className='pdf-cond-count';count.textContent=t('pdf_select_count',n);
    row.appendChild(cb);row.appendChild(name);row.appendChild(count);
    list.appendChild(row);
  });
  modal.classList.add('open');
}
function closePdfModal(){ document.getElementById('pdfModal').classList.remove('open'); }
function confirmExportPDF(){
  const selected=Array.from(document.querySelectorAll('#pdfConditionList input[type="checkbox"]:checked')).map(cb=>cb.value);
  if(!selected.length){showToast(t('pdf_select_none'),'error');return;}
  closePdfModal();
  _doExportPDF(selected);
}
async function _doExportPDF(selected){
  const sel=new Set(selected||[]);
  const measures=sel.has('asthma')?(DB.measures||[]).slice():[];
  const entries=(DB.conditionEntries||[]).filter(e=>e.conditionId && e.conditionId!=='asthma' && sel.has(e.conditionId)).slice().sort((a,b)=>new Date(a.timestamp||0)-new Date(b.timestamp||0));
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const blue=[79,156,249],dark=[22,25,32],muted=[150,160,175],rowAlt=[26,29,38];
  doc.setFillColor(...dark);doc.rect(0,0,210,297,'F');
  doc.setFillColor(...blue);doc.rect(0,0,210,18,'F');
  doc.setTextColor(255,255,255);doc.setFontSize(13);doc.setFont('helvetica','bold');
  doc.text(t('pdf_title'),10,12);
  doc.setFontSize(8);doc.setFont('helvetica','normal');
  doc.text(t('pdf_generated',new Date().toLocaleDateString(t('locale')),new Date().toLocaleTimeString(t('locale'),{hour:'2-digit',minute:'2-digit'})),200,12,{align:'right'});
  const cols=t('pdf_cols');
  const widths=[22,16,18,22,20,14,20,14,44];
  let y=28;
  doc.setFillColor(30,34,45);doc.rect(8,y-5,194,7,'F');
  doc.setTextColor(...blue);doc.setFontSize(7);doc.setFont('helvetica','bold');
  let x=10;cols.forEach((c,i)=>{doc.text(c,x,y);x+=widths[i];});
  y+=5;
  const sorted=[...measures].sort((a,b)=>new Date(b.dt)-new Date(a.dt));
  sorted.forEach((m,idx)=>{
    if(y>282){doc.addPage();doc.setFillColor(...dark);doc.rect(0,0,210,297,'F');y=15;}
    const d=new Date(m.dt);
    const souffles=[m.dep1,m.dep2,m.dep3].filter(Boolean).join('/');
    const dz=depZone(m.dep,DB.bestDEP);const zc=dz==='green'?[16,217,160]:dz==='yellow'?[251,191,36]:[240,79,79];
    const row=[
      d.toLocaleDateString('fr-FR'),
      d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),
      m.dep+' L/m',
      souffles||'-',
      zoneLabel(dz).replace(/🟢|🟡|🔴/g,'').trim(),
      (m.spo2||'-')+'%',
      m.spo2?zoneLabel(spo2Zone(m.spo2)).replace(/🟢|🟡|🔴/g,'').trim():'-',
      m.easy!=null?m.easy+' '+t('prise_short'):'-',
      (m.comment||'').slice(0,30)
    ];
    if(idx%2===0){doc.setFillColor(...rowAlt);doc.rect(8,y-4,194,6,'F');}
    doc.setFont('helvetica','normal');doc.setFontSize(7);
    x=10;
    row.forEach((cell,i)=>{
      if(i===4){doc.setTextColor(...zc);}
      else if(i===6&&m.spo2){const sz=spo2Zone(m.spo2);doc.setTextColor(...(sz==='green'?[16,217,160]:sz==='yellow'?[251,191,36]:[240,79,79]));}
      else{doc.setTextColor(...muted);}
      doc.text(String(cell||''),x,y,{maxWidth:widths[i]-2});
      x+=widths[i];
    });
    y+=6;
  });
  entries.forEach((e,idx)=>{
    if(y>282){doc.addPage();doc.setFillColor(...dark);doc.rect(0,0,210,297,'F');y=15;}
    const d=e.timestamp?new Date(e.timestamp):new Date();
    let row;
    if(e.conditionId==='hypertension'){
      const h=e.data||{};
      row=[d.toLocaleDateString('fr-FR'),d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),`TA ${h.systolic||''}/${h.diastolic||''}`,'',h.pulse||'-',h.pulse||'-','-','-', (h.comment||'').slice(0,30)];
    } else {
      const dm=e.data||{};
      row=[d.toLocaleDateString('fr-FR'),d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),`Glyc ${dm.glucose||''} ${dm.unit||'mg/dL'}`,dm.context||'-','-',dm.glucose||'-','-','-', (dm.comment||dm.meals||'').slice(0,30)];
    }
    if((sorted.length+idx)%2===0){doc.setFillColor(...rowAlt);doc.rect(8,y-4,194,6,'F');}
    doc.setFont('helvetica','normal');doc.setFontSize(7);
    x=10;
    row.forEach((cell,i)=>{ doc.setTextColor(...muted); doc.text(String(cell||''),x,y,{maxWidth:widths[i]-2}); x+=widths[i]; });
    y+=6;
  });
  doc.setTextColor(60,70,90);doc.setFontSize(7);
  doc.text(t('pdf_footer',sorted.length+entries.length),10,292);

  // ── Charts — only selected conditions with data ──────────────────────
  const chartDefs=[];
  const chartRecent=[...measures].sort((a,b)=>new Date(a.dt)-new Date(b.dt)).slice(-14);
  if(sel.has('asthma') && chartRecent.length>0){
    const labels=chartRecent.map(m=>{const d=new Date(m.dt);return d.getDate()+'/'+(d.getMonth()+1);});
    chartDefs.push({label:t('pdf_dep_label'),color:blue,labels,series:[{values:chartRecent.map(m=>m.dep),color:'#4f9cf9'}]});
    const spo2Recent=chartRecent.filter(m=>m.spo2!=null);
    if(spo2Recent.length>0){
      const spo2Labels=spo2Recent.map(m=>{const d=new Date(m.dt);return d.getDate()+'/'+(d.getMonth()+1);});
      chartDefs.push({label:t('pdf_spo2_label'),color:[16,217,160],labels:spo2Labels,series:[{values:spo2Recent.map(m=>Number(m.spo2)),color:'#10d9a0'}]});
    }
  }
  const conditionChartEntries=(id)=>(DB.conditionEntries||[])
    .filter(e=>e && e.conditionId===id && e.data)
    .sort((a,b)=>new Date(a.timestamp||0)-new Date(b.timestamp||0))
    .slice(-14);
  if(sel.has('hypertension')){
    const recent=conditionChartEntries('hypertension');
    if(recent.length>0){
      const labels=recent.map(e=>{const d=new Date(e.timestamp);return d.getDate()+'/'+(d.getMonth()+1);});
      chartDefs.push({label:t('pdf_bp_label'),color:[249,115,22],labels,series:[
        {values:recent.map(e=>Number((e.data||{}).systolic)||0),color:'#f97316',label:t('pdf_sys_label')},
        {values:recent.map(e=>Number((e.data||{}).diastolic)||0),color:'#4f9cf9',label:t('pdf_dia_label')}
      ]});
    }
  }
  if(sel.has('diabetes')){
    const recent=conditionChartEntries('diabetes');
    if(recent.length>0){
      const labels=recent.map(e=>{const d=new Date(e.timestamp);return d.getDate()+'/'+(d.getMonth()+1);});
      chartDefs.push({label:t('pdf_glucose_label'),color:[167,139,250],labels,series:[
        {values:recent.map(e=>{const x=e.data||{};const g=Number(x.glucose)||0;return x.unit==='mmol/L'?g*18:g;}),color:'#a78bfa'}
      ]});
    }
  }

  if(chartDefs.length>0){
    // Draw a chart onto a dedicated off-screen canvas at fixed high resolution.
    // This is independent of the on-screen canvas size, guaranteeing sharp PDF output.
    const renderChartToImg = (labels, series) => {
      const PX=1800, PY=540;
      const oc=document.createElement('canvas');
      oc.width=PX; oc.height=PY;
      const ctx=oc.getContext('2d');
      const FONT_SIZE=28;
      const FONT='500 '+FONT_SIZE+'px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
      const pad={top:30,right:30,bottom:72,left:110};
      const w=PX-pad.left-pad.right, h=PY-pad.top-pad.bottom;
      ctx.fillStyle='#1e222d'; ctx.fillRect(0,0,PX,PY);
      const all=series.flatMap(s=>s.values);
      const lo=Math.min(...all), hi=Math.max(...all);
      const margin=(hi-lo)*0.15||5;
      const yMin=lo-margin, yMax=hi+margin;
      const range=yMax-yMin||1;
      const toX=i=>pad.left+(i/(labels.length-1||1))*w;
      const toY=v=>pad.top+h-((v-yMin)/range)*h;
      const gridCol='rgba(200,210,220,0.12)';
      const mutedCol='#8892a4';
      ctx.strokeStyle=gridCol; ctx.lineWidth=2; ctx.font=FONT;
      ctx.textAlign='right'; ctx.fillStyle=mutedCol;
      const nTicks=4;
      for(let i=0;i<=nTicks;i++){
        const v=yMin+(range/nTicks)*i;
        const y=toY(v);
        ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(pad.left+w,y); ctx.stroke();
        ctx.fillText(Math.round(v),pad.left-14,y+FONT_SIZE*0.35);
      }
      series.forEach(s=>{
        const data=s.values;
        const grad=ctx.createLinearGradient(0,pad.top,0,pad.top+h);
        grad.addColorStop(0,s.color+'55'); grad.addColorStop(1,s.color+'00');
        if(data.length>1){
          ctx.beginPath();
          ctx.moveTo(toX(0),toY(data[0]));
          data.forEach((v,i)=>{ if(i>0) ctx.lineTo(toX(i),toY(v)); });
          ctx.lineTo(toX(data.length-1),pad.top+h);
          ctx.lineTo(toX(0),pad.top+h);
          ctx.closePath(); ctx.fillStyle=grad; ctx.fill();
        }
        ctx.beginPath(); ctx.strokeStyle=s.color; ctx.lineWidth=5;
        ctx.lineJoin='round'; ctx.lineCap='round';
        data.forEach((v,i)=>{ if(i===0) ctx.moveTo(toX(i),toY(v)); else ctx.lineTo(toX(i),toY(v)); });
        ctx.stroke();
        data.forEach((v,i)=>{
          ctx.beginPath(); ctx.arc(toX(i),toY(v),8,0,Math.PI*2);
          ctx.fillStyle=s.color; ctx.fill();
        });
      });
      const legendItems=series.filter(s=>s.label);
      if(legendItems.length){
        ctx.font='600 22px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
        ctx.textAlign='left'; ctx.textBaseline='middle';
        legendItems.forEach((s,i)=>{
          const lx=pad.left+i*260;
          ctx.fillStyle=s.color; ctx.fillRect(lx,12,24,8);
          ctx.fillStyle='#aab4c4'; ctx.fillText(s.label,lx+34,16);
        });
      }
      ctx.font=FONT; ctx.textBaseline='alphabetic';
      ctx.fillStyle=mutedCol; ctx.textAlign='center';
      const step=Math.max(1,Math.ceil(labels.length/7));
      labels.forEach((l,i)=>{
        if(i%step===0||i===labels.length-1) ctx.fillText(l,toX(i),PY-18);
      });
      return oc.toDataURL('image/png',1.0);
    };

    const chartW=190, chartH=80, perPage=2;
    chartDefs.forEach((def,i)=>{
      if(i%perPage===0){
        doc.addPage();
        doc.setFillColor(...dark); doc.rect(0,0,210,297,'F');
        doc.setFillColor(...blue); doc.rect(0,0,210,12,'F');
        doc.setTextColor(255,255,255); doc.setFontSize(11); doc.setFont('helvetica','bold');
        doc.text(t('pdf_charts_title'),10,9);
      }
      const gy=22+(i%perPage)*(chartH+16);
      try{
        const img=renderChartToImg(def.labels,def.series);
        doc.setFillColor(30,34,45); doc.rect(8,gy-5,194,chartH+10,'F');
        doc.setTextColor(...def.color); doc.setFontSize(8); doc.setFont('helvetica','bold');
        doc.text(def.label,10,gy);
        doc.addImage(img,'PNG',10,gy+3,chartW,chartH);
      }catch(e){ console.warn('PDF chart error:',def.label,e); }
      if(i%perPage===perPage-1 || i===chartDefs.length-1){
        doc.setTextColor(60,70,90); doc.setFontSize(7);
        doc.text(t('pdf_charts_footer'),10,292);
      }
    });
  }
  // ──────────────────────────────────────────────────────────────────────

  const filename = 'asthmetrack_'+new Date().toISOString().slice(0,10)+'.pdf';
  if (IS_CAPACITOR) {
    // Android : sauvegarde dans le dossier Documents via @capacitor/filesystem
    // puis propose le partage via @capacitor/share
    const b64data = doc.output('datauristring').split(',')[1]; // base64 pur sans préfixe
    try {
      // Les plugins Capacitor sont exposés sur window.Capacitor.Plugins
      const Filesystem = window.Capacitor?.Plugins?.Filesystem;
      const Share = window.Capacitor?.Plugins?.Share;
      if (!Filesystem) throw new Error('Plugin Filesystem non disponible — relancez après npx cap sync');
      await Filesystem.writeFile({
        path: filename,
        data: b64data,
        directory: 'DOCUMENTS',
        recursive: true,
      });
      showToast('✓ PDF sauvegardé dans Documents');
      if (Share) {
        const uriResult = await Filesystem.getUri({ path: filename, directory: 'DOCUMENTS' });
        await Share.share({ title: filename, url: uriResult.uri, dialogTitle: 'Partager le PDF' });
      }
    } catch(fsErr) {
      console.error('PDF Filesystem error:', fsErr);
      showToast(t('pdf_save_error',(fsErr.message||'').slice(0,60)), 'error');
    }
  } else {
    doc.save(filename);
  }
  showToast(t('toast_pdf_done'));
}

// ══════════════════════════════════════════
//  GOOGLE DRIVE — SDK natif Android
//  Via @capacitor-community/google-auth
//  Pas de redirect URI, pas de PKCE manuel.
//  Chaque utilisateur accède à SON Drive.
// ══════════════════════════════════════════


// Plugin Social Login via l'objet global Capacitor (pas d'import dynamique)
function getSocialLogin() {
  if (IS_CAPACITOR && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SocialLogin) {
    return window.Capacitor.Plugins.SocialLogin;
  }
  return null;
}


// Extrait le token OAuth2 Drive depuis la réponse du plugin SocialLogin
// Le plugin @capgo/capacitor-social-login retourne {idToken, accessToken, scopes} directement
// (pas de wrapper .result comme on pourrait l'attendre)
function extractDriveToken(result) {
  // Plusieurs shapes possibles selon version du plugin et plateforme
  const r = result?.result ?? result;
  // accessToken peut être une string directe ou un objet {token}
  const token = (typeof r?.accessToken === 'string' ? r.accessToken : r?.accessToken?.token)
             || r?.idToken;
  return token || null;
}
function extractDriveProfile(result) {
  const r = result?.result ?? result;
  // Le profil peut venir d'un champ profile, ou être décodé de l'idToken JWT
  if (r?.profile) return { email: r.profile.email || r.profile.name || 'Compte Google', avatar: r.profile.imageUrl || r.profile.picture || null };
  // Décode le payload de l'idToken (base64url) pour extraire email et picture
  try {
    const payload = JSON.parse(atob(r.idToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    return { email: payload.email || 'Compte Google', avatar: payload.picture || null };
  } catch(e) {}
  return { email: 'Compte Google', avatar: null };
}

// Listener global pour recevoir le résultat du login Android
// (SocialLogin.login() lance une Activity native — la promesse ne résout jamais sur Android)
let _driveLoginListener = null;

async function connectDrive() {
  setSync(true);
  try {
    if (!IS_CAPACITOR) {
      // ── WEB FALLBACK (Google Identity Services) ────────────────────────
      if (!window.google) throw new Error('Google SDK non chargé (vérifiez votre connexion ou bloqueur de pub)');
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'profile email https://www.googleapis.com/auth/drive.appdata',
        callback: async (resp) => {
          if (resp.error) {
            console.error('GSI Error:', resp.error);
            showToast('Drive: ' + resp.error, 'error');
            setSync(false);
            return;
          }
          await DB.setDriveToken(resp.access_token);
          await DB.setDriveTokenExpiry(Date.now() + resp.expires_in * 1000);
          await fetchDriveUserInfo(resp.access_token);
          renderSettings();
          showToast(t('drive_connected_toast'));
          await _driveCheckAndPrompt();
          setSync(false);
        }
      });
      client.requestAccessToken();
      return;
    }

    const SocialLogin = getSocialLogin();
    if (!SocialLogin) {
      showToast(t('drive_plugin_unavailable'),'error');
      setSync(false);
      return;
    }
    await SocialLogin.initialize({ google: { webClientId: GOOGLE_CLIENT_ID } });

    // Sur Android comme sur Web, login() résout la promesse après retour de l'Activity
    // (call.resolve() est appelé dans un Runnable Java après GetCredentialResponse)
    const result = await SocialLogin.login({
      provider: 'google',
      options: { scopes: ['profile', 'email', 'https://www.googleapis.com/auth/drive.appdata'], filterByAuthorizedAccounts: false },
    });
    console.log('Drive login result:', JSON.stringify(result));
    const token = extractDriveToken(result);
    if (!token) { console.error('Drive auth result:', JSON.stringify(result)); throw new Error('Token Drive introuvable — vérifiez la config Google Cloud Console.'); }
    const profile = extractDriveProfile(result);
    await DB.setDriveToken(token);
    await DB.setDriveTokenExpiry(Date.now() + 3500 * 1000);
    DB.driveUser = profile.email;
    DB.driveAvatar = profile.avatar;
    renderSettings();
    showToast(t('drive_connected_toast'));
    // Vérifie s'il existe une sauvegarde sur Drive sans écraser les données locales
    await _driveCheckAndPrompt();
  } catch(e) {
    console.error('Google Auth error:', e);
    showToast('Drive: ' + (e.message||JSON.stringify(e)).slice(0,80), 'error');
  } finally {
    if (IS_CAPACITOR) setSync(false);
  }
}

async function ensureValidToken() {
  const token = await DB.getDriveToken();
  if (!token) return false;
  const expiry = await DB.getDriveTokenExpiry();
  if (Date.now() < expiry - 60000) return true;

  if (!IS_CAPACITOR) {
    // Sur Web, on demande un nouveau token (potentiellement silencieux si déjà autorisé)
    return new Promise((resolve) => {
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'profile email https://www.googleapis.com/auth/drive.appdata',
          prompt: '', // Laisse Google décider si une interaction est requise
          callback: async (resp) => {
            if (resp.error) { resolve(false); return; }
            await DB.setDriveToken(resp.access_token);
            await DB.setDriveTokenExpiry(Date.now() + resp.expires_in * 1000);
            resolve(true);
          }
        });
        client.requestAccessToken();
      } catch(e) { resolve(false); }
    });
  }

  try {
    const SocialLogin = getSocialLogin();
    if (!SocialLogin) { await DB.setDriveToken(null); return false; }
    await SocialLogin.initialize({ google: { webClientId: GOOGLE_CLIENT_ID } });
    const result = await SocialLogin.login({
      provider: 'google',
      options: {
        scopes: ['profile', 'email', 'https://www.googleapis.com/auth/drive.appdata'],
        filterByAuthorizedAccounts: true,
      }
    });
    const newToken = extractDriveToken(result);
    if (newToken) {
      await DB.setDriveToken(newToken);
      await DB.setDriveTokenExpiry(Date.now() + 3500 * 1000);
      return true;
    }
  } catch(e) { await DB.setDriveToken(null); }
  return false;
}
async function fetchDriveUserInfo(token) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: 'Bearer ' + token } });
    const d = await r.json();
    DB.driveUser = d.email || 'Compte Google';
    DB.driveAvatar = d.picture || null;
  } catch(e) { DB.driveUser = 'Compte Google'; }
}


async function _driveCheckAndPrompt() {
  // Vérifie si une sauvegarde existe sur Drive
  setSync(true);
  try {
    const search = await fetch(
      _driveBackupQuery('files(id,name,modifiedTime,size)'),
      { headers: { Authorization: "Bearer " + (await DB.getDriveToken()) } }
    );
    if (!search.ok) {
      const err = await search.text();
      console.error('Drive search error:', search.status, err);
      showToast('Drive: erreur API ' + search.status, 'error');
      setSync(false);
      return;
    }
    const sj = await search.json();
    setSync(false);

    const remote = _pickDriveBackup(sj.files);
    const hasRemote = !!remote;
    const hasLocal = DB.measures && DB.measures.length > 0;

    if (!hasRemote && !hasLocal) {
      // Rien nulle part — rien à faire
      showToast(t('drive_connected_no_backup'));
      return;
    }

    if (!hasRemote && hasLocal) {
      // Données locales seulement → propose de sauvegarder
      if (confirm(t('drive_no_backup').replace('%n', DB.measures.length))) {
        await driveSyncUp();
      }
      return;
    }

    if (hasRemote && !hasLocal) {
      // Backup Drive seulement → restaure directement
      DB.driveFileId = remote.id;
      await driveSyncDown();
      return;
    }

    // Les deux existent → affiche un choix explicite
    const modDate = new Date(remote.modifiedTime).toLocaleDateString(t('locale'), {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const choice = confirm(t('drive_conflict', DB.measures.length, modDate));
    DB.driveFileId = remote.id;
    if (choice) {
      await driveSyncDown();
    } else {
      await driveSyncUp();
    }
  } catch(e) {
    setSync(false);
    console.error('_driveCheckAndPrompt error:', e);
    showToast('Drive: ' + (e.message||'erreur inconnue').slice(0,60), 'error');
  }
}

async function disconnectDrive() {
  if (!confirm(t('drive_disconnect_confirm'))) return;
  try {
    const SocialLogin = getSocialLogin();
    if (SocialLogin) await SocialLogin.logout({ provider: 'google' });
  } catch(e) {}
  await DB.setDriveToken(null);
  await DB.setDriveTokenExpiry(0);
  DB.driveFileId = null;
  DB.driveUser = null;
  DB.driveAvatar = null;
  renderSettings();
  showToast(t('drive_disconnect_toast'));
}

async function driveSyncUp() {
  if (!await ensureValidToken()) { showToast(t('drive_not_connected'),'error'); return; }
  setSync(true);
  try {
    const data = JSON.stringify({ measures: DB.measures, bestDEP: DB.bestDEP, reminders: DB.reminders, profile: DB.profile, conditions: DB.conditions, conditionEntries: DB.conditionEntries, medications: DB.medications, version: 3 });
    const isUpdate = !!DB.driveFileId;
    const url = isUpdate
      // PATCH : mise à jour — pas de parents dans le metadata (erreur 403 sinon)
      ? 'https://www.googleapis.com/upload/drive/v3/files/' + DB.driveFileId + '?uploadType=multipart'
      // POST : création — parents requis pour cibler appDataFolder
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const method = isUpdate ? 'PATCH' : 'POST';
    // Sur PATCH on n'envoie pas parents (Drive API v3 le rejette avec 403)
    const metadata = isUpdate
      ? { name: GDRIVE_FILENAME }
      : { name: GDRIVE_FILENAME, parents: ['appDataFolder'] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([data], { type: 'application/json' }));
    let r = await fetch(url, { method, headers: { Authorization: "Bearer " + (await DB.getDriveToken()) }, body: form });
    // Si 404 sur PATCH : le fichier n'existe plus sur Drive, on recrée
    if (!r.ok && r.status === 404 && isUpdate) {
      console.warn('driveSyncUp: file not found on Drive, recreating...');
      DB.driveFileId = null;
      const newMeta = { name: GDRIVE_FILENAME, parents: ['appDataFolder'] };
      const newForm = new FormData();
      newForm.append('metadata', new Blob([JSON.stringify(newMeta)], { type: 'application/json' }));
      newForm.append('file', new Blob([data], { type: 'application/json' }));
      r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        { method: 'POST', headers: { Authorization: "Bearer " + (await DB.getDriveToken()) }, body: newForm });
    }
    if (!r.ok) {
      const errText = await r.text();
      console.error('driveSyncUp error:', r.status, errText);
      throw new Error('API Drive ' + r.status + ' — ' + errText.slice(0,100));
    }
    const j = await r.json();
    DB.driveFileId = j.id;
    showToast(t('drive_saved'));
  } catch(e) {
    console.error('driveSyncUp error:', e);
    showToast('Drive: ' + (e.message||JSON.stringify(e)).slice(0,80), 'error');
  }
  finally { setSync(false); }
}

async function driveSyncDown() {
  if (!await ensureValidToken()) { showToast(t('drive_not_connected'),'error'); return; }
  setSync(true);
  try {
    const search = await fetch(
      _driveBackupQuery('files(id,name)'),
      { headers: { Authorization: "Bearer " + (await DB.getDriveToken()) } }
    );
    if (!search.ok) {
      const errText = await search.text();
      console.error('driveSyncDown search error:', search.status, errText);
      throw new Error('API Drive ' + search.status + ' — ' + errText.slice(0,100));
    }
    const sj = await search.json();
    const remote = _pickDriveBackup(sj.files);
    if (!remote) { showToast(t('drive_no_backup_found')); setSync(false); return; }
    DB.driveFileId = remote.id;
    const dl = await fetch(
      `https://www.googleapis.com/drive/v3/files/${DB.driveFileId}?alt=media`,
      { headers: { Authorization: "Bearer " + (await DB.getDriveToken()) } }
    );
    const d = migrateBackupData(await dl.json());
    if (Array.isArray(d.measures))        DB.measures        = d.measures;
    if (d.bestDEP)                        DB.bestDEP         = d.bestDEP;
    if (Array.isArray(d.reminders))       DB.reminders       = d.reminders;
    if (d.profile)                        DB.profile         = d.profile;
    if (d.conditions)                     DB.conditions      = d.conditions;
    if (Array.isArray(d.conditionEntries)) DB.conditionEntries = d.conditionEntries;
    if (Array.isArray(d.medications))     DB.medications     = d.medications;
    showToast(t('drive_restored'));
    renderDashboard();
  } catch(e) { showToast('Erreur restauration Drive', 'error'); }
  finally { setSync(false); }
}

// Debounced: rapid saves/deletes collapse into a single Drive upload after 2 s
let _autoSyncTimer = null;
async function driveAutoSync() {
  if (!(await DB.getDriveToken())) return;
  clearTimeout(_autoSyncTimer);
  _autoSyncTimer = setTimeout(() => driveSyncUp(), 2000);
}
function setSync(on) {
  document.getElementById('statusDot').className = 'status-dot' + (on ? ' syncing' : '');
  document.getElementById('syncIndicator').style.display = on ? 'block' : 'none';
}

function checkOAuthRedirect() { /* plus utilisé — géré nativement par le plugin */ }

// ══════════════════════════════════════════
//  BACKUP MIGRATION (v1/v2 → v3)
// ══════════════════════════════════════════
function migrateLegacyMeasures(measures){
  return (measures||[]).map(x=>({
    id: x.id || (Date.now().toString(36)+Math.random().toString(36).slice(2,6)),
    conditionId: 'asthma',
    type: 'measure',
    timestamp: x.dt || new Date().toISOString(),
    data: {
      dep: x.dep,
      dep1: x.dep1,
      dep2: x.dep2,
      dep3: x.dep3,
      spo2: x.spo2,
      easyhaler: x.easy,
      comment: x.comment
    },
    meta: { migratedFrom: 'asthma' }
  }));
}

/** Normalizes any backup schema (v1/v2/v3 or Drive) into the current v3 shape. */
function migrateBackupData(data){
  if(!data || typeof data !== 'object') return data;
  if(!Array.isArray(data.measures)) data.measures = [];
  if(!data.version) data.version = 1;
  if(data.version < 3){
    // Old backups only have `measures`; synthesize v3 collections.
    if((!Array.isArray(data.conditionEntries) || data.conditionEntries.length===0) && data.measures.length>0){
      data.conditionEntries = migrateLegacyMeasures(data.measures);
    }
    if(!data.conditions) data.conditions = { enabled: ['asthma','hypertension','diabetes'] };
    if(!Array.isArray(data.medications)) data.medications = [];
    // Legacy default was asthma-only; match DB.load's upgrade unless the user customized it.
    if(data.conditions && Array.isArray(data.conditions.enabled) && !data.conditions.custom && data.conditions.enabled.length===1 && data.conditions.enabled[0]==='asthma'){
      data.conditions = { enabled: ['asthma','hypertension','diabetes'] };
    }
    data.version = 3;
  }
  if(!Array.isArray(data.conditionEntries)) data.conditionEntries = [];
  if(!data.conditions) data.conditions = { enabled: ['asthma','hypertension','diabetes'] };
  if(!Array.isArray(data.medications)) data.medications = [];
  return data;
}

// ══════════════════════════════════════════
//  JSON EXPORT / IMPORT
// ══════════════════════════════════════════
async function exportJSON() {
  const payload = { measures: DB.measures, bestDEP: DB.bestDEP, reminders: DB.reminders, profile: DB.profile, conditions: DB.conditions, conditionEntries: DB.conditionEntries, medications: DB.medications, version: 3 };
  const jsonStr = JSON.stringify(payload, null, 2);
  const filename = 'chronictrack_backup_' + new Date().toISOString().slice(0,10) + '.json';

  if (IS_CAPACITOR) {
    // Native: write to Documents via @capacitor/filesystem then share
    try {
      const Filesystem = window.Capacitor?.Plugins?.Filesystem;
      const Share      = window.Capacitor?.Plugins?.Share;
      if (!Filesystem) throw new Error('Plugin Filesystem unavailable — run npx cap sync');
      // btoa requires a binary string; use encodeURIComponent round-trip for full UTF-8
      const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
      await Filesystem.writeFile({ path: filename, data: b64, directory: 'DOCUMENTS', recursive: true });
      showToast(t('toast_json_exported'));
      if (Share) {
        const uriResult = await Filesystem.getUri({ path: filename, directory: 'DOCUMENTS' });
        await Share.share({ title: filename, url: uriResult.uri, dialogTitle: filename });
      }
    } catch (fsErr) {
      console.error('JSON export error:', fsErr);
      showToast(t('pdf_save_error', (fsErr.message || '').slice(0, 60)), 'error');
    }
  } else {
    // Web: standard Blob download
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 2000);
    showToast(t('toast_json_exported'));
  }
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const dataRaw = JSON.parse(text);
      // Basic schema validation
      if (!dataRaw || typeof dataRaw !== 'object' || !Array.isArray(dataRaw.measures)) throw new Error(t('toast_json_invalid'));
      const data = migrateBackupData(dataRaw);
      const existing = DB.measures.length;
      if (existing > 0) {
        if (!confirm(t('import_confirm', data.measures.length, existing))) return;
      }
      if (data.measures)  DB.measures  = data.measures;
      if (data.bestDEP)   DB.bestDEP   = data.bestDEP;
      if (data.reminders) DB.reminders = data.reminders;
      if (data.profile)   DB.profile   = data.profile;
      if (data.conditions) DB.conditions = data.conditions;
      if (data.conditionEntries) DB.conditionEntries = data.conditionEntries;
      if (data.medications) DB.medications = data.medications;
      renderDashboard();
      showToast(t('toast_json_imported', (data.measures&&data.measures.length)||0));
      driveAutoSync();
    } catch(err) {
      showToast(t('toast_json_import_err', (err.message||t('toast_json_invalid')).slice(0,60)), 'error');
    }
  };
  input.click();
}

// ══════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════
function renderSettings(){
  DB.getDriveToken().then(token => {
  const isConnected=!!token;
  document.getElementById('settingsContent').innerHTML=`
    <div class="card">
      <div class="card-title">${t('settings_drive_title')}</div>
      ${isConnected?`
        <div class="drive-connected">
          <div class="drive-avatar" id="_driveAvatarSlot"><span id="_driveAvatarFallback">👤</span></div>
          <div class="drive-info">
            <div class="drive-name" id="_driveNameSlot"></div>
            <div class="drive-sub">${t('settings_drive_connected')}</div>
          </div>
        </div>
        <div class="drive-btns">
          <button class="drive-btn upload" data-action="driveSyncUp">${t('btn_drive_upload')}</button>
          <button class="drive-btn download" data-action="driveSyncDown">${t('btn_drive_download')}</button>
          <button class="drive-btn danger" data-action="disconnectDrive">${t('btn_drive_disconnect')}</button>
          <a class="drive-btn" href="https://stellasecret.github.io/gdrive-appdata-browser/" target="_blank" rel="noopener">${t('btn_drive_browse')}</a>
        </div>
      `:`
        <p style="font-size:14px;color:var(--muted);margin-bottom:16px">${t('settings_drive_desc')}</p>
        <button class="btn-google" data-action="connectDrive">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          ${t('btn_google_signin')}
        </button>
      `}
    </div>

    <div class="card">
      <div class="card-title">${t('settings_dep_title')}</div>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings_profile_label')}</div><div class="setting-sub">${t('settings_profile_sub')}</div></div>
        <button class="btn-secondary" data-action="openProfileModal">${t('btn_profile_open')}</button>
      </div>
      <div class="field" style="margin-top:12px"><label>${t('settings_dep_label')}</label><input type="number" id="bestDEPInput" value="${esc(DB.bestDEP)}" min="100" max="900"/></div>
      <button class="btn-primary" data-action="saveBestDEP">${t('btn_save_dep')}</button>
    </div>

    <div class="card">
      <div class="card-title">${t('settings_reminders_title')}</div>
      <div id="reminderList"></div>
      <div class="add-reminder-form">
        <input type="time" id="reminderTime"/>
        <input type="text" id="reminderLabel" placeholder="${t('reminder_ph_label')}"/>
        <button class="btn-secondary" data-action="addReminder">${t('btn_add_reminder')}</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">${t('settings_appearance_title')}</div>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings_theme_label')}</div></div>
        <label class="toggle"><input type="checkbox" id="themeToggle" ${isDark()?'checked':''} data-action="toggleTheme"/><span class="toggle-slider"></span></label>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings_lang_label')}</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn-secondary" style="${_lang==='fr'?'border-color:var(--accent);color:var(--accent)':''}" data-action="setLang" data-val="fr">FR</button>
          <button class="btn-secondary" style="${_lang==='en'?'border-color:var(--accent);color:var(--accent)':''}" data-action="setLang" data-val="en">EN</button>
        </div>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">${t('settings_font_label')}</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn-secondary" style="${!isCustomFont()?'border-color:var(--accent);color:var(--accent)':''}" data-action="applyFont" data-val="false">${t('settings_font_system')}</button>
          <button class="btn-secondary" style="font-family:'Lexend',sans-serif;${isCustomFont()?'border-color:var(--accent);color:var(--accent)':''}" data-action="applyFont" data-val="true">${t('settings_font_custom')}</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">${t('settings_data_title')}</div>
      <div class="setting-row"><div><div class="setting-label">${t('settings_export_pdf_label')}</div><div class="setting-sub">${t('settings_export_pdf_sub')}</div></div><button class="btn-secondary" data-action="exportPDF">${t('btn_export_pdf')}</button></div>
      <div class="setting-row"><div><div class="setting-label">${t('settings_export_json_label')}</div><div class="setting-sub">${t('settings_export_json_sub')}</div></div><button class="btn-secondary" data-action="exportJSON">${t('btn_export_json')}</button></div>
      <div class="setting-row"><div><div class="setting-label">${t('settings_import_json_label')}</div><div class="setting-sub">${t('settings_import_json_sub')}</div></div><button class="btn-secondary" data-action="importJSON">${t('btn_import_json')}</button></div>
      <div class="setting-row"><div><div class="setting-label">${t('settings_export_csv_label')}</div><div class="setting-sub">${t('settings_export_csv_sub')}</div></div><button class="btn-secondary" data-action="exportCSV">${t('btn_export_csv')}</button></div>
      <div class="setting-row"><div><div class="setting-label">${t('settings_clear_label')}</div><div class="setting-sub">${t('settings_clear_sub')}</div></div><button class="btn-secondary" style="color:var(--red);border-color:var(--red)" data-action="clearAll">${t('btn_clear')}</button></div>
    </div>

    <div class="card">
      <div class="card-title">${t('settings_zones_title')}</div>
      <div class="setting-row"><span class="zone-badge zone-green">${t('zone_green')}</span><span style="font-size:14px;color:var(--muted)">${t('zone_green_desc')}</span></div>
      <div class="setting-row"><span class="zone-badge zone-yellow">${t('zone_yellow')}</span><span style="font-size:14px;color:var(--muted)">${t('zone_yellow_desc')}</span></div>
      <div class="setting-row"><span class="zone-badge zone-red">${t('zone_red')}</span><span style="font-size:14px;color:var(--muted)">${t('zone_red_desc')}</span></div>
    </div>
    <div class="card">
      <div class="card-title">Conditions suivies</div>
      <div class="card-sub">Activez le suivi pour diabète et hypertension</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
        <label style="display:flex;align-items:center;gap:10px"><input type="checkbox" checked disabled> Asthme (obligatoire)</label>
        <label style="display:flex;align-items:center;gap:10px"><input type="checkbox" data-action="toggleCond" data-val="hypertension" ${(DB.conditions&&DB.conditions.enabled||[]).includes('hypertension')?'checked':''}> Hypertension</label>
        <label style="display:flex;align-items:center;gap:10px"><input type="checkbox" data-action="toggleCond" data-val="diabetes" ${(DB.conditions&&DB.conditions.enabled||[]).includes('diabetes')?'checked':''}> Diabète</label>
      </div>
    </div>
  `;
  // Inject user-controlled drive avatar/name via DOM — never via innerHTML
  if(isConnected){
    const avatarSlot=document.getElementById('_driveAvatarSlot');
    const fallback=document.getElementById('_driveAvatarFallback');
    if(DB.driveAvatar&&avatarSlot){
      // Only allow https: URLs — guards against javascript: or data: protocol abuse
      let avatarUrl='';
      try { avatarUrl=new URL(DB.driveAvatar).protocol==='https:'?DB.driveAvatar:''; } catch(e) { avatarUrl=''; }
      if(avatarUrl){
        const img=document.createElement('img');
        img.src=avatarUrl;
        img.style.cssText='width:40px;height:40px;border-radius:50%;object-fit:cover';
        img.addEventListener('error',()=>img.style.display='none');
        avatarSlot.insertBefore(img,fallback);
        if(fallback)fallback.style.display='none';
      }
    }
    const nameSlot=document.getElementById('_driveNameSlot');
    if(nameSlot)nameSlot.textContent=DB.driveUser||'Compte Google';
  }
  renderReminderList();
  });
}

function saveBestDEP(){const v=parseFloat(document.getElementById('bestDEPInput').value);if(!v||v<100||v>900){showToast(t('toast_best_dep_invalid'),'error');return;}DB.bestDEP=v;showToast(t('toast_best_dep_saved'));}
function clearAll(){if(!confirm(t('toast_clear_confirm')))return;DB.measures=[];DB.conditionEntries=[];showToast(t('toast_cleared'));}

// ── REMINDERS ──
let reminderTimers=[];
function renderReminderList(){
  const list=document.getElementById('reminderList');if(!list)return;
  const rem=DB.reminders;
  list.innerHTML='';
  if(!rem.length){
    const p=document.createElement('p');p.style.cssText='color:var(--muted);font-size:14px;margin-bottom:10px';
    p.textContent=t('reminders_empty');list.appendChild(p);return;
  }
  rem.forEach((r,i)=>{
    const row=document.createElement('div');row.className='reminder-item';

    const info=document.createElement('div');info.className='reminder-info';
    const timeEl=document.createElement('div');timeEl.className='reminder-time';timeEl.textContent=r.time;
    const labelEl=document.createElement('div');labelEl.className='reminder-label-text';labelEl.textContent=r.label;
    info.appendChild(timeEl);info.appendChild(labelEl);

    const toggle=document.createElement('label');toggle.className='toggle';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!r.active;
    cb.addEventListener('change',()=>toggleReminder(i));
    const slider=document.createElement('span');slider.className='toggle-slider';
    toggle.appendChild(cb);toggle.appendChild(slider);

    const delBtn=document.createElement('button');delBtn.className='reminder-del';delBtn.textContent='✕';
    delBtn.addEventListener('click',()=>deleteReminder(i));

    row.appendChild(info);row.appendChild(toggle);row.appendChild(delBtn);
    list.appendChild(row);
  });
}
function addReminder(){
  const time=document.getElementById('reminderTime').value,label=document.getElementById('reminderLabel').value.trim()||t('reminder_ph_label');
  if(!time){showToast(t('toast_reminder_no_time'),'error');return;}
  const rem=DB.reminders;rem.push({time,label,active:true});DB.reminders=rem;
  scheduleReminders();renderReminderList();showToast(t('toast_reminder_added'));
}
function toggleReminder(i){const rem=DB.reminders;rem[i].active=!rem[i].active;DB.reminders=rem;scheduleReminders();renderReminderList();if(currentPage==='dashboard')renderDashboard();}
function deleteReminder(i){const rem=DB.reminders;rem.splice(i,1);DB.reminders=rem;scheduleReminders();renderReminderList();}
function scheduleReminders(){
  reminderTimers.forEach(t=>clearTimeout(t));reminderTimers=[];
  const now=new Date();
  DB.reminders.filter(r=>r.active).forEach(r=>{
    const[h,m]=r.time.split(':').map(Number),target=new Date(now);
    target.setHours(h,m,0,0);if(target<=now)target.setDate(target.getDate()+1);
    const t=setTimeout(async()=>{
      try {
        // Sur Android Capacitor : utilise le plugin Local Notifications
        if(IS_CAPACITOR && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications){
          const LN = window.Capacitor.Plugins.LocalNotifications;
          await LN.schedule({notifications:[{
            title:'ChroniTrack 💊',
            body: r.label+' — Penser à votre Easyhaler !',
            id: Math.floor(Math.random()*100000),
            schedule:{ at: new Date(Date.now()+100) }
          }]});
        } else if(typeof Notification !== 'undefined' && Notification.permission==='granted'){
          // Fallback web
          new Notification('ChroniTrack 💊',{body:r.label+' — Penser à votre traitement !'});
        }
      } catch(e){ console.warn('Notification error:', e); }
      scheduleReminders();
    },target-now);
    reminderTimers.push(t);
  });
}

// Monotonic ID — millisecond timestamp + per-ms counter, collision-safe even in rapid imports
let _idSeq = 0, _idLastMs = 0;
function nextId() {
  const ms = Date.now();
  if (ms === _idLastMs) { _idSeq++; } else { _idLastMs = ms; _idSeq = 0; }
  return ms * 1000 + _idSeq;
}
// ══════════════════════════════════════════
// Dev-only error toasts — never leak stack traces in production
const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
// Capture toutes les erreurs JS pour debug
window.onerror = function(msg, src, line, col, err) {
  if (isDev) showToast('JS Error: ' + msg, 'error');
  console.error('GLOBAL ERROR:', msg, src, line, col, err);
};
window.addEventListener('unhandledrejection', function(e) {
  if (isDev) showToast('Promise Error: ' + e.reason, 'error');
  console.error('UNHANDLED PROMISE:', e.reason);
});

// Expose functions and objects for Playwright evaluate() calls
window.DB           = DB;
window.SecureStore  = SecureStore;
window.predictedDEP = predictedDEP;
window.calcTrend    = calcTrend;
window.isCrisis     = isCrisis;
window.depZone      = depZone;
window.spo2Zone     = spo2Zone;
// Global Action Delegator (for dynamically rendered buttons)
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.getAttribute('data-action');
  const val = target.getAttribute('data-val');

  if (action === 'driveSyncUp') driveSyncUp();
  if (action === 'driveSyncDown') driveSyncDown();
  if (action === 'disconnectDrive') disconnectDrive();
  if (action === 'connectDrive') connectDrive();
  if (action === 'openProfileModal') openProfileModal();
  if (action === 'saveBestDEP') saveBestDEP();
  if (action === 'addReminder') addReminder();
  if (action === 'setLang') setLang(val);
  if (action === 'toggleCond') {
    const c = DB.conditions || { enabled: ['asthma','hypertension','diabetes'] };
    c.custom = true;
    if (target.checked) { if (!c.enabled.includes(val)) c.enabled.push(val); }
    else c.enabled = c.enabled.filter(x => x !== val);
    DB.conditions = c;
    showToast(t('toast_saved'));
    renderDashboard();
  }
  if (action === 'applyFont') { applyFont(val === 'true'); renderSettings(); }
  if (action === 'exportPDF') exportPDF();
  if (action === 'confirmExportPDF') confirmExportPDF();
  if (action === 'closePdfModal') closePdfModal();
  if (action === 'exportJSON') exportJSON();
  if (action === 'importJSON') importJSON();
  if (action === 'exportCSV') exportCSV();
  if (action === 'clearAll') clearAll();
  if (action === 'showSaisie') showPage('saisie', null);
  if (action === 'showCondition') showCondition(val);
  if (action === 'showPage') showPage(val, target);
  if (action === 'saveMeasure') saveMeasure();
  if (action === 'saveEdit') saveEdit();
  if (action === 'closeEditModal') closeEditModal();
  if (action === 'closeProfileModal') closeProfileModal();
  if (action === 'selectEasy') selectEasy(parseInt(val));
  if (action === 'selectEditEasy') selectEditEasy(parseInt(val));
  if (action === 'saveHTN') { if(typeof saveHTN==='function') saveHTN(); }
  if (action === 'saveDM') { if(typeof saveDM==='function') saveDM(); }
  if (action === 'addMedication') { if(typeof addMedication==='function') { addMedication(); return; } if(typeof window.addMedication==='function'){ window.addMedication(); return; } }
  if (action === 'removeMed') { const i=parseInt(val); if(isNaN(i)) return; const meds=(DB.medications||[]).slice(); meds.splice(i,1); DB.medications=meds; if(typeof renderMedications==='function') renderMedications(); if(currentPage==='dashboard'&&typeof renderDashboard==='function') renderDashboard(); return; }
  if (action === 'toggleTheme') {
      const dark = target.checked;
      applyTheme(dark);
      renderSettings();
  }
});

document.addEventListener('DOMContentLoaded', async ()=>{
  await DB.load();
  if(!DB.conditions) DB.conditions={enabled:['asthma','hypertension','diabetes']};
  if(!Array.isArray(DB.conditionEntries)) DB.conditionEntries=[];
  if(!Array.isArray(DB.medications)) DB.medications=[];
  await SecureStore.init();

  // Demo mode check
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('demo') === 'true') {
    const appTitle = document.getElementById('appTitle');
    if (appTitle) appTitle.textContent = 'ChroniTrack';
    if (appTitle) appTitle.innerHTML += ' <span style="color:var(--accent); font-size:12px;">(DÉMO)</span>';

    const now = Date.now();
    const dayMs = 86400000;
    const mockMeasures = [];
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(now - i * dayMs);
      const dep = 350 + Math.floor(Math.random() * 100);
      mockMeasures.push({
        id: 'demo-a-' + i,
        dt: dt.toISOString(),
        dep: dep,
        dep1: dep - 10,
        dep2: dep + 10,
        dep3: dep,
        spo2: 95 + Math.floor(Math.random() * 4),
        easy: Math.floor(Math.random() * 3),
        comment: i === 0 ? 'Sensation de légèreté' : (i % 3 === 0 ? 'Pollens élevés' : '')
      });
    }
    mockMeasures.reverse();
    DB._state.measures = mockMeasures;
    DB._state.bestDEP = 450;

    // Shared condition entries across all tracked conditions
    const mockEntries = mockMeasures.map(m => ({
      id: m.id,
      conditionId: 'asthma',
      type: 'measure',
      timestamp: new Date(m.dt).toISOString(),
      data: { dep: m.dep, spo2: m.spo2, easyhaler: m.easy, comment: m.comment, dep1: m.dep1, dep2: m.dep2, dep3: m.dep3 },
      meta: { demo: true }
    }));
    // Hypertension: one reading every 2 days, alternating positions/values
    const htnPositions = ['assis', 'couché', 'debout'];
    for (let i = 9; i >= 0; i--) {
      const dt = new Date(now - i * 2 * dayMs);
      const systolic = 118 + Math.floor(Math.random() * 35);
      const diastolic = 74 + Math.floor(Math.random() * 18);
      mockEntries.push({
        id: 'demo-h-' + i,
        conditionId: 'hypertension',
        type: 'reading',
        timestamp: dt.toISOString(),
        data: {
          systolic,
          diastolic,
          pulse: 62 + Math.floor(Math.random() * 20),
          position: htnPositions[i % htnPositions.length],
          comment: i === 0 ? 'Après le café' : ''
        },
        meta: { demo: true }
      });
    }
    // Diabetes: one reading per day, mixed contexts and units
    const dmContexts = ['à jeun', 'postprandial', 'avant repas', 'après repas'];
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(now - i * dayMs + 3 * 3600000);
      const mmol = i % 5 === 0;
      const glucose = mmol ? (4.5 + Math.random() * 5.5).toFixed(1) : Math.round(80 + Math.random() * 110);
      mockEntries.push({
        id: 'demo-d-' + i,
        conditionId: 'diabetes',
        type: 'reading',
        timestamp: dt.toISOString(),
        data: {
          glucose,
          unit: mmol ? 'mmol/L' : 'mg/dL',
          context: dmContexts[i % dmContexts.length],
          insulin: i % 4 === 0 ? Math.round(4 + Math.random() * 8) : null,
          meals: i % 3 === 0 ? 'Repas équilibré' : '',
          comment: i === 0 ? 'Bonne journée' : ''
        },
        meta: { demo: true }
      });
    }
    DB._state.conditionEntries = mockEntries;
    DB._state.conditions = { enabled: ['asthma', 'hypertension', 'diabetes'] };
    DB._state.medications = [
      { id: 'demo-m1', name: 'Ventoline', dose: '100 µg', freq: 'Si besoin', conditionId: 'asthma', active: true },
      { id: 'demo-m2', name: 'Amlodipine', dose: '5 mg', freq: '1×/jour', conditionId: 'hypertension', active: true },
      { id: 'demo-m3', name: 'Metformine', dose: '500 mg', freq: '2×/jour', conditionId: 'diabetes', active: true }
    ];
    DB._state.reminders = [
      { time: '08:00', label: 'Tension du matin', active: true },
      { time: '20:00', label: 'Glycémie du soir', active: true }
    ];
    DB._state.profile = { sex: 'M', age: 45, height: 175 };
    showToast(t('demo_banner') || 'Mode Démo : données simulées');
  }

  applyTheme(isDark());
  applyFont(isCustomFont()); // re-apply after DOM ready (link element now accessible)
  document.documentElement.lang = _lang;
  renderStaticHTML();

  // ── INITIALIZATION ──
  // Profile Modal
  const profileSex = document.getElementById('profileSex');
  const profileAge = document.getElementById('profileAge');
  const profileHeight = document.getElementById('profileHeight');
  if (profileSex) profileSex.addEventListener('change', calcPredictedDEP);
  if (profileAge) profileAge.addEventListener('input', calcPredictedDEP);
  if (profileHeight) profileHeight.addEventListener('input', calcPredictedDEP);

  // Saisie Page
  const depInputs = ['dep1', 'dep2', 'dep3'].map(id => document.getElementById(id));
  depInputs.forEach(el => { if (el) el.addEventListener('input', updateDepAvg); });
  const spo2Input = document.getElementById('inputSpO2');
  if (spo2Input) spo2Input.addEventListener('input', () => updateSpo2Display(spo2Input));

  // Edit Modal
  const editDepInputs = ['editDep1', 'editDep2', 'editDep3'].map(id => document.getElementById(id));
  editDepInputs.forEach(el => { if (el) el.addEventListener('input', updateEditDepAvg); });
  const editSpo2Input = document.getElementById('editSpO2');
  if (editSpo2Input) editSpo2Input.addEventListener('input', () => updateSpo2Display(editSpo2Input));

  // Offline detection
  updateOfflineBanner();
  window.addEventListener('online',  updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);
  // Profile modal close on backdrop click
  document.getElementById('profileModal').addEventListener('click', function(e){ if(e.target===this) closeProfileModal(); });
  const pdfModalEl=document.getElementById('pdfModal');
  if(pdfModalEl) pdfModalEl.addEventListener('click', function(e){ if(e.target===this) closePdfModal(); });
  renderDashboard();
  // Demande la permission de notifications au démarrage
  if (!IS_CAPACITOR && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  if (IS_CAPACITOR && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
    window.Capacitor.Plugins.LocalNotifications.requestPermissions().catch(function(){});
  }
  scheduleReminders(); // Les rappels utilisent le plugin natif
  // Add medication functions
  if(typeof window.addMedication==='undefined'){
    window.addMedication = function(){
      const name = (document.getElementById('medName')||{}).value||'';
      const dose = (document.getElementById('medDose')||{}).value||'';
      const freq = (document.getElementById('medFreq')||{}).value||'';
      const cond = (document.getElementById('medCond')||{}).value||'asthma';
      if(!name.trim()){ showToast('Nom requis','error'); return; }
      DB.medications = [...(DB.medications||[]), {id:Date.now().toString(36), name:name.trim(), dose:dose.trim(), freq:freq.trim(), conditionId:cond, active:true}];
      try{ document.getElementById('medName').value=''; document.getElementById('medDose').value=''; document.getElementById('medFreq').value=''; }catch(e){}
      showToast('✓ Médicament ajouté');
      if(typeof renderMedications==='function') renderMedications();
      if(currentPage==='dashboard'&&typeof renderDashboard==='function') renderDashboard();
    };
    window.removeMedication = function(i){ const m=DB.medications||[]; m.splice(i,1); DB.medications=m; renderMedications(); };
    window.renderMedications = function(){
      const list = document.getElementById('medList');
      if(!list) return;
      const meds = DB.medications||[];
      if(!meds.length){ list.innerHTML='<div style="color:var(--muted)">Aucun médicament</div>'; return; }
      list.innerHTML = meds.map((m,i)=>`<div style="padding:8px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between"><div><b>${m.name}</b> ${m.dose||''} ${m.freq||''}<div style="font-size:12px;color:var(--muted)">${m.conditionId}</div></div><button class="icon-action-btn del" data-action="removeMed" data-val="${i}">✕</button></div>`).join('');
    };
  }
  const el=document.getElementById('inputDatetime');
  if(el){const now=new Date();now.setSeconds(0,0);el.value=now.toISOString().slice(0,16);}
  });
