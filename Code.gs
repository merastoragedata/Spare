/**
 * ============================================================================
 *  MSETCL — 400 kV Karjat Substation | Spare Material & Test Kit Register
 *  Google Apps Script backend — Code.gs
 * ============================================================================
 *  UPGRADING FROM AN EARLIER VERSION (you already have data — nothing to delete)
 *   1. Replace Code.gs and index.html with these files.
 *   2. Run  ▶ migrate()   — creates any new sheets/columns (Users, Kits, etc.),
 *            self-heals existing sheets, and creates the admin login
 *            (admin / admin123) if it doesn't exist yet. Safe to re-run.
 *   3. Deploy ▸ Manage deployments ▸ Edit (pencil) ▸ New version ▸ Deploy.
 *            (Saving Code.gs alone does NOT update the live web app — you must
 *            create a new version every time you change this file.)
 *   4. Run  ▶ healthCheck()
 *
 *  FRESH INSTALL
 *   1. Run ▶ setupDatabase()   2. Run ▶ indexDocuments()   3. Deploy as above.
 * ============================================================================
 */

var DOCS_FOLDER_ID = '1jOe2IPDvrOp7VpDVOdurni0XzG0-TtYO';

/* Bumped whenever the API surface changes. index.html checks this so a stale
   deployment reports itself clearly instead of failing with a cryptic error. */
var BACKEND_VERSION = '3.0.0';
var CFG = { SS_NAME: 'Karjat Spare Material Register (Database)', P_SS: 'SS_ID', P_SECRET: 'AUTH_SECRET' };

/* Logical schema. Column ORDER here doesn't need to match the physical sheet —
   tbl_() reads/writes by header NAME, and auto-adds any missing header. This
   means new columns can be introduced safely without touching existing data. */
var SHEETS = {
  SETTINGS:    ['key', 'value'],
  USERS:       ['id', 'username', 'fullName', 'passHash', 'salt', 'role', 'status', 'createdAt', 'updatedAt'],
  CATEGORIES:  ['id', 'kind', 'name', 'desc', 'fields'],
  ITEMS:       ['id', 'categoryId', 'name', 'unit', 'location', 'trackLow', 'lowCutoff', 'docMode', 'fields', 'remarks', 'docs', 'createdAt', 'updatedAt'],
  RECEIPTS:    ['id', 'itemId', 'date', 'qty', 'source', 'refType', 'refNo', 'invoiceNo', 'vehicle', 'receivedBy',
                'unitRate', 'taxableAmt', 'gstPct', 'totalAmt', 'remarks', 'docs', 'createdAt', 'updatedAt'],
  ISSUES:      ['id', 'itemId', 'moveType', 'date', 'qty', 'purpose', 'issuedTo', 'location', 'authorisedBy', 'workDetails', 'remarks', 'docs', 'createdAt', 'updatedAt'],
  DOCS:        ['id', 'title', 'fileId', 'thumb', 'createdAt'],
  KITS:        ['id', 'categoryId', 'name', 'ownership', 'ownerDetail', 'status', 'location', 'fields', 'remarks', 'docs', 'createdAt', 'updatedAt'],
  KIT_MOVES:   ['id', 'kitId', 'direction', 'date', 'party', 'reason', 'refType', 'refNo', 'expectedReturn', 'actualReturn', 'remarks', 'docs', 'createdAt', 'updatedAt'],
  KIT_REPAIRS: ['id', 'kitId', 'dateSent', 'sentTo', 'reason', 'expenseBefore', 'status', 'dateReceived', 'actualExpense', 'issues', 'remarks', 'docs', 'createdAt', 'updatedAt']
};

var DEFAULT_UOMS = ['Nos.', 'Set', 'Metre', 'Coil', 'Drum', 'Litre', 'Kg', 'Pair', 'Lot'];
var DEFAULT_OWNERSHIPS = ['Maintenance Unit', 'Testing Unit', 'Operation Unit', 'Third Party Agency (Returnable)', 'Third Party Agency (Owned)'];
var DEFAULT_KIT_STATUSES = ['Healthy', 'Has Few Issues (functional)', 'Has Severe Issues', 'Faulty'];
var DEFAULT_MOVE_REASONS = ['Calibration', 'Repair', 'Loaned to Substation', 'Testing Support', 'Returned After Use'];

/* ======================================================================== *
 *  PERMISSIONS
 * ======================================================================== */
var PUBLIC_FNS = ['login', 'register'];
var ADMIN_FNS = ['deleteItem', 'deleteCategory', 'deleteRecord', 'deleteDoc', 'deleteKit', 'deleteKitEntry',
                  'listUsers', 'approveUser', 'rejectUser', 'setUserRole', 'resetPassword'];
var ANY_ROLE_FNS = ['getBootstrap', 'getDocFull', 'changePassword', 'whoAmI'];

function requiredRole_(fn) {
  if (PUBLIC_FNS.indexOf(fn) > -1) return 'public';
  if (ADMIN_FNS.indexOf(fn) > -1) return 'admin';
  if (ANY_ROLE_FNS.indexOf(fn) > -1) return 'any';
  return 'editor'; // default: editor or admin may call; viewer may not
}

/* ======================================================================== *
 *  API ROUTER
 * ======================================================================== */
var API = {
  login: function (u, p) { return apiLogin(u, p); },
  register: function (u, p, n) { return apiRegister(u, p, n); },
  whoAmI: function (sess) { return sess; },
  changePassword: function (old, nw, sess) { return apiChangePassword(old, nw, sess); },
  listUsers: function () { return apiListUsers(); },
  approveUser: function (id, role) { return apiApproveUser(id, role); },
  rejectUser: function (id) { return apiRejectUser(id); },
  setUserRole: function (id, role) { return apiSetUserRole(id, role); },
  resetPassword: function (id, nw) { return apiResetPassword(id, nw); },

  getBootstrap: function () { return getBootstrap(); },
  addItem: function (p) { return apiAddItem(p); },
  updateItem: function (id, p) { return apiUpdateItem(id, p); },
  deleteItem: function (id) { return apiDeleteItem(id); },
  addReceipt: function (id, r) { return apiAddReceipt(id, r); },
  updateReceipt: function (id, r) { return apiUpdateReceipt(id, r); },
  addIssue: function (id, r) { return apiAddIssue(id, r); },
  updateIssue: function (id, r) { return apiUpdateIssue(id, r); },
  deleteRecord: function (k, id) { return apiDeleteRecord(k, id); },

  saveCategory: function (p) { return apiSaveCategory(p); },
  deleteCategory: function (id) { return apiDeleteCategory(id); },
  saveField: function (c, f) { return apiSaveField(c, f); },
  updateField: function (c, k, p) { return apiUpdateField(c, k, p); },
  deleteField: function (c, k) { return apiDeleteField(c, k); },
  moveField: function (c, k, d) { return apiMoveField(c, k, d); },
  addFieldOption: function (c, k, o) { return apiAddFieldOption(c, k, o); },
  delFieldOption: function (c, k, o) { return apiDelFieldOption(c, k, o); },
  addUom: function (u) { return apiAddUom(u); },
  addListSetting: function (key, v) { return apiAddListSetting(key, v); },

  uploadDoc: function (p) { return apiUploadDoc(p); },
  getDocFull: function (id) { return apiGetDocFull(id); },
  renameDoc: function (id, t) { return apiRenameDoc(id, t); },
  linkDocs: function (k, id, d) { return apiLinkDocs(k, id, d); },
  unlinkDoc: function (k, id, d) { return apiUnlinkDoc(k, id, d); },
  deleteDoc: function (id) { return apiDeleteDoc(id); },
  syncFolder: function () { return apiSyncFolder(); },

  addKit: function (p) { return apiAddKit(p); },
  updateKit: function (id, p) { return apiUpdateKit(id, p); },
  deleteKit: function (id) { return apiDeleteKit(id); },
  addKitMove: function (id, p) { return apiAddKitMove(id, p); },
  updateKitMove: function (id, p) { return apiUpdateKitMove(id, p); },
  addKitRepair: function (id, p) { return apiAddKitRepair(id, p); },
  updateKitRepair: function (id, p) { return apiUpdateKitRepair(id, p); },
  deleteKitEntry: function (k, id) { return apiDeleteKitEntry(k, id); }
};

function __api__(fn, args, token) {
  return guarded_(fn, args || [], token);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.fn) {
    var out;
    try { out = { ok: true, data: guarded_(e.parameter.fn, JSON.parse(e.parameter.args || '[]'), e.parameter.token) }; }
    catch (err) { out = { ok: false, error: String(err.message || err) }; }
    var txt = JSON.stringify(out);
    if (e.parameter.callback) return ContentService.createTextOutput(e.parameter.callback + '(' + txt + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
    return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.JSON);
  }
  try {
    return HtmlService.createHtmlOutputFromFile('index').setTitle('Spare Material & Test Kit Register — 400 kV Karjat SS')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: true, msg: 'API is live.', version: BACKEND_VERSION }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  var out;
  try { out = { ok: true, data: guarded_(body.fn, body.args || [], body.token) }; }
  catch (err) { out = { ok: false, error: String(err && err.message ? err.message : err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function guarded_(fn, args, token) {
  if (!API[fn]) throw new Error('Unknown API function: ' + fn);
  var need = requiredRole_(fn);
  if (need === 'public') return API[fn].apply(null, args);
  var sess = verifyToken_(token);
  if (!sess) throw new Error('Please log in again.');
  if (need === 'admin' && sess.role !== 'admin') throw new Error('Admin access required for this action.');
  if (need === 'editor' && sess.role === 'viewer') throw new Error('Viewer accounts cannot make changes — Editor or Admin required.');
  return API[fn].apply(null, args.concat([sess]));
}

/* ======================================================================== *
 *  AUTH
 * ======================================================================== */

function secret_() {
  var p = props_(); var s = p.getProperty(CFG.P_SECRET);
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty(CFG.P_SECRET, s); }
  return s;
}
function hash_(pw, salt) {
  var d = Utilities.computeHmacSha256Signature(pw, salt + secret_());
  return Utilities.base64Encode(d);
}
function makeToken_(user) {
  var payload = JSON.stringify({ id: user.id, u: user.username, r: user.role, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 });
  var b64 = Utilities.base64EncodeWebSafe(payload);
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(b64, secret_()));
  return b64 + '.' + sig;
}
function verifyToken_(token) {
  if (!token || token.indexOf('.') < 0) return null;
  var parts = token.split('.'); var b64 = parts[0], sig = parts[1];
  var expect = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(b64, secret_()));
  if (sig !== expect) return null;
  try {
    var payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString());
    if (payload.exp < Date.now()) return null;
    // still-approved & role-current check against USERS sheet
    var u = find_('USERS', payload.id);
    if (!u || u.status !== 'approved') return null;
    return { id: u.id, username: u.username, role: u.role };
  } catch (e) { return null; }
}

function apiLogin(username, password) {
  username = String(username || '').trim().toLowerCase();
  var u = null;
  tbl_('USERS').rows.forEach(function (r) { if (String(r.username).toLowerCase() === username) u = r; });
  if (!u) throw new Error('Unknown username or password.');
  if (hash_(password, u.salt) !== u.passHash) throw new Error('Unknown username or password.');
  if (u.status === 'pending') throw new Error('Your account is awaiting admin approval.');
  if (u.status === 'rejected') throw new Error('This account has been disabled. Contact the admin.');
  return { token: makeToken_(u), username: u.username, fullName: u.fullName, role: u.role };
}

function apiRegister(username, password, fullName) {
  username = String(username || '').trim().toLowerCase();
  if (!username || username.length < 3) throw new Error('Choose a username with at least 3 characters.');
  if (!password || password.length < 4) throw new Error('Choose a password with at least 4 characters.');
  var exists = false;
  tbl_('USERS').rows.forEach(function (r) { if (String(r.username).toLowerCase() === username) exists = true; });
  if (exists) throw new Error('That username is already taken.');
  var salt = Utilities.getUuid();
  insert_('USERS', { id: uid_('usr'), username: username, fullName: fullName || username, passHash: hash_(password, salt),
    salt: salt, role: 'editor', status: 'pending', createdAt: now_(), updatedAt: now_() });
  return { pending: true };
}

function apiChangePassword(oldPw, newPw, sess) {
  var u = find_('USERS', sess.id);
  if (!u) throw new Error('User not found');
  if (hash_(oldPw, u.salt) !== u.passHash) throw new Error('Current password is incorrect.');
  if (!newPw || newPw.length < 4) throw new Error('New password must be at least 4 characters.');
  updateRow_('USERS', u.id, { passHash: hash_(newPw, u.salt), updatedAt: now_() });
  return { ok: true };
}

function apiListUsers() {
  return tbl_('USERS').rows.map(function (r) {
    return { id: r.id, username: r.username, fullName: r.fullName, role: r.role, status: r.status, createdAt: r.createdAt };
  });
}
function apiApproveUser(id, role) {
  updateRow_('USERS', id, { status: 'approved', role: role || 'editor', updatedAt: now_() });
  return apiListUsers();
}
function apiRejectUser(id) { updateRow_('USERS', id, { status: 'rejected', updatedAt: now_() }); return apiListUsers(); }
function apiSetUserRole(id, role) {
  if (['admin', 'editor', 'viewer'].indexOf(role) < 0) throw new Error('Invalid role');
  updateRow_('USERS', id, { role: role, updatedAt: now_() });
  return apiListUsers();
}
/** Admin resets someone's password WITHOUT knowing the old one. */
function apiResetPassword(id, newPw) {
  var u = find_('USERS', id);
  if (!u) throw new Error('User not found');
  if (!newPw || newPw.length < 4) throw new Error('New password must be at least 4 characters.');
  var salt = Utilities.getUuid();
  updateRow_('USERS', id, { salt: salt, passHash: hash_(newPw, salt), updatedAt: now_() });
  return { ok: true };
}

/* ======================================================================== *
 *  INFRA — self-migrating, header-driven sheet access
 * ======================================================================== */

function props_() { return PropertiesService.getScriptProperties(); }
function getSS_() {
  var id = props_().getProperty(CFG.P_SS);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  throw new Error('Database not created yet — run setupDatabase() once from the editor.');
}
function getFolder_() {
  if (!DOCS_FOLDER_ID || DOCS_FOLDER_ID.indexOf('PASTE') === 0) throw new Error('Set DOCS_FOLDER_ID at the top of Code.gs');
  return DriveApp.getFolderById(DOCS_FOLDER_ID);
}

function headerMap_(sh) {
  var last = sh.getLastColumn();
  var header = last > 0 ? sh.getRange(1, 1, 1, last).getValues()[0] : [];
  var map = {};
  header.forEach(function (h, i) { if (h) map[h] = i + 1; });
  return { header: header, map: map };
}
function ensureCols_(sh, desired) {
  var hm = headerMap_(sh);
  var missing = desired.filter(function (k) { return !hm.map[k]; });
  if (missing.length) {
    var startCol = hm.header.length + 1;
    var rng = sh.getRange(1, startCol, 1, missing.length);
    rng.setValues([missing]).setFontWeight('bold').setBackground('#305496').setFontColor('#ffffff');
    hm = headerMap_(sh);
  }
  return hm;
}
function ensureSheet_(name) {
  var ss = getSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold').setBackground('#305496').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
function tbl_(name) {
  if (!SHEETS[name]) throw new Error('Unknown table: ' + name);
  var sh = ensureSheet_(name);
  var hm = ensureCols_(sh, SHEETS[name]);
  var idField = SHEETS[name][0]; // 'id' for most tables, 'key' for SETTINGS
  var last = sh.getLastRow();
  var idCol = hm.map[idField];
  var rows = [];
  if (last > 1 && idCol) {
    var vals = sh.getRange(2, 1, last - 1, hm.header.length).getValues();
    vals.forEach(function (r, idx) {
      if (!r[idCol - 1] && r[idCol - 1] !== 0) return;
      var o = { __row: idx + 2 };
      SHEETS[name].forEach(function (k) { o[k] = hm.map[k] ? r[hm.map[k] - 1] : ''; });
      rows.push(o);
    });
  }
  return { sh: sh, hm: hm, rows: rows, idField: idField };
}
function cell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}
function insert_(name, obj) {
  var t = tbl_(name);
  var row = new Array(t.hm.header.length).fill('');
  SHEETS[name].forEach(function (k) { if (t.hm.map[k]) row[t.hm.map[k] - 1] = cell_(obj[k]); });
  t.sh.appendRow(row);
  return obj;
}
function find_(name, id) {
  var t = tbl_(name); var hit = null;
  t.rows.forEach(function (r) { if (String(r[t.idField]) === String(id)) hit = r; });
  return hit;
}
function updateRow_(name, id, obj) {
  var t = tbl_(name), hit = null;
  t.rows.forEach(function (r) { if (String(r[t.idField]) === String(id)) hit = r; });
  if (!hit) throw new Error('Record not found: ' + id);
  var rng = t.sh.getRange(hit.__row, 1, 1, t.hm.header.length);
  var row = rng.getValues()[0];
  SHEETS[name].forEach(function (k) {
    if (!t.hm.map[k]) return;
    var v = obj[k] !== undefined ? obj[k] : hit[k];
    row[t.hm.map[k] - 1] = cell_(v);
  });
  rng.setValues([row]);
  return obj;
}
function deleteRow_(name, id) {
  var t = tbl_(name);
  for (var i = t.rows.length - 1; i >= 0; i--) {
    if (String(t.rows[i][t.idField]) === String(id)) { t.sh.deleteRow(t.rows[i].__row); return true; }
  }
  return false;
}
function uid_(p) { return (p || 'x') + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function json_(v, fb) {
  if (v === '' || v === null || v === undefined) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return fb; }
}
function lock_(fn) { var l = LockService.getScriptLock(); l.waitLock(25000); try { return fn(); } finally { l.releaseLock(); } }
function dstr_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v).slice(0, 10);
}
function now_() { return new Date().toISOString(); }
function boolv_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

/* ======================================================================== *
 *  READ (bootstrap)
 * ======================================================================== */

function getBootstrap() {
  var cats = tbl_('CATEGORIES').rows.map(function (c) {
    return { id: c.id, kind: c.kind || 'material', name: c.name, desc: c.desc, fields: json_(c.fields, []) };
  });
  var recs = tbl_('RECEIPTS').rows, isss = tbl_('ISSUES').rows;
  var items = tbl_('ITEMS').rows.map(function (i) {
    return {
      id: i.id, categoryId: i.categoryId, name: i.name, unit: i.unit, location: i.location,
      trackLow: boolv_(i.trackLow), lowCutoff: Number(i.lowCutoff || 0), docMode: i.docMode || 'consignment',
      fields: json_(i.fields, {}), remarks: i.remarks, docs: json_(i.docs, []), createdAt: i.createdAt,
      receipts: recs.filter(function (r) { return r.itemId === i.id; }).map(function (r) {
        return { id: r.id, date: dstr_(r.date), qty: Number(r.qty || 0), source: r.source, refType: r.refType,
          refNo: r.refNo, invoiceNo: r.invoiceNo, vehicle: r.vehicle, receivedBy: r.receivedBy,
          unitRate: Number(r.unitRate || 0), taxableAmt: Number(r.taxableAmt || 0), gstPct: Number(r.gstPct || 0),
          totalAmt: Number(r.totalAmt || 0), remarks: r.remarks, docs: json_(r.docs, []) };
      }),
      issues: isss.filter(function (r) { return r.itemId === i.id; }).map(function (r) {
        return { id: r.id, moveType: r.moveType || 'Utilised', date: dstr_(r.date), qty: Number(r.qty || 0), purpose: r.purpose,
          issuedTo: r.issuedTo, location: r.location, authorisedBy: r.authorisedBy, workDetails: r.workDetails,
          remarks: r.remarks, docs: json_(r.docs, []) };
      })
    };
  });
  var settings = {};
  tbl_('SETTINGS').rows.forEach(function (r) { settings[r.key] = r.value; });
  var uoms = json_(settings.uoms, DEFAULT_UOMS);
  var ownerships = json_(settings.kitOwnerships, DEFAULT_OWNERSHIPS);
  var kitStatuses = json_(settings.kitStatuses, DEFAULT_KIT_STATUSES);
  var moveReasons = json_(settings.kitMoveReasons, DEFAULT_MOVE_REASONS);
  var docs = tbl_('DOCS').rows.map(function (d) {
    return { id: d.id, title: d.title, fileId: d.fileId, thumb: d.thumb, url: 'https://drive.google.com/file/d/' + d.fileId + '/view' };
  });

  var kmoves = tbl_('KIT_MOVES').rows, kreps = tbl_('KIT_REPAIRS').rows;
  var kits = tbl_('KITS').rows.map(function (k) {
    return {
      id: k.id, categoryId: k.categoryId, name: k.name, ownership: k.ownership, ownerDetail: k.ownerDetail,
      status: k.status, location: k.location, fields: json_(k.fields, {}), remarks: k.remarks, docs: json_(k.docs, []),
      createdAt: k.createdAt,
      moves: kmoves.filter(function (m) { return m.kitId === k.id; }).map(function (m) {
        return { id: m.id, direction: m.direction, date: dstr_(m.date), party: m.party, reason: m.reason, refType: m.refType,
          refNo: m.refNo, expectedReturn: dstr_(m.expectedReturn), actualReturn: dstr_(m.actualReturn), remarks: m.remarks, docs: json_(m.docs, []) };
      }),
      repairs: kreps.filter(function (r) { return r.kitId === k.id; }).map(function (r) {
        return { id: r.id, dateSent: dstr_(r.dateSent), sentTo: r.sentTo, reason: r.reason, expenseBefore: Number(r.expenseBefore || 0),
          status: r.status || 'Sent', dateReceived: dstr_(r.dateReceived), actualExpense: Number(r.actualExpense || 0),
          issues: json_(r.issues, []), remarks: r.remarks, docs: json_(r.docs, []) };
      })
    };
  });

  return {
    version: BACKEND_VERSION,
    settings: settings, uoms: uoms, ownerships: ownerships, kitStatuses: kitStatuses, moveReasons: moveReasons,
    categories: cats, items: items, docs: docs, kits: kits,
    folderUrl: 'https://drive.google.com/drive/folders/' + DOCS_FOLDER_ID,
    serverDate: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  };
}

/* ======================================================================== *
 *  ITEMS / RECEIPTS / ISSUES
 * ======================================================================== */

function apiAddItem(p) {
  return lock_(function () {
    if (!p || !p.name) throw new Error('Item name is required');
    if (!p.categoryId) throw new Error('Category is required');
    if (p.trackLow && !(Number(p.lowCutoff) >= 0)) throw new Error('Low-stock cut-off is required when the alert flag is on');
    var id = uid_('itm');
    insert_('ITEMS', { id: id, categoryId: p.categoryId, name: p.name, unit: p.unit || 'Nos.', location: p.location || '',
      trackLow: !!p.trackLow, lowCutoff: Number(p.lowCutoff || 0), docMode: p.docMode || 'consignment',
      fields: p.fields || {}, remarks: p.remarks || '', docs: p.docs || [], createdAt: now_(), updatedAt: now_() });
    if (p.receipt && Number(p.receipt.qty) > 0) {
      var r = p.receipt;
      insert_('RECEIPTS', { id: uid_('rcp'), itemId: id, date: r.date, qty: Number(r.qty), source: r.source || '',
        refType: r.refType || '', refNo: r.refNo || '', invoiceNo: r.invoiceNo || '', vehicle: r.vehicle || '',
        receivedBy: r.receivedBy || '', unitRate: Number(r.unitRate || 0), taxableAmt: Number(r.taxableAmt || 0),
        gstPct: Number(r.gstPct || 0), totalAmt: Number(r.totalAmt || 0), remarks: r.remarks || '',
        docs: r.docs || [], createdAt: now_(), updatedAt: now_() });
    }
    return getBootstrap();
  });
}
function apiUpdateItem(id, p) {
  return lock_(function () {
    var cur = find_('ITEMS', id);
    if (!cur) throw new Error('Material not found');
    if (p.trackLow && !(Number(p.lowCutoff) >= 0)) throw new Error('Low-stock cut-off is required when the alert flag is on');
    updateRow_('ITEMS', id, {
      name: p.name !== undefined ? p.name : cur.name,
      categoryId: p.categoryId !== undefined ? p.categoryId : cur.categoryId,
      unit: p.unit !== undefined ? p.unit : cur.unit,
      location: p.location !== undefined ? p.location : cur.location,
      trackLow: p.trackLow !== undefined ? !!p.trackLow : boolv_(cur.trackLow),
      lowCutoff: p.lowCutoff !== undefined ? Number(p.lowCutoff || 0) : Number(cur.lowCutoff || 0),
      docMode: p.docMode !== undefined ? p.docMode : (cur.docMode || 'consignment'),
      fields: p.fields !== undefined ? p.fields : json_(cur.fields, {}),
      remarks: p.remarks !== undefined ? p.remarks : cur.remarks,
      docs: p.docs !== undefined ? p.docs : json_(cur.docs, []),
      updatedAt: now_()
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
    insert_('RECEIPTS', { id: uid_('rcp'), itemId: itemId, date: r.date, qty: Number(r.qty), source: r.source || '',
      refType: r.refType || '', refNo: r.refNo || '', invoiceNo: r.invoiceNo || '', vehicle: r.vehicle || '',
      receivedBy: r.receivedBy || '', unitRate: Number(r.unitRate || 0), taxableAmt: Number(r.taxableAmt || 0),
      gstPct: Number(r.gstPct || 0), totalAmt: Number(r.totalAmt || 0), remarks: r.remarks || '',
      docs: r.docs || [], createdAt: now_(), updatedAt: now_() });
    return getBootstrap();
  });
}
function apiUpdateReceipt(id, r) {
  return lock_(function () {
    var cur = find_('RECEIPTS', id);
    if (!cur) throw new Error('Receipt not found');
    var q = Number(r.qty);
    if (!(q > 0)) throw new Error('Quantity must be greater than zero');
    var recd = 0, issd = 0;
    tbl_('RECEIPTS').rows.forEach(function (x) { if (x.itemId === cur.itemId) recd += (x.id === id ? q : Number(x.qty || 0)); });
    tbl_('ISSUES').rows.forEach(function (x) { if (x.itemId === cur.itemId) issd += Number(x.qty || 0); });
    if (recd - issd < 0) throw new Error('That quantity would make the balance negative (' + issd + ' already issued)');
    updateRow_('RECEIPTS', id, { date: r.date, qty: q, source: r.source || '', refType: r.refType || '', refNo: r.refNo || '',
      invoiceNo: r.invoiceNo || '', vehicle: r.vehicle || '', receivedBy: r.receivedBy || '', unitRate: Number(r.unitRate || 0),
      taxableAmt: Number(r.taxableAmt || 0), gstPct: Number(r.gstPct || 0), totalAmt: Number(r.totalAmt || 0),
      remarks: r.remarks || '', docs: r.docs !== undefined ? r.docs : json_(cur.docs, []), updatedAt: now_() });
    return getBootstrap();
  });
}
function apiAddIssue(itemId, r) {
  return lock_(function () {
    var q = Number(r.qty);
    if (!(q > 0)) throw new Error('Quantity must be greater than zero');
    if (!r.purpose) throw new Error('Purpose is required');
    var recd = 0, issd = 0;
    tbl_('RECEIPTS').rows.forEach(function (x) { if (x.itemId === itemId) recd += Number(x.qty || 0); });
    tbl_('ISSUES').rows.forEach(function (x) { if (x.itemId === itemId) issd += Number(x.qty || 0); });
    if (q > recd - issd) throw new Error('Only ' + (recd - issd) + ' available in stock');
    insert_('ISSUES', { id: uid_('iss'), itemId: itemId, moveType: r.moveType || 'Utilised', date: r.date, qty: q,
      purpose: r.purpose, issuedTo: r.issuedTo || '', location: r.location || '', authorisedBy: r.authorisedBy || '',
      workDetails: r.workDetails || '', remarks: r.remarks || '', docs: r.docs || [], createdAt: now_(), updatedAt: now_() });
    return getBootstrap();
  });
}
function apiUpdateIssue(id, r) {
  return lock_(function () {
    var cur = find_('ISSUES', id);
    if (!cur) throw new Error('Record not found');
    var q = Number(r.qty);
    if (!(q > 0)) throw new Error('Quantity must be greater than zero');
    if (!r.purpose) throw new Error('Purpose is required');
    var recd = 0, issd = 0;
    tbl_('RECEIPTS').rows.forEach(function (x) { if (x.itemId === cur.itemId) recd += Number(x.qty || 0); });
    tbl_('ISSUES').rows.forEach(function (x) { if (x.itemId === cur.itemId) issd += (x.id === id ? q : Number(x.qty || 0)); });
    if (issd > recd) throw new Error('Only ' + recd + ' received in total — cannot issue ' + issd);
    updateRow_('ISSUES', id, { moveType: r.moveType || cur.moveType || 'Utilised', date: r.date, qty: q, purpose: r.purpose,
      issuedTo: r.issuedTo || '', location: r.location || '', authorisedBy: r.authorisedBy || '', workDetails: r.workDetails || '',
      remarks: r.remarks || '', docs: r.docs !== undefined ? r.docs : json_(cur.docs, []), updatedAt: now_() });
    return getBootstrap();
  });
}
function apiDeleteRecord(kind, id) {
  return lock_(function () {
    var name = kind === 'receipts' ? 'RECEIPTS' : 'ISSUES';
    var cur = find_(name, id);
    if (!cur) throw new Error('Record not found');
    if (kind === 'receipts') {
      var recd = 0, issd = 0;
      tbl_('RECEIPTS').rows.forEach(function (x) { if (x.itemId === cur.itemId && x.id !== id) recd += Number(x.qty || 0); });
      tbl_('ISSUES').rows.forEach(function (x) { if (x.itemId === cur.itemId) issd += Number(x.qty || 0); });
      if (recd - issd < 0) throw new Error('Cannot delete: ' + issd + ' already issued from this material');
    }
    deleteRow_(name, id);
    return getBootstrap();
  });
}

/* ======================================================================== *
 *  CATEGORIES & FIELDS
 * ======================================================================== */

function apiSaveCategory(p) {
  return lock_(function () {
    if (!p || !p.name) throw new Error('Category name is required');
    if (p.id) updateRow_('CATEGORIES', p.id, { name: p.name, desc: p.desc || '' });
    else insert_('CATEGORIES', { id: uid_('cat'), kind: p.kind || 'material', name: p.name, desc: p.desc || '', fields: [] });
    return getBootstrap();
  });
}
function apiDeleteCategory(id) {
  return lock_(function () {
    var usedItems = tbl_('ITEMS').rows.filter(function (i) { return i.categoryId === id; }).length;
    var usedKits = tbl_('KITS').rows.filter(function (k) { return k.categoryId === id; }).length;
    if (usedItems || usedKits) throw new Error('Category is used by ' + (usedItems + usedKits) + ' record(s) — move or delete them first');
    deleteRow_('CATEGORIES', id);
    return getBootstrap();
  });
}
function fields_(catId) {
  var c = find_('CATEGORIES', catId);
  if (!c) throw new Error('Category not found');
  return { c: c, fields: json_(c.fields, []) };
}
function apiSaveField(catId, field) {
  return lock_(function () {
    var f = fields_(catId);
    if (!field || !field.key) throw new Error('Field key missing');
    if (f.fields.some(function (x) { return x.key === field.key; })) throw new Error('A field with that name already exists');
    f.fields.push(field);
    updateRow_('CATEGORIES', catId, { fields: f.fields });
    return getBootstrap();
  });
}
function apiUpdateField(catId, key, patch) {
  return lock_(function () {
    var f = fields_(catId), hit = null;
    f.fields.forEach(function (x) { if (x.key === key) hit = x; });
    if (!hit) throw new Error('Field not found');
    ['label', 'type', 'required', 'hint', 'options'].forEach(function (k) { if (patch[k] !== undefined) hit[k] = patch[k]; });
    if (hit.type !== 'select') delete hit.options;
    updateRow_('CATEGORIES', catId, { fields: f.fields });
    return getBootstrap();
  });
}
function apiDeleteField(catId, key) {
  return lock_(function () {
    var f = fields_(catId);
    updateRow_('CATEGORIES', catId, { fields: f.fields.filter(function (x) { return x.key !== key; }) });
    return getBootstrap();
  });
}
function apiMoveField(catId, key, dir) {
  return lock_(function () {
    var f = fields_(catId), i = -1;
    f.fields.forEach(function (x, n) { if (x.key === key) i = n; });
    if (i < 0) throw new Error('Field not found');
    var j = i + (dir === 'up' ? -1 : 1);
    if (j >= 0 && j < f.fields.length) { var t = f.fields[i]; f.fields[i] = f.fields[j]; f.fields[j] = t; }
    updateRow_('CATEGORIES', catId, { fields: f.fields });
    return getBootstrap();
  });
}
function apiAddFieldOption(catId, key, option) {
  return lock_(function () {
    option = String(option || '').trim();
    if (!option) throw new Error('Empty option');
    var f = fields_(catId), hit = null;
    f.fields.forEach(function (x) { if (x.key === key) hit = x; });
    if (!hit) throw new Error('Field not found');
    hit.options = hit.options || [];
    if (hit.options.indexOf(option) < 0) hit.options.push(option);
    updateRow_('CATEGORIES', catId, { fields: f.fields });
    return getBootstrap();
  });
}
function apiDelFieldOption(catId, key, option) {
  return lock_(function () {
    var f = fields_(catId), hit = null;
    f.fields.forEach(function (x) { if (x.key === key) hit = x; });
    if (!hit) throw new Error('Field not found');
    hit.options = (hit.options || []).filter(function (o) { return o !== option; });
    updateRow_('CATEGORIES', catId, { fields: f.fields });
    return getBootstrap();
  });
}
function apiAddUom(u) { return apiAddListSetting('uoms', u); }
/** Generic "learn a new option into a settings list" — used for UoM, ownership, statuses, reasons. */
function apiAddListSetting(key, val) {
  return lock_(function () {
    val = String(val || '').trim();
    if (!val) throw new Error('Empty value');
    var t = tbl_('SETTINGS'), hit = null;
    t.rows.forEach(function (r) { if (r.key === key) hit = r; });
    var fb = { uoms: DEFAULT_UOMS, kitOwnerships: DEFAULT_OWNERSHIPS, kitStatuses: DEFAULT_KIT_STATUSES, kitMoveReasons: DEFAULT_MOVE_REASONS }[key] || [];
    var list = hit ? json_(hit.value, fb) : fb.slice();
    if (list.indexOf(val) < 0) list.push(val);
    setSettingRaw_(key, JSON.stringify(list));
    return getBootstrap();
  });
}
function setSettingRaw_(key, value) {
  var t = tbl_('SETTINGS'), hit = null;
  t.rows.forEach(function (r) { if (r.key === key) hit = r; });
  if (hit) t.sh.getRange(hit.__row, t.hm.map['value']).setValue(value);
  else t.sh.appendRow((function () { var row = new Array(t.hm.header.length).fill(''); row[t.hm.map['key'] - 1] = key; row[t.hm.map['value'] - 1] = value; return row; })());
}

/* ======================================================================== *
 *  DOCUMENTS
 * ======================================================================== */

function driveThumb_(file) {
  try {
    var t = file.getThumbnail();
    if (!t) return '';
    var b64 = Utilities.base64Encode(t.getBytes());
    if (b64.length > 45000) return '';
    return 'data:' + t.getContentType() + ';base64,' + b64;
  } catch (e) { return ''; }
}
function apiUploadDoc(p) {
  return lock_(function () {
    var blob = Utilities.newBlob(Utilities.base64Decode(p.full), p.mime || 'image/jpeg', p.name || ('doc_' + Date.now() + '.jpg'));
    var file = getFolder_().createFile(blob);
    var id = uid_('doc');
    var thumb = p.thumb ? ('data:image/jpeg;base64,' + p.thumb) : driveThumb_(file);
    insert_('DOCS', { id: id, title: p.title || p.name || 'Document', fileId: file.getId(), thumb: thumb, createdAt: now_() });
    if (p.link && p.link.kind && p.link.id) apiLinkDocs_(p.link.kind, p.link.id, [id]);
    return getBootstrap();
  });
}
function apiGetDocFull(docId) {
  var d = find_('DOCS', docId);
  if (!d) throw new Error('Document not found');
  var b = DriveApp.getFileById(d.fileId).getBlob();
  return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
}
function apiRenameDoc(id, title) {
  return lock_(function () {
    if (!title) throw new Error('Title required');
    updateRow_('DOCS', id, { title: title });
    return getBootstrap();
  });
}
function sheetFor_(kind) {
  return { item: 'ITEMS', receipt: 'RECEIPTS', issue: 'ISSUES', kit: 'KITS', kitmove: 'KIT_MOVES', kitrepair: 'KIT_REPAIRS' }[kind];
}
function apiLinkDocs_(kind, recordId, docIds) {
  var name = sheetFor_(kind);
  var cur = find_(name, recordId);
  if (!cur) throw new Error('Record not found');
  var list = json_(cur.docs, []);
  docIds.forEach(function (d) { if (list.indexOf(d) < 0) list.push(d); });
  updateRow_(name, recordId, { docs: list });
}
function apiLinkDocs(kind, recordId, docIds) { return lock_(function () { apiLinkDocs_(kind, recordId, docIds); return getBootstrap(); }); }
function apiUnlinkDoc(kind, recordId, docId) {
  return lock_(function () {
    var name = sheetFor_(kind), cur = find_(name, recordId);
    if (!cur) throw new Error('Record not found');
    updateRow_(name, recordId, { docs: json_(cur.docs, []).filter(function (x) { return x !== docId; }) });
    return getBootstrap();
  });
}
function apiDeleteDoc(docId) {
  return lock_(function () {
    var d = find_('DOCS', docId);
    if (d) { try { DriveApp.getFileById(d.fileId).setTrashed(true); } catch (e) {} deleteRow_('DOCS', docId); }
    ['ITEMS', 'RECEIPTS', 'ISSUES', 'KITS', 'KIT_MOVES', 'KIT_REPAIRS'].forEach(function (n) {
      tbl_(n).rows.forEach(function (r) {
        var cur = json_(r.docs, []);
        if (cur.indexOf(docId) >= 0) updateRow_(n, r.id, { docs: cur.filter(function (x) { return x !== docId; }) });
      });
    });
    return getBootstrap();
  });
}
function apiSyncFolder() {
  return lock_(function () {
    var known = {};
    tbl_('DOCS').rows.forEach(function (r) { known[r.fileId] = true; });
    var it = getFolder_().getFiles(), added = 0;
    while (it.hasNext()) {
      var f = it.next();
      if (known[f.getId()]) continue;
      var mt = f.getMimeType();
      if (mt.indexOf('image/') !== 0 && mt !== 'application/pdf') continue;
      insert_('DOCS', { id: uid_('doc'), title: prettyName_(f.getName()), fileId: f.getId(), thumb: driveThumb_(f), createdAt: now_() });
      added++;
    }
    return getBootstrap();
  });
}
function prettyName_(n) { return String(n).replace(/\.[a-z0-9]+$/i, '').replace(/^\d+[_\-\s]*/, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function norm_(s) { return String(s || '').toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]/g, ''); }

/* ======================================================================== *
 *  DOCUMENT INDEXING — tolerant name matching + always-run folder sync,
 *  so a rename/HEIC-conversion/case-change in Drive can never "lose" a file.
 * ======================================================================== */

var SEED_DOCS = [
  { file: '01_LA_stack_40A_nameplate.jpg', title: 'Surge Arrester nameplate — Stack 40 A (LAMCO)', items: ['itm_la390'] },
  { file: '02_LA_stack_40B_nameplate.jpg', title: 'Surge Arrester nameplate — Stack 40 B (LAMCO)', items: ['itm_la390'] },
  { file: '03_LA_stack_40C_nameplate.jpg', title: 'Surge Arrester nameplate — Stack 40 C (LAMCO)', items: ['itm_la390'] },
  { file: '04_LA_stack_40D_nameplate.jpg', title: 'Surge Arrester nameplate — Stack 40 D (LAMCO)', items: ['itm_la390'] },
  { file: '05_CT_serial_24_nameplate.jpg', title: 'CT nameplate — S/N OC 11183/2/24/21 (MEHRU)', items: ['itm_ct245'] },
  { file: '06_CT_serial_23_nameplate.jpg', title: 'CT nameplate — S/N OC 11183/2/23/21 (MEHRU)', items: ['itm_ct245'] },
  { file: '07_gate_pass.jpg', title: 'Gate Pass No. 651/1431 dtd. 06.07.2026 — Major Store, Dhule', items: ['itm_ct245', 'itm_la390', 'itm_sf6'] },
  { file: '08_allotment_work_order.jpg', title: 'Allotment list / Work Order SE/1232 dtd. 18.06.2026', items: ['itm_ct245', 'itm_la390', 'itm_sf6'] },
  { file: '09_site_ct_inspection.jpg', title: 'Site photograph — CT inspection at 400 kV Karjat', items: ['itm_ct245'] },
  { file: '10_site_ct_installation.jpg', title: 'Site photograph — CT handling / erection at 400 kV Karjat', items: ['itm_ct245'] },
  { file: '11_ctr_invoice.jpg', title: 'CTR Tax Invoice 2GSSIA1434 dtd. 13.07.2026 — NIFPS spares', items: ['itm_n2cyl', 'itm_reg', 'itm_hose', 'itm_valve'] },
  { file: '12_ctr_delivery_challan.jpg', title: 'Delivery Challan / LR B4002899760 dtd. 13.07.2026 — Assoc. Road Carriers', items: ['itm_n2cyl', 'itm_reg', 'itm_hose', 'itm_valve'] },
  { file: '13_nifps_requirement_email.jpg', title: 'Requirement of NIFPS material for emergencies — email dtd. 10.07.2026', items: ['itm_n2cyl', 'itm_reg', 'itm_hose', 'itm_valve'] }
];

/** STEP 2 (fresh install) — tolerant match against files already in the folder,
 *  then ALWAYS runs a full folder sync so nothing is ever left unregistered. */
function indexDocuments() {
  var folder = getFolder_(), log = [];
  var all = []; var it = folder.getFiles();
  while (it.hasNext()) all.push(it.next());

  var byTitle = {}, byFile = {};
  tbl_('DOCS').rows.forEach(function (r) { byTitle[r.title] = r.id; byFile[r.fileId] = r.id; });

  SEED_DOCS.forEach(function (d) {
    try {
      if (byTitle[d.title]) { log.push('· already indexed: ' + d.file); return; }
      var target = norm_(d.file);
      var match = null;
      for (var i = 0; i < all.length; i++) {
        if (norm_(all[i].getName()) === target) { match = all[i]; break; }
      }
      if (!match) { // fuzzy: same normalised prefix (first 10 chars)
        for (var j = 0; j < all.length; j++) {
          if (norm_(all[j].getName()).indexOf(target.slice(0, 10)) === 0) { match = all[j]; break; }
        }
      }
      if (!match) { log.push('✗ not found by name (will pick up via folder sync instead): ' + d.file); return; }
      var id = byFile[match.getId()] || uid_('doc');
      if (!byFile[match.getId()]) insert_('DOCS', { id: id, title: d.title, fileId: match.getId(), thumb: driveThumb_(match), createdAt: now_() });
      d.items.forEach(function (itemId) {
        if (!find_('ITEMS', itemId)) return;
        apiLinkDocs_('item', itemId, [id]);
        var first = null;
        tbl_('RECEIPTS').rows.forEach(function (r) { if (r.itemId === itemId && !first) first = r; });
        if (first) apiLinkDocs_('receipt', first.id, [id]);
      });
      log.push('✓ ' + match.getName() + '  →  ' + d.title);
    } catch (err) { log.push('✗ ' + d.file + ' — ' + err.message); }
  });

  var before = tbl_('DOCS').rows.length;
  var boot = apiSyncFolder();
  var added = boot.docs.length - before;
  log.push('');
  log.push('Folder sync: ' + added + ' additional file(s) registered with an auto-generated title.');
  log.push('Total documents now registered: ' + boot.docs.length);
  log.push('Anything not auto-linked can be renamed/linked from the Documents page in the portal (Admin).');
  Logger.log(log.join('\n'));
  return log.join('\n');
}

/* ======================================================================== *
 *  TEST KITS
 * ======================================================================== */

function apiAddKit(p) {
  return lock_(function () {
    if (!p || !p.name) throw new Error('Kit name is required');
    if (!p.categoryId) throw new Error('Category is required');
    insert_('KITS', { id: uid_('kit'), categoryId: p.categoryId, name: p.name, ownership: p.ownership || '',
      ownerDetail: p.ownerDetail || '', status: p.status || 'Healthy', location: p.location || '',
      fields: p.fields || {}, remarks: p.remarks || '', docs: p.docs || [], createdAt: now_(), updatedAt: now_() });
    return getBootstrap();
  });
}
function apiUpdateKit(id, p) {
  return lock_(function () {
    var cur = find_('KITS', id);
    if (!cur) throw new Error('Kit not found');
    updateRow_('KITS', id, {
      name: p.name !== undefined ? p.name : cur.name, categoryId: p.categoryId !== undefined ? p.categoryId : cur.categoryId,
      ownership: p.ownership !== undefined ? p.ownership : cur.ownership, ownerDetail: p.ownerDetail !== undefined ? p.ownerDetail : cur.ownerDetail,
      status: p.status !== undefined ? p.status : cur.status, location: p.location !== undefined ? p.location : cur.location,
      fields: p.fields !== undefined ? p.fields : json_(cur.fields, {}), remarks: p.remarks !== undefined ? p.remarks : cur.remarks,
      docs: p.docs !== undefined ? p.docs : json_(cur.docs, []), updatedAt: now_()
    });
    return getBootstrap();
  });
}
function apiDeleteKit(id) {
  return lock_(function () {
    tbl_('KIT_MOVES').rows.forEach(function (r) { if (r.kitId === id) deleteRow_('KIT_MOVES', r.id); });
    tbl_('KIT_REPAIRS').rows.forEach(function (r) { if (r.kitId === id) deleteRow_('KIT_REPAIRS', r.id); });
    deleteRow_('KITS', id);
    return getBootstrap();
  });
}
function apiAddKitMove(kitId, p) {
  return lock_(function () {
    if (!p.direction) throw new Error('Direction (OUT/IN) is required');
    if (!p.date) throw new Error('Date is required');
    insert_('KIT_MOVES', { id: uid_('mov'), kitId: kitId, direction: p.direction, date: p.date, party: p.party || '',
      reason: p.reason || '', refType: p.refType || '', refNo: p.refNo || '', expectedReturn: p.expectedReturn || '',
      actualReturn: p.actualReturn || '', remarks: p.remarks || '', docs: p.docs || [], createdAt: now_(), updatedAt: now_() });
    return getBootstrap();
  });
}
function apiUpdateKitMove(id, p) {
  return lock_(function () {
    var cur = find_('KIT_MOVES', id);
    if (!cur) throw new Error('Record not found');
    updateRow_('KIT_MOVES', id, { direction: p.direction || cur.direction, date: p.date || cur.date, party: p.party || '',
      reason: p.reason || '', refType: p.refType || '', refNo: p.refNo || '', expectedReturn: p.expectedReturn || '',
      actualReturn: p.actualReturn || '', remarks: p.remarks || '', docs: p.docs !== undefined ? p.docs : json_(cur.docs, []), updatedAt: now_() });
    return getBootstrap();
  });
}
function apiAddKitRepair(kitId, p) {
  return lock_(function () {
    if (!p.dateSent) throw new Error('Date sent is required');
    insert_('KIT_REPAIRS', { id: uid_('rep'), kitId: kitId, dateSent: p.dateSent, sentTo: p.sentTo || '', reason: p.reason || '',
      expenseBefore: Number(p.expenseBefore || 0), status: p.status || 'Sent', dateReceived: p.dateReceived || '',
      actualExpense: Number(p.actualExpense || 0), issues: p.issues || [], remarks: p.remarks || '', docs: p.docs || [],
      createdAt: now_(), updatedAt: now_() });
    return getBootstrap();
  });
}
function apiUpdateKitRepair(id, p) {
  return lock_(function () {
    var cur = find_('KIT_REPAIRS', id);
    if (!cur) throw new Error('Record not found');
    updateRow_('KIT_REPAIRS', id, { dateSent: p.dateSent || cur.dateSent, sentTo: p.sentTo || '', reason: p.reason || '',
      expenseBefore: Number(p.expenseBefore || 0), status: p.status || cur.status, dateReceived: p.dateReceived || '',
      actualExpense: Number(p.actualExpense || 0), issues: p.issues !== undefined ? p.issues : json_(cur.issues, []),
      remarks: p.remarks || '', docs: p.docs !== undefined ? p.docs : json_(cur.docs, []), updatedAt: now_() });
    return getBootstrap();
  });
}
function apiDeleteKitEntry(kind, id) {
  return lock_(function () {
    deleteRow_(kind === 'move' ? 'KIT_MOVES' : 'KIT_REPAIRS', id);
    return getBootstrap();
  });
}

/* ======================================================================== *
 *  SETUP / MIGRATE
 * ======================================================================== */

function setupDatabase() {
  var old = props_().getProperty(CFG.P_SS);
  if (old) { try { SpreadsheetApp.openById(old); throw new Error('Database already exists — run migrate() instead.'); } catch (e) { if (String(e.message).indexOf('already exists') > -1) throw e; } }
  var ss = SpreadsheetApp.create(CFG.SS_NAME);
  props_().setProperty(CFG.P_SS, ss.getId());
  var def = ss.getSheetByName('Sheet1');
  Object.keys(SHEETS).forEach(function (name) { ensureSheet_(name); });
  if (def) ss.deleteSheet(def);
  seedMaterials_();
  seedKits_();
  ensureAdmin_();
  var msg = 'Database created.\nSheet  : ' + ss.getUrl() + '\nFolder : https://drive.google.com/drive/folders/' + DOCS_FOLDER_ID
          + '\n\nNext: run indexDocuments(), then deploy as a Web app.\nLogin: admin / admin123 (change this after first login).';
  Logger.log(msg);
  return msg;
}

/** Safe to re-run any time. Creates any new sheets/columns and the admin login
 *  if missing, without touching existing data. */
function migrate() {
  Object.keys(SHEETS).forEach(function (name) { tbl_(name); }); // ensureSheet_ + ensureCols_ for every table
  var madeAdmin = ensureAdmin_();
  var out = 'Migration complete.\nSheets present: ' + Object.keys(SHEETS).join(', ')
    + '\nAdmin login: ' + (madeAdmin ? 'created (admin / admin123 — please change it)' : 'already existed, left untouched');
  Logger.log(out);
  return out;
}
function ensureAdmin_() {
  var u = tbl_('USERS');
  var has = u.rows.some(function (r) { return String(r.username).toLowerCase() === 'admin'; });
  if (has) return false;
  var salt = Utilities.getUuid();
  insert_('USERS', { id: uid_('usr'), username: 'admin', fullName: 'Administrator', passHash: hash_('admin123', salt),
    salt: salt, role: 'admin', status: 'approved', createdAt: now_(), updatedAt: now_() });
  return true;
}
function openDatabase() { var u = getSS_().getUrl(); Logger.log(u); return u; }
function rebuildEverything() { props_().deleteProperty(CFG.P_SS); return setupDatabase(); }

function healthCheck() {
  var out = ['Backend version: ' + BACKEND_VERSION,
             'API functions available: ' + Object.keys(API).length + ' (login present: ' + (!!API.login) + ')'];
  try {
    var ss = getSS_(); out.push('Sheet  OK : ' + ss.getUrl());
    Object.keys(SHEETS).forEach(function (n) { out.push('   ' + n + ': ' + Math.max(0, ensureSheet_(n).getLastRow() - 1) + ' row(s)'); });
  } catch (e) { out.push('Sheet  FAIL: ' + e.message); }
  try {
    var f = getFolder_(); var n = 0, it = f.getFiles(); while (it.hasNext()) { it.next(); n++; }
    out.push('Folder OK : ' + f.getName() + ' (' + n + ' file(s))');
  } catch (e) { out.push('Folder FAIL: ' + e.message); }
  try {
    var b = getBootstrap();
    out.push('API    OK : ' + b.items.length + ' items · ' + b.kits.length + ' kits · ' + b.categories.length + ' categories · ' + b.docs.length + ' docs');
    var admin = tbl_('USERS').rows.filter(function (r) { return r.role === 'admin' && r.status === 'approved'; });
    out.push('Admin login present: ' + (admin.length > 0));
  } catch (e) { out.push('API    FAIL: ' + e.message); }
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/* ======================================================================== *
 *  SEED DATA
 * ======================================================================== */

function seedMaterials_() {
  if (tbl_('CATEGORIES').rows.length) return; // don't reseed over existing data
  [
    { id: 'cat_ehv', kind: 'material', name: 'EHV Equipment', desc: 'Circuit breakers, CTs, CVTs, PTs, isolators, isolator blades, discharge rods and other EHV switchyard equipment.',
      fields: [
        { key: 'equipType', label: 'Equipment Type', type: 'select', required: true, hint: '', options: ['Circuit Breaker', 'Current Transformer', 'CVT', 'Potential Transformer', 'Surge Arrester', 'Isolator', 'Isolator Blade', 'Discharge Rod', 'Wave Trap'] },
        { key: 'voltageClass', label: 'Voltage Class', type: 'select', required: true, hint: '', options: ['11 kV', '33 kV', '132 kV', '198 kV', '220 kV', '245 kV', '390 kV', '400 kV', '420 kV', '765 kV'] },
        { key: 'make', label: 'Make / Manufacturer', type: 'text', required: true, hint: 'e.g. MEHRU, LAMCO, CGL' },
        { key: 'typeModel', label: 'Type / Model', type: 'text', hint: '' },
        { key: 'ratingRatio', label: 'Rating / Ratio', type: 'text', hint: 'e.g. 800-1600/1A, 5C, 40 kA for 1 sec' },
        { key: 'serialNos', label: 'Serial No(s).', type: 'textarea', hint: 'One per line if more than one unit' },
        { key: 'yearMfg', label: 'Year of Manufacture', type: 'number', hint: '' },
        { key: 'standard', label: 'Standard', type: 'text', hint: 'e.g. IS 16227' },
        { key: 'drawingNo', label: 'Drawing No.', type: 'text', hint: '' },
        { key: 'poLoa', label: 'P.O. / LOA No.', type: 'text', hint: '' },
        { key: 'weight', label: 'Weight', type: 'text', hint: '' },
        { key: 'oilQty', label: 'Oil Quantity', type: 'text', hint: '' }
      ] },
    { id: 'cat_cable', kind: 'material', name: 'Cables', desc: 'Power and control cables of various sizes, cores and constructions.',
      fields: [
        { key: 'sizeSqmm', label: 'Size (sq.mm)', type: 'text', required: true, hint: 'e.g. 2.5, 6, 95, 240' },
        { key: 'cores', label: 'No. of Cores', type: 'select', required: true, options: ['1C', '2C', '3C', '3.5C', '4C', '7C', '10C', '12C', '19C', '24C', '37C'] },
        { key: 'construction', label: 'Construction', type: 'select', required: true, options: ['Armoured', 'Unarmoured', 'Flexible'] },
        { key: 'conductor', label: 'Conductor', type: 'select', options: ['Copper', 'Aluminium'] },
        { key: 'insulation', label: 'Insulation', type: 'select', options: ['XLPE', 'PVC', 'EPR', 'Rubber'] },
        { key: 'voltageGrade', label: 'Voltage Grade', type: 'text', hint: 'e.g. 1.1 kV, 11 kV(E)' },
        { key: 'make', label: 'Make', type: 'text', hint: '' },
        { key: 'drumNo', label: 'Drum / Coil No.', type: 'text', hint: '' }
      ] },
    { id: 'cat_hw', kind: 'material', name: 'Hardware for EHV Equipment', desc: 'Jumpers, palms, jaws, clamps, connectors and associated switchyard hardware.',
      fields: [
        { key: 'subType', label: 'Hardware Type', type: 'select', required: true, options: ['Jumper', 'Palm / Terminal Connector', 'Jaw Contact', 'Clamp', 'Spacer', 'Conductor Fitting', 'Insulator String Fitting', 'Earthing Material'] },
        { key: 'appliesTo', label: 'Applicable Equipment', type: 'text', hint: 'e.g. 245 kV CT, 400 kV Isolator' },
        { key: 'sizeSpec', label: 'Size / Specification', type: 'text', hint: '' },
        { key: 'material', label: 'Material', type: 'select', options: ['Aluminium', 'Copper', 'Bimetallic', 'Galvanised Steel', 'Stainless Steel'] },
        { key: 'make', label: 'Make', type: 'text', hint: '' }
      ] },
    { id: 'cat_gas', kind: 'material', name: 'Gases & Consumables', desc: 'SF6, nitrogen, transformer oil and other consumables held as emergency spares.',
      fields: [
        { key: 'gasType', label: 'Gas / Consumable', type: 'select', required: true, options: ['SF6 Gas', 'Nitrogen', 'Transformer Oil', 'Compressed Air'] },
        { key: 'cylCapacity', label: 'Cylinder Capacity / Pack Size', type: 'text', required: true, hint: 'e.g. 25 kg, 68 litre' },
        { key: 'standard', label: 'Standard', type: 'text', hint: 'e.g. IS 7285' },
        { key: 'cylinderNo', label: 'Cylinder / Batch No.', type: 'text', hint: '' },
        { key: 'testDue', label: 'Next Hydro Test Due', type: 'date', hint: '' },
        { key: 'make', label: 'Make / Supplier', type: 'text', hint: '' }
      ] },
    { id: 'cat_nifps', kind: 'material', name: 'NIFPS / Fire Protection', desc: 'Nitrogen Injection Fire Protection System spares held for AMC emergencies (CTR system).',
      fields: [
        { key: 'subSystem', label: 'Sub-system', type: 'select', required: true, options: ['Nitrogen Injection', 'Regulator', 'Piping / Hose', 'Valve', 'Control Panel', 'Fire Detection'] },
        { key: 'make', label: 'Make', type: 'text', required: true, hint: '' },
        { key: 'partNo', label: 'Part No. / Model', type: 'text', hint: '' },
        { key: 'hsnCode', label: 'HSN Code', type: 'text', hint: 'e.g. 85049010' },
        { key: 'specification', label: 'Specification', type: 'textarea', hint: '' },
        { key: 'compatibleWith', label: 'Compatible With', type: 'text', hint: 'e.g. CTR NIFPS at 400 kV Karjat' }
      ] }
  ].forEach(function (c) { insert_('CATEGORIES', c); });

  insert_('SETTINGS', { key: 'siteName', value: '400 kV Karjat Substation' });
  insert_('SETTINGS', { key: 'division', value: '400 kV RS Division, Karjat' });
  insert_('SETTINGS', { key: 'uoms', value: JSON.stringify(DEFAULT_UOMS) });
  insert_('SETTINGS', { key: 'kitOwnerships', value: JSON.stringify(DEFAULT_OWNERSHIPS) });
  insert_('SETTINGS', { key: 'kitStatuses', value: JSON.stringify(DEFAULT_KIT_STATUSES) });
  insert_('SETTINGS', { key: 'kitMoveReasons', value: JSON.stringify(DEFAULT_MOVE_REASONS) });

  var GP = { source: 'Major Store, Dhule (MSETCL)', refType: 'Gate Pass', refNo: '651/1431 dtd. 06.07.2026', invoiceNo: '', vehicle: 'MH-18 AA 7727 (Vaishali Transport)', receivedBy: 'Shri P. T. Mali' };
  var CTR = { source: 'CTR Manufacturing Industries Pvt. Ltd., Nagar Road, Pune - 411014', refType: 'Invoice & Delivery Challan',
              refNo: 'LR B4002899760 dtd. 13.07.2026 (Associated Road Carriers Ltd.)', invoiceNo: '2GSSIA1434 dtd. 13.07.2026',
              vehicle: 'Door delivery — ARC, ex-Wagholi (WGLB)', receivedBy: '' };
  function add_(item, rc) {
    insert_('ITEMS', { id: item.id, categoryId: item.categoryId, name: item.name, unit: item.unit, location: item.location,
      trackLow: item.trackLow, lowCutoff: item.lowCutoff, docMode: 'consignment', fields: item.fields, remarks: item.remarks,
      docs: [], createdAt: item.createdAt, updatedAt: item.createdAt });
    insert_('RECEIPTS', { id: uid_('rcp'), itemId: item.id, date: rc.date, qty: rc.qty, source: rc.base.source, refType: rc.base.refType,
      refNo: rc.base.refNo, invoiceNo: rc.base.invoiceNo, vehicle: rc.base.vehicle, receivedBy: rc.base.receivedBy,
      unitRate: rc.unitRate || 0, taxableAmt: rc.taxableAmt || 0, gstPct: rc.gstPct || 0, totalAmt: rc.totalAmt || 0,
      remarks: rc.remarks || '', docs: [], createdAt: now_(), updatedAt: now_() });
  }
  add_({ id: 'itm_ct245', categoryId: 'cat_ehv', name: '245 kV Current Transformer (MEHRU)', unit: 'Nos.', location: 'Store Yard, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { equipType: 'Current Transformer', voltageClass: '245 kV', make: 'MEHRU Electrical & Mechanical Engineers (P) Ltd.', typeModel: 'CT with S.S. Bellow (suitable for hot line washing)',
      ratingRatio: '800-1600/1A, 5C, 40 kA for 1 sec', serialNos: 'OC 11183/2/23/21\nOC 11183/2/24/21', yearMfg: 2021, standard: 'IS 16227',
      drawingNo: 'ME-220CT-GA-11183-02', poLoa: 'SP/T-0604/0520/00265 dtd. 22.04.2021', weight: '825 kg (approx.)', oilQty: '215 litres (approx.)' },
    remarks: 'Critical emergency spare. 5 cores: Core-3 metering 0.2S/15 VA, remaining PS class.', createdAt: '2026-07-06T10:00:00.000Z' },
    { base: GP, date: '2026-07-06', qty: 2, remarks: 'Allotted 2 Nos. against Work Order SE/1232 dtd. 18.06.2026 — fully received.' });
  add_({ id: 'itm_la390', categoryId: 'cat_ehv', name: '390 kV, 20 kA MO Gapless Surge Arrester (LAMCO)', unit: 'Set', location: 'Store Room, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { equipType: 'Surge Arrester', voltageClass: '390 kV', make: 'LAMCO Industries Pvt. Ltd.', typeModel: 'MORESTER Gapless Surge Arrester — Type LMAS',
      ratingRatio: '97.5 kV, 20 kA, CL-4 per stack × 4 stacks = 390 kV; MCOV 75.75 kV/stack', serialNos: '40 A\n40 B\n40 C\n40 D', yearMfg: 2025,
      poLoa: 'SP/L-14/T-0622/0724/LAMCO/NO.00714 dtd. 23.05.2025' },
    remarks: '1 Set = 4 series stacks with all accessories. Allotted 3 Nos.; only 1 lifted — balance 2 Nos. available at 400 kV BSL-2 Dn.', createdAt: '2026-07-06T10:00:00.000Z' },
    { base: GP, date: '2026-07-06', qty: 1, remarks: 'Allotted 3 Nos.; 1 Set received.' });
  add_({ id: 'itm_sf6', categoryId: 'cat_gas', name: 'SF6 Gas Cylinder — 25 kg (Duly Filled)', unit: 'Nos.', location: 'Gas Cylinder Bay, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { gasType: 'SF6 Gas', cylCapacity: '25 kg' }, remarks: 'Duly filled cylinders held as emergency spare.', createdAt: '2026-07-06T10:00:00.000Z' },
    { base: GP, date: '2026-07-06', qty: 2, remarks: 'Allotted 2 Nos. — fully received.' });
  add_({ id: 'itm_n2cyl', categoryId: 'cat_nifps', name: 'Nitrogen Cylinder — 68 Litre (NIFPS)', unit: 'Nos.', location: 'NIFPS Panel Area, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { subSystem: 'Nitrogen Injection', make: 'CTR Manufacturing Industries Pvt. Ltd., Pune', hsnCode: '85049010', specification: 'Nitrogen Cylinder, 68 litre water capacity, as per IS 7285', compatibleWith: 'CTR NIFPS system, 400 kV Karjat SS' },
    remarks: 'Procured against AMC emergency requirement (requirement raised 10.07.2026).', createdAt: '2026-07-13T10:00:00.000Z' },
    { base: CTR, date: '2026-07-13', qty: 1, unitRate: 37950, taxableAmt: 37950, gstPct: 18, totalAmt: 44781, remarks: 'Consignment: 2 packages, 100 kg actual / 120 kg charged.' });
  add_({ id: 'itm_reg', categoryId: 'cat_nifps', name: 'Regulator Sub-Assembly (NIFPS)', unit: 'Nos.', location: 'NIFPS Panel Area, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { subSystem: 'Regulator', make: 'CTR Manufacturing Industries Pvt. Ltd., Pune', hsnCode: '85049010', specification: 'Regulator Sub-Assembly for NIFPS nitrogen injection circuit', compatibleWith: 'CTR NIFPS system, 400 kV Karjat SS' },
    remarks: 'Procured against AMC emergency requirement.', createdAt: '2026-07-13T10:00:00.000Z' },
    { base: CTR, date: '2026-07-13', qty: 1, unitRate: 21275, taxableAmt: 21275, gstPct: 18, totalAmt: 25104.5, remarks: '' });
  add_({ id: 'itm_hose', categoryId: 'cat_nifps', name: 'Hose Pipe 1/4" (NIFPS)', unit: 'Nos.', location: 'NIFPS Panel Area, 400 kV Karjat SS', trackLow: true, lowCutoff: 2,
    fields: { subSystem: 'Piping / Hose', make: 'CTR Manufacturing Industries Pvt. Ltd., Pune', hsnCode: '85049010', specification: 'Hose Pipe, 1/4 inch, for NIFPS nitrogen injection circuit', compatibleWith: 'CTR NIFPS system, 400 kV Karjat SS' },
    remarks: 'Unit rate ₹2,415 each × 2 Nos.', createdAt: '2026-07-13T10:00:00.000Z' },
    { base: CTR, date: '2026-07-13', qty: 2, unitRate: 2415, taxableAmt: 4830, gstPct: 18, totalAmt: 5699.4, remarks: '' });
  add_({ id: 'itm_valve', categoryId: 'cat_nifps', name: 'Stem Actuated Valve Assembly (NIFPS)', unit: 'Nos.', location: 'NIFPS Panel Area, 400 kV Karjat SS', trackLow: true, lowCutoff: 1,
    fields: { subSystem: 'Valve', make: 'CTR Manufacturing Industries Pvt. Ltd., Pune', hsnCode: '85049010', specification: 'Stem Actuated Valve Assembly for NIFPS', compatibleWith: 'CTR NIFPS system, 400 kV Karjat SS' },
    remarks: '', createdAt: '2026-07-13T10:00:00.000Z' },
    { base: CTR, date: '2026-07-13', qty: 1, unitRate: 13225, taxableAmt: 13225, gstPct: 18, totalAmt: 15605.5, remarks: '' });
}

function seedKits_() {
  if (tbl_('KITS').rows.length) return;
  insert_('CATEGORIES', { id: 'catk_test', kind: 'kit', name: 'Testing Equipment', desc: 'Portable test kits used for EHV equipment testing & commissioning.',
    fields: [
      { key: 'makeType', label: 'Make & Type', type: 'text', hint: 'e.g. ISA make TDX5000' },
      { key: 'serialNo', label: 'Serial No.(s)', type: 'textarea', hint: 'One per line if more than one' },
      { key: 'laptopDetails', label: 'Laptop Details (if any)', type: 'textarea', hint: 'Make, model, serial no.' },
      { key: 'history', label: 'History / Purchase / PO Details', type: 'textarea', hint: '' }
    ] });
  var rows = [
    [1, 'C & Tan Delta', 'ISA make TDX5000, Sr. No. 25/0355111', 'Yes — Lenovo, Sr. No. PF5V1DAH', 'Kit Received / Commissioned on 16.03.2026'],
    [2, 'Relay Test Kit', 'ISA make (Doble Altanova) DRTS64, Sr. No. 25/0053301', 'Yes — Dell P112F210, Sr. No. JK4V664', 'Relay Software Laptop HP, Pass: Karjat_400kv. Kit Received / Commissioned 2025.'],
    [3, 'LCM', 'Scope make SA 30i+, Sr. No. 3025.00 AH 0764', '', 'P.O. SP/10/T-0808/0819/No. 0463 dtd. 24.09.2020'],
    [4, 'DC E/F Locator', 'Taurus make DC-451P, Sr. No. TMDC050', '', 'Kit Received on 11.11.2025'],
    [5, 'Winding Resistance Measurement', '', '', 'Kit @ BBLR Protection Unit under PAC Ahilyanagar'],
    [6, 'Thermovision Camera', 'FLIR make E96, Sr. No. 90203871', 'Yes — Lenovo-10, Sr. No. PF5471P0', ''],
    [7, 'Portable DGA', '', '', 'Requirement Given (not yet received)'],
    [8, 'CB DCRM', 'Scope make HISAC Ultima, Sr. No. 3015.00 AL 1560 / 3021.00 AL 1565-1566', 'Yes — Lenovo V15 G3 IAP, Sr. No. PG04L5J8', 'Kit Received / Commissioned on 10.03.2026'],
    [9, 'CB CRM', 'Scope make CRM 100B+, Sr. No. 1PO15F AM 0695', '', 'Kit Received on 29.10.2025'],
    [10, 'CB Timer', 'Taurus make Prezitime MKS, Sr. No. CBT-015', '', 'Kit Received on 04.10.2025.'],
    [11, 'Battery Health Analyzer', '', '', ''],
    [12, 'T/F Turns Ratio', 'Scope make TTRM302, Sr. No. 1PO29E AM 1675', '', 'CE/EHV PC (O&M) ZONE/NSK/E-Tender/T-57/24-25/No. 403 dtd. 27.02.2026'],
    [13, 'Insulation Tester 5kV', 'Metrel MI3205 TeraOhmXA 5kV, Sr. Nos. 26020702 / 26020738', '', ''],
    [14, 'ZERA Kit', 'Zera make MT320', '', ''],
    [15, 'Digital Earth Tester with clamp connection', 'Metrel MI3123, Sr. No. 25461975', '', ''],
    [16, 'Digital AC Leakage Clamp Meter', 'Multi Measuring Instruments M140, Sr. No. E01925', '', 'Old clamp meter Sr. No. B03539 also held'],
    [17, 'Digital Clamp Meter (Tong Tester)', 'Rishabh RISH 1000A/400A AC/DC, Sr. No. 2508137799', '', ''],
    [18, 'Digital Multimeter', 'Rishabh RISH 616, Sr. Nos. 2512195648 / 2512195649 / 2512195654', '', 'Old multimeter Sr. No. 2512297245 from PAC Ahilyanagar'],
    [19, '2kVA CT Injection Kit', 'Quadrant QPIK-1, Sr. No. QMPL-216032026', '', ''],
    [20, 'Knee Point Measurement Kit', 'Quadrant QHBT-1, Sr. No. QMPL-215032026', '', ''],
    [21, '110A Dimmerstat', 'Automatic Electric AE 10D-1P, Sr. No. 1225/D120842/1', '', ''],
    [22, 'Digital Earth Tester (Online Purchase)', 'Metravi ERT-1502, Sr. No. 2503115957', '', ''],
    [23, 'Automatic Oil BDV Testing Kit', 'Power Electronical PE-AOBDV-M108, Sr. No. AOBDV-220025', '', '']
  ];
  var faulty = { 'CB Timer': true };
  rows.forEach(function (r) {
    var status = faulty[r[1]] ? 'Faulty' : 'Healthy';
    insert_('KITS', { id: uid_('kit'), categoryId: 'catk_test', name: r[1], ownership: 'Maintenance Unit', ownerDetail: '',
      status: status, location: '400 kV Karjat Substation', fields: { makeType: r[2], serialNo: '', laptopDetails: r[3], history: r[4] },
      remarks: '', docs: [], createdAt: now_(), updatedAt: now_() });
  });
}

/* ======================================================================== *
 *  MANUAL SEEDER — run this ONCE from the editor if test kits are missing.
 *  Safe to re-run: it never duplicates a category or a kit that already
 *  exists (matched by name). Works on an existing database — no rebuild,
 *  no data loss, and no re-deploy needed (editor Run uses the saved code).
 *  After it runs, refresh the web app; the kits appear under Test Kits.
 * ======================================================================== */
function seedTestKits() {
  // 1) Ensure the kit category exists (insert only if absent)
  var haveCat = tbl_('CATEGORIES').rows.some(function (c) { return c.id === 'catk_test'; });
  if (!haveCat) {
    insert_('CATEGORIES', { id: 'catk_test', kind: 'kit', name: 'Testing Equipment',
      desc: 'Portable test kits used for EHV equipment testing & commissioning.',
      fields: [
        { key: 'makeType',      label: 'Make & Type',                     type: 'text',     hint: 'e.g. ISA make TDX5000' },
        { key: 'serialNo',      label: 'Serial No.(s)',                   type: 'textarea', hint: 'One per line if more than one' },
        { key: 'laptopDetails', label: 'Laptop Details (if any)',         type: 'textarea', hint: 'Make, model, serial no.' },
        { key: 'history',       label: 'History / Purchase / PO Details', type: 'textarea', hint: '' }
      ] });
  }

  // 2) The 23 kits (from Book__2_.xlsx). [Sr, Name, Make&Serial, Laptop, History]
  var rows = [
    [1,  'C & Tan Delta',                              'ISA make TDX5000, Sr. No. 25/0355111',                                  'Yes — Lenovo, Sr. No. PF5V1DAH',      'Kit Received / Commissioned on 16.03.2026'],
    [2,  'Relay Test Kit',                             'ISA make (Doble Altanova) DRTS64, Sr. No. 25/0053301',                  'Yes — Dell P112F210, Sr. No. JK4V664','Relay Software Laptop HP, Pass: Karjat_400kv. Kit Received / Commissioned 2025.'],
    [3,  'LCM',                                        'Scope make SA 30i+, Sr. No. 3025.00 AH 0764',                           '',                                    'P.O. SP/10/T-0808/0819/No. 0463 dtd. 24.09.2020'],
    [4,  'DC E/F Locator',                             'Taurus make DC-451P, Sr. No. TMDC050',                                  '',                                    'Kit Received on 11.11.2025'],
    [5,  'Winding Resistance Measurement',             '',                                                                      '',                                    'Kit @ BBLR Protection Unit under PAC Ahilyanagar'],
    [6,  'Thermovision Camera',                        'FLIR make E96, Sr. No. 90203871',                                       'Yes — Lenovo-10, Sr. No. PF5471P0',   ''],
    [7,  'Portable DGA',                               '',                                                                      '',                                    'Requirement Given (not yet received)'],
    [8,  'CB DCRM',                                    'Scope make HISAC Ultima, Sr. No. 3015.00 AL 1560 / 3021.00 AL 1565-1566','Yes — Lenovo V15 G3 IAP, Sr. No. PG04L5J8','Kit Received / Commissioned on 10.03.2026'],
    [9,  'CB CRM',                                     'Scope make CRM 100B+, Sr. No. 1PO15F AM 0695',                          '',                                    'Kit Received on 29.10.2025'],
    [10, 'CB Timer',                                   'Taurus make Prezitime MKS, Sr. No. CBT-015',                            '',                                    'Kit Received on 04.10.2025. Faulty since 19.01.2026'],
    [11, 'Battery Health Analyzer',                    '',                                                                      '',                                    ''],
    [12, 'T/F Turns Ratio',                            'Scope make TTRM302, Sr. No. 1PO29E AM 1675',                            '',                                    'CE/EHV PC (O&M) ZONE/NSK/E-Tender/T-57/24-25/No. 403 dtd. 27.02.2026'],
    [13, 'Insulation Tester 5kV',                      'Metrel MI3205 TeraOhmXA 5kV, Sr. Nos. 26020702 / 26020738',             '',                                    ''],
    [14, 'ZERA Kit',                                   'Zera make MT320',                                                       '',                                    ''],
    [15, 'Digital Earth Tester with clamp connection', 'Metrel MI3123, Sr. No. 25461975',                                       '',                                    ''],
    [16, 'Digital AC Leakage Clamp Meter',             'Multi Measuring Instruments M140, Sr. No. E01925',                      '',                                    'Old clamp meter Sr. No. B03539 also held'],
    [17, 'Digital Clamp Meter (Tong Tester)',          'Rishabh RISH 1000A/400A AC/DC, Sr. No. 2508137799',                     '',                                    ''],
    [18, 'Digital Multimeter',                         'Rishabh RISH 616, Sr. Nos. 2512195648 / 2512195649 / 2512195654',       '',                                    'Old multimeter Sr. No. 2512297245 from PAC Ahilyanagar'],
    [19, '2kVA CT Injection Kit',                      'Quadrant QPIK-1, Sr. No. QMPL-216032026',                               '',                                    ''],
    [20, 'Knee Point Measurement Kit',                 'Quadrant QHBT-1, Sr. No. QMPL-215032026',                               '',                                    ''],
    [21, '110A Dimmerstat',                            'Automatic Electric AE 10D-1P, Sr. No. 1225/D120842/1',                  '',                                    ''],
    [22, 'Digital Earth Tester (Online Purchase)',     'Metravi ERT-1502, Sr. No. 2503115957',                                  '',                                    ''],
    [23, 'Automatic Oil BDV Testing Kit',              'Power Electronical PE-AOBDV-M108, Sr. No. AOBDV-220025',                 '',                                    '']
  ];

  var existing = {};
  tbl_('KITS').rows.forEach(function (k) { existing[String(k.name).toLowerCase()] = true; });
  var faulty = { 'CB Timer': true };
  var added = 0, skipped = 0;
  rows.forEach(function (r) {
    if (existing[String(r[1]).toLowerCase()]) { skipped++; return; }
    insert_('KITS', {
      id: uid_('kit'), categoryId: 'catk_test', name: r[1],
      ownership: 'Maintenance Unit', ownerDetail: '',
      status: faulty[r[1]] ? 'Faulty' : 'Healthy',
      location: '400 kV Karjat Substation',
      fields: { makeType: r[2], serialNo: '', laptopDetails: r[3], history: r[4] },
      remarks: '', docs: [], createdAt: now_(), updatedAt: now_()
    });
    added++;
  });

  var msg = 'Test-kit seed complete. Added ' + added + ' kit(s); ' + skipped
          + ' already present. Total kits now: ' + tbl_('KITS').rows.length + '.';
  Logger.log(msg);
  return msg;
}
