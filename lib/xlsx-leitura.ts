// Lê a primeira planilha de um arquivo .xlsx sem dependências externas.
// O .xlsx é um ZIP com XML; entradas comprimidas (deflate) são abertas com DecompressionStream do navegador.

const decoder = new TextDecoder();

async function inflar(dados: Uint8Array): Promise<Uint8Array> {
  const fluxo = new Blob([new Uint8Array(dados)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

/** Arquivos do ZIP (nome → conteúdo), lendo o diretório central. */
async function abrirZip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let fim = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error("Arquivo não é um .xlsx válido.");
  const total = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const arquivos = new Map<string, Uint8Array>();
  for (let n = 0; n < total; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true);
    const tamComprimido = v.getUint32(p + 20, true);
    const tamNome = v.getUint16(p + 28, true), tamExtra = v.getUint16(p + 30, true), tamComent = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nome = decoder.decode(bytes.subarray(p + 46, p + 46 + tamNome));
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const dados = bytes.subarray(inicio, inicio + tamComprimido);
    if (/^xl\/(sharedStrings|workbook|worksheets\/sheet\d+)\.xml$/.test(nome)) {
      arquivos.set(nome, metodo === 0 ? dados : metodo === 8 ? await inflar(dados) : new Uint8Array());
    }
    p += 46 + tamNome + tamExtra + tamComent;
  }
  return arquivos;
}

const entidades = (t: string) => t.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
  const mapa: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  if (mapa[e.toLowerCase()]) return mapa[e.toLowerCase()];
  return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const textos = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => entidades(m[1])).join("");
const coluna = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, l) => n * 26 + l.charCodeAt(0) - 64, 0) - 1;

/** Linhas da primeira planilha, com o texto de cada célula (números como aparecem gravados). */
export async function lerPlanilhaXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const arquivos = await abrirZip(buf);
  const compartilhados = arquivos.has("xl/sharedStrings.xml")
    ? [...decoder.decode(arquivos.get("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1])) : [];
  const nomePlanilha = [...arquivos.keys()].filter((k) => k.startsWith("xl/worksheets/")).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0];
  if (!nomePlanilha) throw new Error("A planilha está vazia.");
  const xml = decoder.decode(arquivos.get(nomePlanilha));
  const linhas: string[][] = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const linha: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = c[1];
      const ref = atributos.match(/\br="([A-Z]+\d+)"/)?.[1];
      const tipo = atributos.match(/\bt="(\w+)"/)?.[1];
      const corpo = c[2] ?? "";
      const valor = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let texto = "";
      if (tipo === "s" && valor != null) texto = compartilhados[Number(valor)] ?? "";
      else if (tipo === "inlineStr") texto = textos(corpo);
      else if (valor != null) texto = entidades(valor);
      const i = ref ? coluna(ref) : linha.length;
      while (linha.length < i) linha.push("");
      linha[i] = texto.trim();
    }
    if (linha.some((x) => x !== "")) linhas.push(linha);
  }
  return linhas;
}
