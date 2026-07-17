/**
 * ============================================================================
 *  MSETCL — 400 kV Karjat Substation | Spare Material Register
 *  Google Apps Script backend  —  Code.gs
 * ============================================================================
 *
 *  WHAT THIS DOES
 *    • Builds the whole database (Google Sheet) by itself
 *    • Pushes all scanned documents into a Google Drive folder
 *    • Exposes a JSON API for index.html (hosted on GitHub Pages)
 *
 *  ── SETUP ORDER (do exactly this) ──────────────────────────────────────────
 *  STEP 1  Put the 13 images in your GitHub repo, then set GITHUB_RAW_BASE
 *          below.  (Or skip GitHub: upload them to any Drive folder and use
 *          seedDocumentsFromDriveFolder('<folder id or url>') instead.)
 *
 *  STEP 2  Run  ▶ setupDatabase()      → creates Sheet + Drive folder + all data
 *  STEP 3  Run  ▶ seedDocumentsFromGitHub()   (or ...FromDriveFolder)
 *               → uploads every document to Drive & links it to its material
 *  STEP 4  Deploy ▸ New deployment ▸ Web app
 *               Execute as        : Me
 *               Who has access    : Anyone            ← required for GitHub Pages
 *          Copy the /exec URL.
 *  STEP 5  Paste that URL into index.html  →  const WEB_APP_URL = '...';
 *
 *  STEP 6  Run  ▶ healthCheck()        → confirms everything is wired up
 * ============================================================================
 */

/* ⇩⇩⇩  EDIT THIS ONE LINE  ⇩⇩⇩ ------------------------------------------- */
var GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/USERNAME/REPO/main/docs/';
/* ------------------------------------------------------------------------ */

var CFG = {
  SS_NAME: 'Karjat Spare Material Register (Database)',
  FOLDER_NAME: 'Karjat Spare Material — Documents',
  P_SS: 'SS_ID',
  P_FOLDER: 'FOLDER_ID'
};

var SHEETS = {
  SETTINGS:   ['key', 'value'],
  CATEGORIES: ['id', 'name', 'desc', 'fields'],
  ITEMS:      ['id', 'categoryId', 'name', 'unit', 'location', 'trackLow', 'lowCutoff', 'fields', 'remarks', 'createdAt', 'updatedAt'],
  RECEIPTS:   ['id', 'itemId', 'date', 'qty', 'source', 'refType', 'refNo', 'invoiceNo', 'vehicle', 'receivedBy',
               'unitRate', 'taxableAmt', 'gstPct', 'totalAmt', 'remarks', 'docs', 'createdAt'],
  ISSUES:     ['id', 'itemId', 'date', 'qty', 'purpose', 'issuedTo', 'location', 'authorisedBy', 'workDetails', 'remarks', 'createdAt'],
  DOCS:       ['id', 'title', 'fileId', 'thumb', 'createdAt']
};

/* ======================================================================== *
 *  API ROUTER  (works from GitHub Pages via POST, or JSONP via GET)
 * ======================================================================== */

var API = {
  getBootstrap:   function ()          { return getBootstrap(); },
  addItem:        function (p)         { return apiAddItem(p); },
  updateItem:     function (id, p)     { return apiUpdateItem(id, p); },
  deleteItem:     function (id)        { return apiDeleteItem(id); },
  addReceipt:     function (id, r)     { return apiAddReceipt(id, r); },
  addIssue:       function (id, r)     { return apiAddIssue(id, r); },
  deleteRecord:   function (kind, id)  { return apiDeleteRecord(kind, id); },
  saveCategory:   function (p)         { return apiSaveCategory(p); },
  deleteCategory: function (id)        { return apiDeleteCategory(id); },
  saveField:      function (c, f)      { return apiSaveField(c, f); },
  deleteField:    function (c, k)      { return apiDeleteField(c, k); },
  uploadDoc:      function (p)         { return apiUploadDoc(p); },
  getDocFull:     function (id)        { return apiGetDocFull(id); },
  attachDocs:     function (k, r, d)   { return apiAttachDocs(k, r, d); },
  deleteDoc:      function (id)        { return apiDeleteDoc(id); },
  setSetting:     function (k, v)      { return apiSetSetting(k, v); }
};

/**
 * Bridge used when index.html is served by this same project
 * (google.script.run.__api__). Harmless if you host on GitHub Pages.
 */
function __api__(fn, args) {
  if (!API[fn]) throw new Error('Unknown API function: ' + fn);
  return API[fn].apply(null, args || []);
}

function doGet(e) {
  // API call?  (JSONP / plain GET)
  if (e && e.parameter && e.parameter.fn) {
    return route_(e.parameter.fn, JSON.parse(e.parameter.args || '[]'), e.parameter.callback);
  }
  // Otherwise try to serve index.html if it also lives in this project
  try {
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('Spare Material Register — 400 kV Karjat SS')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, msg: 'Spare Material Register API is live.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/** POST with Content-Type text/plain → simple request → no CORS preflight. */
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return route_(body.fn, body.args || [], null);
}

function route_(fn, args, callback) {
  var out;
  try {
    if (!API[fn]) throw new Error('Unknown API function: ' + fn);
    out = { ok: true, data: API[fn].apply(null, args) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  var txt = JSON.stringify(out);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + txt + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.JSON);
}

/* ======================================================================== *
 *  INFRASTRUCTURE
 * ======================================================================== */

function props_() { return PropertiesService.getScriptProperties(); }

function getSS_() {
  var id = props_().getProperty(CFG.P_SS);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  throw new Error('Database not created yet — run setupDatabase() once from the editor.');
}

function getFolder_() {
  var id = props_().getProperty(CFG.P_FOLDER);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder(CFG.FOLDER_NAME);
  props_().setProperty(CFG.P_FOLDER, f.getId());
  return f;
}

function tbl_(name) {
  var sh = getSS_().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet: ' + name);
  var last = sh.getLastRow();
  var head = SHEETS[name];
  var rows = [];
  if (last > 1) {
    sh.getRange(2, 1, last - 1, head.length).getValues().forEach(function (r, idx) {
      if (!r[0]) return;
      var o = { __row: idx + 2 };
      head.forEach(function (k, i) { o[k] = r[i]; });
      rows.push(o);
    });
  }
  return { sh: sh, head: head, rows: rows };
}

function insert_(name, obj) {
  var t = tbl_(name);
  t.sh.appendRow(t.head.map(function (k) { return cell_(obj[k]); }));
  return obj;
}

function cell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function updateRow_(name, id, obj) {
  var t = tbl_(name), hit = null;
  t.rows.forEach(function (r) { if (String(r.id) === String(id)) hit = r; });
  if (!hit) throw new Error('Record not found: ' + id);
  t.sh.getRange(hit.__row, 1, 1, t.head.length).setValues([t.head.map(function (k) {
    return cell_(obj[k] !== undefined ? obj[k] : hit[k]);
  })]);
  return obj;
}

function deleteRow_(name, id) {
  var t = tbl_(name);
  for (var i = t.rows.length - 1; i >= 0; i--) {
    if (String(t.rows[i].id) === String(id)) { t.sh.deleteRow(t.rows[i].__row); return true; }
  }
  return false;
}

function uid_(p) { return (p || 'x') + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }

function json_(v, fb) {
  if (v === '' || v === null || v === undefined) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return fb; }
}

function lock_(fn) {
  var l = LockService.getScriptLock();
  l.waitLock(25000);
  try { return fn(); } finally { l.releaseLock(); }
}

function dstr_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v).slice(0, 10);
}

/* ======================================================================== *
 *  READ
 * ======================================================================== */

function getBootstrap() {
  var cats = tbl_('CATEGORIES').rows.map(function (c) {
    return { id: c.id, name: c.name, desc: c.desc, fields: json_(c.fields, []) };
  });
  var recs = tbl_('RECEIPTS').rows;
  var isss = tbl_('ISSUES').rows;
  var items = tbl_('ITEMS').rows.map(function (i) {
    return {
      id: i.id, categoryId: i.categoryId, name: i.name, unit: i.unit, location: i.location,
      trackLow: (i.trackLow === true || String(i.trackLow).toUpperCase() === 'TRUE'),
      lowCutoff: Number(i.lowCutoff || 0),
      fields: json_(i.fields, {}), remarks: i.remarks, createdAt: i.createdAt,
      receipts: recs.filter(function (r) { return r.itemId === i.id; }).map(function (r) {
        return {
          id: r.id, date: dstr_(r.date), qty: Number(r.qty || 0), source: r.source, refType: r.refType,
          refNo: r.refNo, invoiceNo: r.invoiceNo, vehicle: r.vehicle, receivedBy: r.receivedBy,
          unitRate: Number(r.unitRate || 0), taxableAmt: Number(r.taxableAmt || 0),
          gstPct: Number(r.gstPct || 0), totalAmt: Number(r.totalAmt || 0),
          remarks: r.remarks, docs: json_(r.docs, [])
        };
      }),
      issues: isss.filter(function (r) { return r.itemId === i.id; }).map(function (r) {
        return {
          id: r.id, date: dstr_(r.date), qty: Number(r.qty || 0), purpose: r.purpose, issuedTo: r.issuedTo,
          location: r.location, authorisedBy: r.authorisedBy, workDetails: r.workDetails, remarks: r.remarks
        };
      })
    };
  });
  var settings = {};
  tbl_('SETTINGS').rows.forEach(function (r) { settings[r.key] = r.value; });
  var docs = tbl_('DOCS').rows.map(function (d) {
    return { id: d.id, title: d.title, fileId: d.fileId, thumb: d.thumb };
  });
  return {
    settings: settings, categories: cats, items: items, docs: docs,
    serverDate: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  };
}

/* ======================================================================== *
 *  WRITE
 * ======================================================================== */

function apiAddItem(p) {
  return lock_(function () {
    if (!p || !p.name) throw new Error('Item name is required');
    if (!p.categoryId) throw new Error('Category is required');
    if (p.trackLow && !(Number(p.lowCutoff) >= 0)) throw new Error('Low-stock cut-off value is required when the alert flag is on');
    var id = uid_('itm');
    insert_('ITEMS', {
      id: id, categoryId: p.categoryId, name: p.name, unit: p.unit || 'Nos.',
      location: p.location || '', trackLow: !!p.trackLow, lowCutoff: Number(p.lowCutoff || 0),
      fields: p.fields || {}, remarks: p.remarks || '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    if (p.receipt && Number(p.receipt.qty) > 0) {
      var r = p.receipt;
      insert_('RECEIPTS', {
        id: uid_('rcp'), itemId: id, date: r.date, qty: Number(r.qty), source: r.source || '',
        refType: r.refType || '', refNo: r.refNo || '', invoiceNo: r.invoiceNo || '', vehicle: r.vehicle || '',
        receivedBy: r.receivedBy || '', unitRate: Number(r.unitRate || 0), taxableAmt: Number(r.taxableAmt || 0),
        gstPct: Number(r.gstPct || 0), totalAmt: Number(r.totalAmt || 0), remarks: r.remarks || '',
        docs: r.docs || [], createdAt: new Date().toISOString()
      });
    }
    return getBootstrap();
  });
}

function apiUpdateItem(id, p) {
  return lock_(function () {
    if (p.trackLow && !(Number(p.lowCutoff) >= 0)) throw new Error('Low-stock cut-off value is required when the alert flag is on');
    updateRow_('ITEMS', id, {
      name: p.name, unit: p.unit, location: p.location, trackLow: !!p.trackLow,
      lowCutoff: Number(p.lowCutoff || 0), fields: p.fields || {}, remarks: p.remarks || '',
      updatedAt: new Date().toISOString()
    });
    return getBootstrap();
  });
}

function apiDeleteItem(id) {
  return lock_(function () {
    tbl_('RECEIPTS').rows.forEach(function (r) { if (r.itemId === id) deleteRow_('RECEIPTS', r.id); });
    tbl_('ISSUES').rows.forEach(function (r) { if (r.itemId === id) deleteRow_('ISSUES', r.id); });
    deleteRow_('ITEMS', id);
    return getBootstrap();
  });
}

function apiAddReceipt(itemId, r) {
  return lock_(function () {
    if (!(Number(r.qty) > 0)) throw new Error('Quantity must be greater than zero');
    insert_('RECEIPTS', {
      id: uid_('rcp'), itemId: itemId, date: r.date, qty: Number(r.qty), source: r.source || '',
      refType: r.refType || '', refNo: r.refNo || '', invoiceNo: r.invoiceNo || '', vehicle: r.vehicle || '',
      receivedBy: r.receivedBy || '', unitRate: Number(r.unitRate || 0), taxableAmt: Number(r.taxableAmt || 0),
      gstPct: Number(r.gstPct || 0), totalAmt: Number(r.totalAmt || 0), remarks: r.remarks || '',
      docs: r.docs || [], createdAt: new Date().toISOString()
    });
    return getBootstrap();
  });
}

function apiAddIssue(itemId, r) {
  return lock_(function () {
    var q = Number(r.qty);
    if (!(q > 0)) throw new Error('Quantity must be greater than zero');
    if (!r.purpose) throw new Error('Purpose of use is required');
    var recd = 0, issd = 0;
    tbl_('RECEIPTS').rows.forEach(function (x) { if (x.itemId === itemId) recd += Number(x.qty || 0); });
    tbl_('ISSUES').rows.forEach(function (x) { if (x.itemId === itemId) issd += Number(x.qty || 0); });
    if (q > recd - issd) throw new Error('Only ' + (recd - issd) + ' available in stock');
    insert_('ISSUES', {
      id: uid_('iss'), itemId: itemId, date: r.date, qty: q, purpose: r.purpose,
      issuedTo: r.issuedTo || '', location: r.location || '', authorisedBy: r.authorisedBy || '',
      workDetails: r.workDetails || '', remarks: r.remarks || '', createdAt: new Date().toISOString()
    });
    return getBootstrap();
  });
}

function apiDeleteRecord(kind, id) {
  return lock_(function () {
    deleteRow_(kind === 'receipts' ? 'RECEIPTS' : 'ISSUES', id);
    return getBootstrap();
  });
}

function apiSaveCategory(p) {
  return lock_(function () {
    if (!p.name) throw new Error('Category name is required');
    if (p.id) updateRow_('CATEGORIES', p.id, { name: p.name, desc: p.desc || '' });
    else insert_('CATEGORIES', { id: uid_('cat'), name: p.name, desc: p.desc || '', fields: [] });
    return getBootstrap();
  });
}

function apiDeleteCategory(id) {
  return lock_(function () {
    var used = tbl_('ITEMS').rows.filter(function (i) { return i.categoryId === id; }).length;
    if (used) throw new Error('Category has ' + used + ' item(s) — move or delete them first');
    deleteRow_('CATEGORIES', id);
    return getBootstrap();
  });
}

function apiSaveField(catId, field) {
  return lock_(function () {
    var c = null;
    tbl_('CATEGORIES').rows.forEach(function (r) { if (r.id === catId) c = r; });
    if (!c) throw new Error('Category not found');
    var fields = json_(c.fields, []);
    if (!field.key) throw new Error('Field key missing');
    if (fields.some(function (f) { return f.key === field.key; })) throw new Error('Field already exists');
    fields.push(field);
    updateRow_('CATEGORIES', catId, { fields: fields });
    return getBootstrap();
  });
}

function apiDeleteField(catId, key) {
  return lock_(function () {
    var c = null;
    tbl_('CATEGORIES').rows.forEach(function (r) { if (r.id === catId) c = r; });
    if (!c) throw new Error('Category not found');
    updateRow_('CATEGORIES', catId, {
      fields: json_(c.fields, []).filter(function (f) { return f.key !== key; })
    });
    return getBootstrap();
  });
}

function apiSetSetting(k, v) {
  return lock_(function () {
    var t = tbl_('SETTINGS'), hit = null;
    t.rows.forEach(function (r) { if (r.key === k) hit = r; });
    if (hit) t.sh.getRange(hit.__row, 2).setValue(v);
    else t.sh.appendRow([k, v]);
    return true;
  });
}

/* ======================================================================== *
 *  DOCUMENTS  (Drive)
 * ======================================================================== */

function apiUploadDoc(p) {
  return lock_(function () {
    var blob = Utilities.newBlob(Utilities.base64Decode(p.full), p.mime || 'image/jpeg',
                                 p.name || ('doc_' + Date.now() + '.jpg'));
    var file = getFolder_().createFile(blob);
    var id = uid_('doc');
    var thumb = p.thumb ? ('data:image/jpeg;base64,' + p.thumb) : driveThumb_(file);
    insert_('DOCS', { id: id, title: p.title || p.name || 'Document', fileId: file.getId(),
                      thumb: thumb, createdAt: new Date().toISOString() });
    return { id: id, title: p.title || p.name, thumb: thumb, fileId: file.getId() };
  });
}

/** Small preview so the gallery loads fast; full image is fetched on demand. */
function driveThumb_(file) {
  try {
    var t = file.getThumbnail();
    if (!t) return '';
    var b64 = Utilities.base64Encode(t.getBytes());
    if (b64.length > 45000) return '';   // Sheets cell limit is 50k chars
    return 'data:' + t.getContentType() + ';base64,' + b64;
  } catch (e) { return ''; }
}

function apiGetDocFull(docId) {
  var d = null;
  tbl_('DOCS').rows.forEach(function (r) { if (r.id === docId) d = r; });
  if (!d) throw new Error('Document not found');
  var b = DriveApp.getFileById(d.fileId).getBlob();
  return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
}

function apiAttachDocs(kind, recordId, docIds) {
  return lock_(function () {
    var name = kind === 'receipts' ? 'RECEIPTS' : 'ISSUES';
    var hit = null;
    tbl_(name).rows.forEach(function (r) { if (r.id === recordId) hit = r; });
    if (!hit) throw new Error('Record not found');
    var cur = json_(hit.docs, []);
    docIds.forEach(function (d) { if (cur.indexOf(d) < 0) cur.push(d); });
    updateRow_(name, recordId, { docs: cur });
    return getBootstrap();
  });
}

function apiDeleteDoc(docId) {
  return lock_(function () {
    var d = null;
    tbl_('DOCS').rows.forEach(function (r) { if (r.id === docId) d = r; });
    if (d) { try { DriveApp.getFileById(d.fileId).setTrashed(true); } catch (e) {} deleteRow_('DOCS', docId); }
    ['RECEIPTS', 'ISSUES'].forEach(function (n) {
      tbl_(n).rows.forEach(function (r) {
        var cur = json_(r.docs, []);
        if (cur.indexOf(docId) >= 0) {
          updateRow_(n, r.id, { docs: cur.filter(function (x) { return x !== docId; }) });
        }
      });
    });
    return getBootstrap();
  });
}

/* ======================================================================== *
 *  DOCUMENT SEEDING
 *  Filename → title → which material(s) it belongs to
 * ======================================================================== */

var SEED_DOCS = [
  { file: '01_LA_stack_40A_nameplate.jpg',    title: 'Surge Arrester nameplate — Stack 40 A (LAMCO)',                       items: ['itm_la390'] },
  { file: '02_LA_stack_40B_nameplate.jpg',    title: 'Surge Arrester nameplate — Stack 40 B (LAMCO)',                       items: ['itm_la390'] },
  { file: '03_LA_stack_40C_nameplate.jpg',    title: 'Surge Arrester nameplate — Stack 40 C (LAMCO)',                       items: ['itm_la390'] },
  { file: '04_LA_stack_40D_nameplate.jpg',    title: 'Surge Arrester nameplate — Stack 40 D (LAMCO)',                       items: ['itm_la390'] },
  { file: '05_CT_serial_24_nameplate.jpg',    title: 'CT nameplate — S/N OC 11183/2/24/21 (MEHRU)',                         items: ['itm_ct245'] },
  { file: '06_CT_serial_23_nameplate.jpg',    title: 'CT nameplate — S/N OC 11183/2/23/21 (MEHRU)',                         items: ['itm_ct245'] },
  { file: '07_gate_pass.jpg',                 title: 'Gate Pass No. 651/1431 dtd. 06.07.2026 — Major Store, Dhule',          items: ['itm_ct245', 'itm_la390', 'itm_sf6'] },
  { file: '08_allotment_work_order.jpg',      title: 'Allotment list / Work Order SE/1232 dtd. 18.06.2026',                  items: ['itm_ct245', 'itm_la390', 'itm_sf6'] },
  { file: '09_site_ct_inspection.jpg',        title: 'Site photograph — CT inspection at 400 kV Karjat',                     items: ['itm_ct245'] },
  { file: '10_site_ct_installation.jpg',      title: 'Site photograph — CT handling / erection at 400 kV Karjat',            items: ['itm_ct245'] },
  { file: '11_ctr_invoice.jpg',               title: 'CTR Tax Invoice 2GSSIA1434 dtd. 13.07.2026 — NIFPS spares',            items: ['itm_n2cyl', 'itm_reg', 'itm_hose', 'itm_valve'] },
  { file: '12_ctr_delivery_challan.jpg',      title: 'Delivery Challan / LR B4002899760 dtd. 13.07.2026 — Assoc. Road Carriers', items: ['itm_n2cyl', 'itm_reg', 'itm_hose', 'itm_valve'] },
  { file: '13_nifps_requirement_email.jpg',   title: 'Requirement of NIFPS material for emergencies — email dtd. 10.07.2026', items: ['itm_n2cyl', 'itm_reg', 'itm_hose', 'itm_valve'] }
];

/** STEP 3 — option A: pull the images straight from your GitHub repo. */
function seedDocumentsFromGitHub() {
  if (GITHUB_RAW_BASE.indexOf('USERNAME/REPO') > -1) {
    throw new Error('Set GITHUB_RAW_BASE at the top of Code.gs first.');
  }
  return seedDocs_(function (d) {
    var res = UrlFetchApp.fetch(GITHUB_RAW_BASE + d.file, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('HTTP ' + res.getResponseCode() + ' for ' + GITHUB_RAW_BASE + d.file);
    }
    return res.getBlob().setName(d.file);
  });
}

/** STEP 3 — option B: images already sitting in a Drive folder. */
function seedDocumentsFromDriveFolder(folderIdOrUrl) {
  if (!folderIdOrUrl) throw new Error('Pass the Drive folder id or URL, e.g. seedDocumentsFromDriveFolder("1A2b3C...")');
  var m = String(folderIdOrUrl).match(/[-\w]{25,}/);
  var src = DriveApp.getFolderById(m ? m[0] : folderIdOrUrl);
  return seedDocs_(function (d) {
    var it = src.getFilesByName(d.file);
    if (!it.hasNext()) throw new Error('File not found in folder: ' + d.file);
    return it.next().getBlob().setName(d.file);
  });
}

function seedDocs_(fetcher) {
  var folder = getFolder_();
  var log = [];
  var existing = {};
  tbl_('DOCS').rows.forEach(function (r) { existing[r.title] = r.id; });

  SEED_DOCS.forEach(function (d) {
    try {
      if (existing[d.title]) { log.push('skip (already there): ' + d.file); return; }
      var blob = fetcher(d);
      var file = folder.createFile(blob);
      var id = uid_('doc');
      insert_('DOCS', { id: id, title: d.title, fileId: file.getId(),
                        thumb: driveThumb_(file), createdAt: new Date().toISOString() });
      // link this document to the first receipt of every material it belongs to
      var recs = tbl_('RECEIPTS').rows;
      d.items.forEach(function (itemId) {
        var first = null;
        recs.forEach(function (r) { if (r.itemId === itemId && !first) first = r; });
        if (first) {
          var cur = json_(first.docs, []);
          if (cur.indexOf(id) < 0) { cur.push(id); updateRow_('RECEIPTS', first.id, { docs: cur }); }
        }
      });
      log.push('OK: ' + d.file + '  →  ' + d.items.join(', '));
    } catch (err) {
      log.push('FAILED: ' + d.file + '  —  ' + err.message);
    }
  });
  Logger.log(log.join('\n'));
  return log.join('\n');
}

/* ======================================================================== *
 *  STEP 2 — BUILD THE DATABASE
 * ======================================================================== */

function setupDatabase() {
  var old = props_().getProperty(CFG.P_SS);
  if (old) {
    try {
      SpreadsheetApp.openById(old);
      throw new Error('Database already exists. Open it with openDatabase(), or run rebuildEverything() to start over.');
    } catch (e) {
      if (String(e.message).indexOf('already exists') > -1) throw e;
    }
  }
  var ss = SpreadsheetApp.create(CFG.SS_NAME);
  props_().setProperty(CFG.P_SS, ss.getId());

  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]])
      .setFontWeight('bold').setBackground('#305496').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, SHEETS[name].length, 150);
  });
  var def = ss.getSheetByName('Sheet1');
  if (def) ss.deleteSheet(def);

  getFolder_();
  seed_();

  var msg = 'Database created.\nSheet : ' + ss.getUrl() + '\nDrive : ' + getFolder_().getUrl()
          + '\n\nNext: run seedDocumentsFromGitHub() (or seedDocumentsFromDriveFolder("<id>")), then deploy as a Web app.';
  Logger.log(msg);
  return msg;
}

function openDatabase() {
  var url = getSS_().getUrl();
  Logger.log('Sheet : ' + url + '\nDrive : ' + getFolder_().getUrl());
  return url;
}

/** Wipes data rows and reloads the seed material (documents are left alone). */
function reloadSeedData() {
  var ss = getSS_();
  ['CATEGORIES', 'ITEMS', 'RECEIPTS', 'ISSUES', 'SETTINGS'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  seed_();
  return 'Seed data reloaded (documents untouched — re-run the document seeder to relink them).';
}

/** Nuclear option: forget the old sheet/folder and build both again. */
function rebuildEverything() {
  props_().deleteProperty(CFG.P_SS);
  props_().deleteProperty(CFG.P_FOLDER);
  return setupDatabase();
}

function healthCheck() {
  var out = [];
  try {
    var ss = getSS_();
    out.push('Sheet OK  : ' + ss.getUrl());
    Object.keys(SHEETS).forEach(function (n) {
      out.push('  ' + n + ': ' + Math.max(0, ss.getSheetByName(n).getLastRow() - 1) + ' row(s)');
    });
  } catch (e) { out.push('Sheet FAIL: ' + e.message); }
  try { out.push('Drive OK  : ' + getFolder_().getUrl()); } catch (e) { out.push('Drive FAIL: ' + e.message); }
  try {
    var b = getBootstrap();
    out.push('API OK    : ' + b.items.length + ' items, ' + b.categories.length + ' categories, ' + b.docs.length + ' documents');
    var flagged = b.items.filter(function (i) { return i.trackLow; }).length;
    out.push('Low-stock flag set on ' + flagged + ' of ' + b.items.length + ' items');
  } catch (e) { out.push('API FAIL  : ' + e.message); }
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/* ======================================================================== *
 *  SEED DATA
 * ======================================================================== */

function seed_() {
  [
    { id: 'cat_ehv', name: 'EHV Equipment', desc: 'Circuit breakers, CTs, CVTs, PTs, isolators, isolator blades, discharge rods and other EHV switchyard equipment.',
      fields: [
        { key: 'equipType', label: 'Equipment Type', type: 'select', required: true, options: ['Circuit Breaker', 'Current Transformer', 'CVT', 'Potential Transformer', 'Surge Arrester', 'Isolator', 'Isolator Blade', 'Discharge Rod', 'Wave Trap', 'Other'] },
        { key: 'voltageClass', label: 'Voltage Class', type: 'select', required: true, options: ['11 kV', '33 kV', '132 kV', '198 kV', '220 kV', '245 kV', '390 kV', '400 kV', '420 kV', '765 kV'] },
        { key: 'make', label: 'Make / Manufacturer', type: 'text', required: true },
        { key: 'typeModel', label: 'Type / Model', type: 'text' },
        { key: 'ratingRatio', label: 'Rating / Ratio', type: 'text' },
        { key: 'serialNos', label: 'Serial No(s).', type: 'textarea' },
        { key: 'yearMfg', label: 'Year of Manufacture', type: 'number' },
        { key: 'standard', label: 'Standard', type: 'text' },
        { key: 'drawingNo', label: 'Drawing No.', type: 'text' },
        { key: 'poLoa', label: 'P.O. / LOA No.', type: 'text' },
        { key: 'weight', label: 'Weight', type: 'text' },
        { key: 'oilQty', label: 'Oil Quantity', type: 'text' }
      ] },
    { id: 'cat_cable', name: 'Cables', desc: 'Power and control cables of various sizes, cores and constructions.',
      fields: [
        { key: 'sizeSqmm', label: 'Size (sq.mm)', type: 'text', required: true, placeholder: 'e.g. 2.5, 6, 95, 240' },
        { key: 'cores', label: 'No. of Cores', type: 'select', required: true, options: ['1C', '2C', '3C', '3.5C', '4C', '7C', '10C', '12C', '19C', '24C', '37C'] },
        { key: 'construction', label: 'Construction', type: 'select', required: true, options: ['Armoured', 'Unarmoured', 'Flexible'] },
        { key: 'conductor', label: 'Conductor', type: 'select', options: ['Copper', 'Aluminium'] },
        { key: 'insulation', label: 'Insulation', type: 'select', options: ['XLPE', 'PVC', 'EPR', 'Rubber'] },
        { key: 'voltageGrade', label: 'Voltage Grade', type: 'text', placeholder: 'e.g. 1.1 kV, 11 kV(E)' },
        { key: 'make', label: 'Make', type: 'text' },
        { key: 'drumNo', label: 'Drum / Coil No.', type: 'text' }
      ] },
    { id: 'cat_hw', name: 'Hardware for EHV Equipment', desc: 'Jumpers, palms, jaws, clamps, connectors and associated switchyard hardware.',
      fields: [
        { key: 'subType', label: 'Hardware Type', type: 'select', required: true, options: ['Jumper', 'Palm / Terminal Connector', 'Jaw Contact', 'Clamp', 'Spacer', 'Conductor Fitting', 'Insulator String Fitting', 'Earthing Material', 'Other'] },
        { key: 'appliesTo', label: 'Applicable Equipment', type: 'text', placeholder: 'e.g. 245 kV CT, 400 kV Isolator' },
        { key: 'sizeSpec', label: 'Size / Specification', type: 'text' },
        { key: 'material', label: 'Material', type: 'select', options: ['Aluminium', 'Copper', 'Bimetallic', 'Galvanised Steel', 'Stainless Steel'] },
        { key: 'make', label: 'Make', type: 'text' }
      ] },
    { id: 'cat_gas', name: 'Gases & Consumables', desc: 'SF6, nitrogen, transformer oil and other consumables held as emergency spares.',
      fields: [
        { key: 'gasType', label: 'Gas / Consumable', type: 'select', required: true, options: ['SF6 Gas', 'Nitrogen', 'Transformer Oil', 'Compressed Air', 'Other'] },
        { key: 'cylCapacity', label: 'Cylinder Capacity / Pack Size', type: 'text', required: true, placeholder: 'e.g. 25 kg, 68 litre' },
        { key: 'standard', label: 'Standard', type: 'text', placeholder: 'e.g. IS 7285' },
        { key: 'cylinderNo', label: 'Cylinder / Batch No.', type: 'text' },
        { key: 'testDue', label: 'Next Hydro Test Due', type: 'date' },
        { key: 'make', label: 'Make / Supplier', type: 'text' }
      ] },
    { id: 'cat_nifps', name: 'NIFPS / Fire Protection', desc: 'Nitrogen Injection Fire Protection System spares held for AMC emergencies (CTR system).',
      fields: [
        { key: 'subSystem', label: 'Sub-system', type: 'select', required: true, options: ['Nitrogen Injection', 'Regulator', 'Piping / Hose', 'Valve', 'Control Panel', 'Fire Detection', 'Other'] },
        { key: 'make', label: 'Make', type: 'text', required: true },
        { key: 'partNo', label: 'Part No. / Model', type: 'text' },
        { key: 'hsnCode', label: 'HSN Code', type: 'text' },
        { key: 'specification', label: 'Specification', type: 'textarea' },
        { key: 'compatibleWith', label: 'Compatible With', type: 'text', placeholder: 'e.g. CTR NIFPS at 400 kV Karjat' }
      ] }
  ].forEach(function (c) { insert_('CATEGORIES', c); });

  [['siteName', '400 kV Karjat Substation'], ['division', '400 kV RS Division, Karjat']]
    .forEach(function (kv) { insert_('SETTINGS', { key: kv[0], value: kv[1] }); });

  var GP = { source: 'Major Store, Dhule (MSETCL)', refType: 'Gate Pass', refNo: '651/1431 dtd. 06.07.2026',
             invoiceNo: '', vehicle: 'MH-18 AA 7727 (Vaishali Transport)', receivedBy: 'Shri P. T. Mali' };
  var CTR = { source: 'CTR Manufacturing Industries Pvt. Ltd., Nagar Road, Pune - 411014',
              refType: 'Invoice & Delivery Challan',
              refNo: 'LR B4002899760 dtd. 13.07.2026 (Associated Road Carriers Ltd.)',
              invoiceNo: '2GSSIA1434 dtd. 13.07.2026', vehicle: 'Door delivery — ARC, ex-Wagholi (WGLB)',
              receivedBy: '' };

  function add_(item, rc) {
    insert_('ITEMS', {
      id: item.id, categoryId: item.categoryId, name: item.name, unit: item.unit,
      location: item.location, trackLow: item.trackLow, lowCutoff: item.lowCutoff,
      fields: item.fields, remarks: item.remarks, createdAt: item.createdAt, updatedAt: item.createdAt
    });
    insert_('RECEIPTS', {
      id: uid_('rcp'), itemId: item.id, date: rc.date, qty: rc.qty,
      source: rc.base.source, refType: rc.base.refType, refNo: rc.base.refNo,
      invoiceNo: rc.base.invoiceNo, vehicle: rc.base.vehicle, receivedBy: rc.base.receivedBy,
      unitRate: rc.unitRate || 0, taxableAmt: rc.taxableAmt || 0, gstPct: rc.gstPct || 0,
      totalAmt: rc.totalAmt || 0, remarks: rc.remarks || '', docs: [], createdAt: new Date().toISOString()
    });
  }

  add_({ id: 'itm_ct245', categoryId: 'cat_ehv', name: '245 kV Current Transformer (MEHRU)', unit: 'Nos.',
    location: 'Store Yard, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { equipType: 'Current Transformer', voltageClass: '245 kV', make: 'MEHRU Electrical & Mechanical Engineers (P) Ltd.',
      typeModel: 'CT with S.S. Bellow (suitable for hot line washing)', ratingRatio: '800-1600/1A, 5C, 40 kA for 1 sec',
      serialNos: 'OC 11183/2/23/21\nOC 11183/2/24/21', yearMfg: 2021, standard: 'IS 16227',
      drawingNo: 'ME-220CT-GA-11183-02', poLoa: 'SP/T-0604/0520/00265 dtd. 22.04.2021',
      weight: '825 kg (approx.)', oilQty: '215 litres (approx.)' },
    remarks: 'Critical emergency spare. 5 cores: Core-3 metering 0.2S/15 VA, remaining PS class. Highest system voltage 245 kV, system voltage 220 kV, creepage 6125 mm.',
    createdAt: '2026-07-06T10:00:00.000Z' },
    { base: GP, date: '2026-07-06', qty: 2, remarks: 'Allotted 2 Nos. against Work Order SE/1232 dtd. 18.06.2026 — fully received.' });

  add_({ id: 'itm_la390', categoryId: 'cat_ehv', name: '390 kV, 20 kA MO Gapless Surge Arrester (LAMCO)', unit: 'Set',
    location: 'Store Room, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { equipType: 'Surge Arrester', voltageClass: '390 kV', make: 'LAMCO Industries Pvt. Ltd.',
      typeModel: 'MORESTER Gapless Surge Arrester — Type LMAS',
      ratingRatio: '97.5 kV, 20 kA, CL-4 per stack × 4 stacks = 390 kV; MCOV 75.75 kV/stack',
      serialNos: '40 A\n40 B\n40 C\n40 D', yearMfg: 2025,
      poLoa: 'SP/L-14/T-0622/0724/LAMCO/NO.00714 dtd. 23.05.2025' },
    remarks: '1 Set = 4 series stacks (40 A/B/C/D) with all accessories. Pressure relief current 40 kA, 50 Hz. Allotted 3 Nos.; only 1 lifted — balance 2 Nos. available at 400 kV BSL-2 Dn. as per EE, Major Stores Dhule.',
    createdAt: '2026-07-06T10:00:00.000Z' },
    { base: GP, date: '2026-07-06', qty: 1, remarks: 'Allotted 3 Nos.; 1 Set received. Balance 2 Nos. to be lifted from 400 kV BSL-2 Dn. per allocation.' });

  add_({ id: 'itm_sf6', categoryId: 'cat_gas', name: 'SF6 Gas Cylinder — 25 kg (Duly Filled)', unit: 'Nos.',
    location: 'Gas Cylinder Bay, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { gasType: 'SF6 Gas', cylCapacity: '25 kg' },
    remarks: 'Duly filled cylinders held as emergency spare for EHV breaker top-up. No nameplate provided on cylinders.',
    createdAt: '2026-07-06T10:00:00.000Z' },
    { base: GP, date: '2026-07-06', qty: 2, remarks: 'Allotted 2 Nos. — fully received.' });

  add_({ id: 'itm_n2cyl', categoryId: 'cat_nifps', name: 'Nitrogen Cylinder — 68 Litre (NIFPS)', unit: 'Nos.',
    location: 'NIFPS Panel Area, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { subSystem: 'Nitrogen Injection', make: 'CTR Manufacturing Industries Pvt. Ltd., Pune', hsnCode: '85049010',
      specification: 'Nitrogen Cylinder, 68 litre water capacity, as per IS 7285', compatibleWith: 'CTR NIFPS system, 400 kV Karjat SS' },
    remarks: 'Procured against AMC emergency requirement for the CTR NIFPS system (requirement raised 10.07.2026).',
    createdAt: '2026-07-13T10:00:00.000Z' },
    { base: CTR, date: '2026-07-13', qty: 1, unitRate: 37950, taxableAmt: 37950, gstPct: 18, totalAmt: 44781,
      remarks: 'NIFPS AMC emergency spare. Consignment: 2 packages (1 loose + 1 box), 100 kg actual / 120 kg charged.' });

  add_({ id: 'itm_reg', categoryId: 'cat_nifps', name: 'Regulator Sub-Assembly (NIFPS)', unit: 'Nos.',
    location: 'NIFPS Panel Area, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { subSystem: 'Regulator', make: 'CTR Manufacturing Industries Pvt. Ltd., Pune', hsnCode: '85049010',
      specification: 'Regulator Sub-Assembly for NIFPS nitrogen injection circuit', compatibleWith: 'CTR NIFPS system, 400 kV Karjat SS' },
    remarks: 'Procured against AMC emergency requirement for the CTR NIFPS system (requirement raised 10.07.2026).',
    createdAt: '2026-07-13T10:00:00.000Z' },
    { base: CTR, date: '2026-07-13', qty: 1, unitRate: 21275, taxableAmt: 21275, gstPct: 18, totalAmt: 25104.5,
      remarks: 'NIFPS AMC emergency spare.' });

  add_({ id: 'itm_hose', categoryId: 'cat_nifps', name: 'Hose Pipe 1/4" (NIFPS)', unit: 'Nos.',
    location: 'NIFPS Panel Area, 400 kV Karjat SS', trackLow: true, lowCutoff: 2,
    fields: { subSystem: 'Piping / Hose', make: 'CTR Manufacturing Industries Pvt. Ltd., Pune', hsnCode: '85049010',
      specification: 'Hose Pipe, 1/4 inch, for NIFPS nitrogen injection circuit', compatibleWith: 'CTR NIFPS system, 400 kV Karjat SS' },
    remarks: 'Procured against AMC emergency requirement for the CTR NIFPS system (requirement raised 10.07.2026).',
    createdAt: '2026-07-13T10:00:00.000Z' },
    { base: CTR, date: '2026-07-13', qty: 2, unitRate: 2415, taxableAmt: 4830, gstPct: 18, totalAmt: 5699.4,
      remarks: 'NIFPS AMC emergency spare. Unit rate ₹2,415 each × 2 Nos.' });

  add_({ id: 'itm_valve', categoryId: 'cat_nifps', name: 'Stem Actuated Valve Assembly (NIFPS)', unit: 'Nos.',
    location: 'NIFPS Panel Area, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { subSystem: 'Valve', make: 'CTR Manufacturing Industries Pvt. Ltd., Pune', hsnCode: '85049010',
      specification: 'Stem Actuated Valve Assembly for NIFPS', compatibleWith: 'CTR NIFPS system, 400 kV Karjat SS' },
    remarks: 'Procured against AMC emergency requirement for the CTR NIFPS system (requirement raised 10.07.2026).',
    createdAt: '2026-07-13T10:00:00.000Z' },
    { base: CTR, date: '2026-07-13', qty: 1, unitRate: 13225, taxableAmt: 13225, gstPct: 18, totalAmt: 15605.5,
      remarks: 'NIFPS AMC emergency spare.' });
}
