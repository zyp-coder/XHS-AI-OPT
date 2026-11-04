/* [[EXECUTOR-STUB]] 授权归服务器：执行器不校本地时间、不读到期待；真闸门在服务器派单时。 */
async function getTrustedNow() { return Date.now(); }

async function checkLicenseStatus() {
  const now = Date.now();
  return {
    ok: true,
    expired: false,
    noNetwork: false,
    now,
    edition: (typeof Edition !== 'undefined' && Edition && Edition.summary) ? Edition.summary(now) : null,
    remainingDays: Infinity,
  };
}

const LicenseGuard = { getTrustedNow, checkLicenseStatus };

if (typeof self !== 'undefined') { self.LicenseGuard = LicenseGuard; }
if (typeof module !== 'undefined') { module.exports = LicenseGuard; }
