module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    kind: 'web',
    apiContractVersion: 1,
    apiBase: '',
    capabilities: {
      holyrics: true,
      favorites: true,
      obs: true,
      automation: true,
      bridge: true,
      youtube: true,
      localPreview: false,
      agents: false,
      profiles: false,
      backup: false,
      localAdmin: false
    }
  });
};
