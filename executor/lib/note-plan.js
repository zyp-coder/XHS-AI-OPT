/* [[EXECUTOR-STUB]] 执行器只做机械动作：选题/写法/配比/排产规则都在服务器，本地只留同名空壳，
   免得搬过来的界面在初始化时因为找不到对象而报错。真排产由服务器下单时带下来。 */
const STAGES = [];
const TYPES = [];
const KINDS = [];
const PINNED = [];
const TOPIC_SCOPES = [];
const STAGE_MIX = {};
const WORDS = [];
const WORDS_DEFAULT = 'mid';
const SELL_TALK = [];
const SELL_TALK_DEFAULT = '';
const STAGE_PLAY = {};
const COLUMN_DAYS = [];
const FORM_NAMES = {};

function typeOf() { return null; }
function kindOf() { return null; }
function kindsOfType() { return []; }
function typesForStage() { return []; }
function stageOf() { return null; }
function detectStage() { return 'cold'; }
function mixOf() { return []; }
function allocate() { return []; }
function describeMix() { return ''; }
function materialsOf() { return []; }
function materialsFromAnswers() { return []; }
function checkType() { return { ok: false, missing: '', needText: '' }; }
function unlockMap() { return {}; }
function validatePlan() { return { ok: true, problems: [] }; }
function arcAdvice() { return { use: 'single', note: '' }; }
function candidatesFor() { return []; }
function describeTypes() { return ''; }
function describeTypeScript() { return ''; }
function describeStage() { return ''; }
function describeStagePlay() { return ''; }
function stagePlayOf() { return null; }
function stageTopLines() { return []; }
function normShape() { return null; }
function shapeOwn() { return null; }
function wordsBaseOf() { return WORDS_DEFAULT; }
function shapeOf() { return { build: 100, sell: 0 }; }
function talkShape() { return { build: 100, sell: 0 }; }
function shapeTail() { return ''; }
function wordsOf() { return null; }
function sellTalkOf() { return { key: '', name: '', pct: 0 }; }
function talkAdviceFor() { return ''; }
function columnDayName() { return ''; }
function normalizeColumns() { return []; }
function columnsProblems() { return []; }
function describeColumns() { return ''; }
function describeWeek() { return ''; }
function applyColumns(items) { return items || []; }

const NotePlan = {
  STAGES, TYPES, KINDS, PINNED, TOPIC_SCOPES, STAGE_MIX,
  typeOf, kindOf, kindsOfType, stageOf, detectStage, typesForStage,
  mixOf, allocate, describeMix,
  materialsOf, materialsFromAnswers, checkType, unlockMap, validatePlan, arcAdvice,
  candidatesFor, describeTypes, describeTypeScript, describeStage,
  FORM_NAMES, normShape, shapeOwn, wordsBaseOf, shapeOf, talkShape, shapeTail,
  WORDS, WORDS_DEFAULT, wordsOf,
  SELL_TALK, SELL_TALK_DEFAULT, sellTalkOf, talkAdviceFor,
  STAGE_PLAY, stagePlayOf, stageTopLines, describeStagePlay,
  COLUMN_DAYS, columnDayName, normalizeColumns, columnsProblems, describeColumns, describeWeek, applyColumns,
};

if (typeof self !== 'undefined') { self.NotePlan = NotePlan; }
if (typeof module !== 'undefined') { module.exports = NotePlan; }
