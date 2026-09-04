export function bseRegistryRecords(config = {}) {
  if (config.enabled === false) return [];
  return (Array.isArray(config.instruments) ? config.instruments : [])
    .filter((instrument) => instrument?.enabled !== false)
    .map((instrument) => ({
      id: `tier0-bse-${instrument.scripCode}`,
      name: `${instrument.companyContains} BSE corporate announcements`,
      type: 'exchange filing',
      kind: 'exchange filing',
      tier: config.tier || 'tier0',
      direct: true,
      official: true,
      authoritative: true,
      rightsStatus: config.rightsStatus || 'metadata-and-link',
      cadence: config.cadence || 'on-demand',
      url: `${config.endpoint}?pageno=1&strCat=-1&strScrip=${encodeURIComponent(instrument.scripCode)}&strSearch=P&strType=C`,
      domain: 'bseindia.com',
      symbol: instrument.symbol,
      scripCode: instrument.scripCode,
      companyContains: instrument.companyContains
    }));
}
