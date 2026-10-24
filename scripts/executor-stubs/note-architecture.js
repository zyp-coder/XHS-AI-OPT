/* [[EXECUTOR-STUB]] 执行器只做机械动作：写稿结构/品类矩阵留在服务器，本地不再带内容。 */
const CATEGORY_MATRIX = {};
const BUILTIN_MATRIX_TEXT = '';

function detectCategory() { return ''; }
function getNoteArchitecture() { return { category: '', guidance: '' }; }
function applyNoteArchitecture(systemLines) { return systemLines || []; }

const NoteArchitecture = {
  CATEGORY_MATRIX,
  BUILTIN_MATRIX_TEXT,
  detectCategory,
  getNoteArchitecture,
  applyNoteArchitecture,
};

if (typeof self !== 'undefined') { self.NoteArchitecture = NoteArchitecture; }
if (typeof module !== 'undefined') { module.exports = NoteArchitecture; }
