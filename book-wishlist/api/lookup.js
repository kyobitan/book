// Vercel Serverless Function: GET /api/lookup?url=<商品ページのリンク>
const UA = { 'User-Agent': 'book-wishlist/1.0' };
const getJson = async (u) => {
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error(r.status);
  return r.json();
};

function findCode(url) {
  const m = url.match(/(?:\/dp\/|\/gp\/product\/|\/d\/|\/ASIN\/)([A-Z0-9]{10})(?:[/?#]|$)/i);
  const i = url.match(/97[89]\d{10}/);
  return (m && m[1].toUpperCase()) || (i && i[0]) || null;
}

// ISBN-10(書籍のASIN)→ISBN-13。B0…などのASINは変換できず null
function toIsbn13(code) {
  if (/^97[89]\d{10}$/.test(code)) return code;
  if (!/^\d{9}[\dX]$/.test(code)) return null;
  const b = '978' + code.slice(0, 9);
  const s = [...b].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return b + ((10 - (s % 10)) % 10);
}

async function openbd(isbn) {
  const [b] = await getJson(`https://api.openbd.jp/v1/get?isbn=${isbn}`);
  const s = b && b.summary;
  return s && s.title ? { title: s.title, author: s.author, publisher: s.publisher } : null;
}

async function ndl(isbn) {
  const x = await (await fetch(`https://ndlsearch.ndl.go.jp/api/opensearch?isbn=${isbn}&cnt=1`, { headers: UA })).text();
  const g = (t) => (x.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`)) || [])[1];
  return g('dc:title') ? { title: g('dc:title'), author: g('dc:creator'), publisher: g('dc:publisher') } : null;
}

async function google(isbn) {
  const d = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  const v = d.items && d.items[0] && d.items[0].volumeInfo;
  return v ? { title: v.title, author: (v.authors || []).join(' / '), publisher: v.publisher } : null;
}

// 著者名 → Wikidata の国籍(P27)→ ISO 3166-1 alpha-2。見つからなければ ''
async function country(author) {
  const name = (author || '').split(/[／/]/)[0].replace(/[,，、]\s*/g, '').trim();
  if (!name) return '';
  const w = 'https://www.wikidata.org/w/api.php?format=json&';
  const found = await getJson(w + 'action=wbsearchentities&type=item&limit=5&language=ja&search=' + encodeURIComponent(name));
  const ids = found.search.map((x) => x.id);
  if (!ids.length) return '';
  const ents = (await getJson(w + 'action=wbgetentities&props=claims&ids=' + ids.join('|'))).entities;
  const val = (c) => c.mainsnak.datavalue && c.mainsnak.datavalue.value;
  for (const id of ids) {
    const c = ents[id].claims || {};
    if (!(c.P31 || []).some((p) => val(p) && val(p).id === 'Q5')) continue; // 人物のみ
    for (const p of c.P27 || []) {
      const q = val(p) && val(p).id;
      if (!q) continue;
      const k = (await getJson(w + 'action=wbgetentities&props=claims&ids=' + q)).entities[q].claims;
      const iso = k.P297 && val(k.P297[0]);
      if (iso) return iso;
    }
  }
  return '';
}

module.exports = async (req, res) => {
  const code = findCode(String(req.query.url || ''));
  const isbn = code && toIsbn13(code);
  if (!isbn) return res.status(200).json({ error: 'ISBNを検出できません。手入力してください' });
  let info = null;
  for (const f of [openbd, ndl, google]) {
    try { info = await f(isbn); } catch (e) { /* 次のAPIへ */ }
    if (info) break;
  }
  if (!info) return res.status(200).json({ isbn, error: '書誌情報が見つかりません。手入力してください' });
  let c = '';
  try { c = await country(info.author); } catch (e) { /* 国籍は手動で選択 */ }
  res.setHeader('Cache-Control', 's-maxage=86400');
  res.status(200).json({ isbn, ...info, country: c });
};
