/* [[EXECUTOR-STUB]] 执行器不判档位：能干什么由服务器派单时按档位表拦；本地只认领回来的那张特征表。 */
const EDITION = {
  type: 'executor',
  label: '执行器',
  licensee: '',
  builtAt: 0,
  expireAt: 0,
  validDays: 0,
  boundAccount: { xhsId: '', name: '' },
  keywordMax: 0,
  price: 0,
  noDelay: false,
  features: {
    batchSend: true, tenant: true, knowledge: true, autoWater: true,
    prospectList: true, notePublish: true, dailyBrowse: true, videoFilm: true,
  },
};

let _edGrant = null;

function editionSetGrant(g) { _edGrant = (g && g.features) ? g : null; }
function editionGrant() { return _edGrant; }
function editionActiveFeatures() {
  return Object.assign({}, EDITION.features, (_edGrant && _edGrant.features) || {});
}
function editionHasFeature(name) { return editionActiveFeatures()[name] !== false; }
function editionNeverExpires() { return true; }
function editionHasBinding() { return false; }
function editionBoundXhsId() { return ''; }
function editionKeywordMax() { return 0; }
function editionIntegrityOk() { return true; }
function editionIsExpired() { return false; }
function editionRemainingDays() { return null; }
function editionSummary() {
  return {
    type: 'executor',
    label: '执行器',
    licensee: '',
    expireAt: 0,
    remainingDays: null,
    bound: { bound: false, xhsId: '', name: '' },
    features: editionActiveFeatures(),
    fromServer: !!_edGrant,
    tier: _edGrant ? (_edGrant.tier || '') : '',
    draftOnly: !!(_edGrant && _edGrant.draftOnly),
    onTrial: !!(_edGrant && _edGrant.onTrial),
    grantAt: _edGrant ? (_edGrant.at || 0) : 0,
    expired: false,
  };
}

function editionLoadGrant() {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get('ed.grant', (res) => {
      const g = res && res['ed.grant'];
      if (g && g.features) editionSetGrant(g);
    });
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== 'local' || !ch || !ch['ed.grant']) return;
        editionSetGrant(ch['ed.grant'].newValue || null);
      });
    }
  } catch (_) {}
}
editionLoadGrant();

const Edition = {
  EDITION,
  hasFeature: editionHasFeature,
  activeFeatures: editionActiveFeatures,
  setGrant: editionSetGrant,
  grant: editionGrant,
  neverExpires: editionNeverExpires,
  hasBinding: editionHasBinding,
  boundXhsId: editionBoundXhsId,
  keywordMax: editionKeywordMax,
  integrityOk: editionIntegrityOk,
  isExpired: editionIsExpired,
  remainingDays: editionRemainingDays,
  summary: editionSummary,
};

if (typeof self !== 'undefined') { self.Edition = Edition; }
if (typeof module !== 'undefined') { module.exports = Edition; }
