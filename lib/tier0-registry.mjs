function enabled(items = []) {
  return Array.isArray(items) ? items.filter((item) => item?.enabled !== false) : [];
}

export function tier0RegistryRecords(config = {}) {
  const records = [];
  const nse = config.nse || {};
  if (nse.enabled !== false) {
    for (const instrument of enabled(nse.instruments)) {
      records.push({
        id: `tier0-nse-${instrument.symbol}`,
        name: `${instrument.companyContains} NSE corporate announcements`,
        type: 'exchange filing',
        kind: 'exchange filing',
        tier: nse.tier || 'tier0',
        direct: true,
        official: true,
        authoritative: true,
        rightsStatus: nse.rightsStatus || 'metadata-and-link',
        cadence: nse.cadence || 'on-demand',
        url: `${nse.endpoint}?index=equities&symbol=${encodeURIComponent(instrument.symbol)}`,
        domain: 'nseindia.com',
        symbol: instrument.symbol,
        companyContains: instrument.companyContains
      });
    }
  }
  const sec = config.sec || {};
  if (sec.enabled !== false) {
    for (const registrant of enabled(sec.registrants)) {
      records.push({
        id: `tier0-sec-${registrant.cik}`,
        name: `${registrant.companyContains} SEC EDGAR filings`,
        type: 'regulator filing',
        kind: 'regulator filing',
        tier: sec.tier || 'tier0',
        direct: true,
        official: true,
        authoritative: true,
        rightsStatus: sec.rightsStatus || 'public-filing-metadata-and-link',
        cadence: sec.cadence || 'on-demand',
        url: String(sec.endpointTemplate || '').replace('{cik}', registrant.cik),
        domain: 'sec.gov',
        cik: registrant.cik,
        companyContains: registrant.companyContains
      });
    }
  }
  return records;
}
