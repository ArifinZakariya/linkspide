const knownDomains = {
  "ouo.io": "OUO",
  "ouo.press": "OUO",
  "linkvertise.com": "Linkvertise",
  "shrinkme.io": "ShrinkMe",
  "shrinkme.click": "ShrinkMe",
  "shrinke.me": "ShrinkMe",
  "shorte.st": "Shorte.st",
  "sh.st": "Shorte.st",
  "adf.ly": "Adf.ly",
  "bc.vc": "BCVC",
  "exe.io": "Exe.io",
  "tei.ai": "TEI",
  "cuturl.cc": "CutURL",
  "linksfly.com": "LinksFly",
  "gplinks.com": "GPLinks",
  "gplink.co": "GPLinks",
  "gplink.net": "GPLinks",
  "mitly.us": "Mitly",
  "cutp.in": "CutP",
  "fc.lc": "FC.LC",
  "za.gl": "ZA.GL",
  "tnlink.in": "TNLink",
  "link1s.com": "Link1S",
  "linkspy.cc": "LinkSpy",
  "cutdy.link": "Cutdy",
  "safelinku.com": "SafelinkU",
  "dutchycorp.com": "DutchyCorp",
  "tpi.li": "TPI",
  "tpi.ac": "TPI",
  "srtam.com": "TPI",
  "bit.ly": "Bit.ly",
  "tinyurl.com": "TinyURL",
  "t.co": "Twitter",
  "is.gd": "is.gd",
  "v.gd": "v.gd",
  "rb.gy": "rb.gy",
  "rebrand.ly": "Rebrandly",
  "buff.ly": "Buffer",
  "shorturl.at": "ShortURL",
  "dl-protect.com": "DL-Protect",
  "ouo.io/go": "OUO",
  "linkvertise.com/api": "Linkvertise",
};

function identifyShortener(url) {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    return knownDomains[host] || null;
  } catch {
    return null;
  }
}

module.exports = { knownDomains, identifyShortener };
