/* [[EXECUTOR-STUB]] 执行器里不带任何提示词：场景提示词由服务器 /api/exec/prompts 下发，
   下发后写进 chrome.storage.local['prompts']，内核照旧用 Storage.getPrompt 取。 */
const DEFAULT_PROMPTS = {};

if (typeof module !== 'undefined') {
  module.exports = DEFAULT_PROMPTS;
}
