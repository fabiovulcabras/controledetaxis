// Gera um arquivo .xlsx simples (uma planilha) sem dependências externas.
// O .xlsx é um ZIP com arquivos XML; aqui o ZIP é montado sem compressão ("store").

export type FormatoColuna = "texto" | "inteiro" | "moeda" | "decimal";
export type ColunaXlsx = { titulo: string; largura?: number; formato?: FormatoColuna };
export type CelulaXlsx = string | number | null | undefined;

const encoder = new TextEncoder();

const escaparXml = (valor: string) =>
  valor
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Nome de coluna no padrão do Excel: 0 -> A, 25 -> Z, 26 -> AA.
function letraColuna(indice: number) {
  let nome = "";
  for (let n = indice + 1; n > 0; n = Math.floor((n - 1) / 26)) nome = String.fromCharCode(65 + ((n - 1) % 26)) + nome;
  return nome;
}

// Estilos definidos em styles.xml: 0 padrão, 1 cabeçalho, 2 inteiro, 3 moeda, 4 decimal.
const ESTILO: Record<FormatoColuna, number> = { texto: 0, inteiro: 2, moeda: 3, decimal: 4 };

function celula(ref: string, valor: CelulaXlsx, estilo: number) {
  if (valor == null || valor === "") return "";
  if (typeof valor === "number" && Number.isFinite(valor)) return `<c r="${ref}" s="${estilo}"><v>${valor}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ""}><is><t xml:space="preserve">${escaparXml(String(valor))}</t></is></c>`;
}

function planilha(colunas: ColunaXlsx[], linhas: CelulaXlsx[][]) {
  const ultima = letraColuna(colunas.length - 1);
  const total = linhas.length + 1;
  const cols = colunas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura ?? 14}" customWidth="1"/>`).join("");
  const cabecalho = `<row r="1">${colunas.map((c, i) => celula(`${letraColuna(i)}1`, c.titulo, 1)).join("")}</row>`;
  const corpo = linhas.map((linha, l) =>
    `<row r="${l + 2}">${colunas.map((c, i) => celula(`${letraColuna(i)}${l + 2}`, linha[i], ESTILO[c.formato ?? "texto"])).join("")}</row>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols><sheetData>${cabecalho}${corpo}</sheetData>
<autoFilter ref="A1:${ultima}${total}"/></worksheet>`;
}

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0D2C54"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CRC_TABELA = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(dados: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = CRC_TABELA[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(arquivos: { nome: string; conteudo: string }[]) {
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let deslocamento = 0;
  for (const arquivo of arquivos) {
    const nome = encoder.encode(arquivo.nome);
    const dados = encoder.encode(arquivo.conteudo);
    const crc = crc32(dados);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint32(10, 0, true); local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true); local.setUint32(22, dados.length, true); local.setUint16(26, nome.length, true);
    partes.push(new Uint8Array(local.buffer), nome, dados);

    const entrada = new DataView(new ArrayBuffer(46));
    entrada.setUint32(0, 0x02014b50, true); entrada.setUint16(4, 20, true); entrada.setUint16(6, 20, true);
    entrada.setUint16(8, 0x0800, true); entrada.setUint32(16, crc, true); entrada.setUint32(20, dados.length, true);
    entrada.setUint32(24, dados.length, true); entrada.setUint16(28, nome.length, true); entrada.setUint32(42, deslocamento, true);
    central.push(new Uint8Array(entrada.buffer), nome);
    deslocamento += 30 + nome.length + dados.length;
  }
  const tamanhoCentral = central.reduce((soma, parte) => soma + parte.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true); fim.setUint32(16, deslocamento, true);
  return [...partes, ...central, new Uint8Array(fim.buffer)];
}

export function gerarXlsx(nomePlanilha: string, colunas: ColunaXlsx[], linhas: CelulaXlsx[][]): Uint8Array[] {
  const nome = escaparXml(nomePlanilha.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Planilha");
  return zip([
    { nome: "[Content_Types].xml", conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { nome: "_rels/.rels", conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { nome: "xl/workbook.xml", conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${nome}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${nome}'!$A$1:$${letraColuna(colunas.length - 1)}$${linhas.length + 1}</definedName></definedNames>
</workbook>` },
    { nome: "xl/_rels/workbook.xml.rels", conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { nome: "xl/styles.xml", conteudo: ESTILOS },
    { nome: "xl/worksheets/sheet1.xml", conteudo: planilha(colunas, linhas) },
  ]);
}

export function baixarXlsx(arquivo: string, nomePlanilha: string, colunas: ColunaXlsx[], linhas: CelulaXlsx[][]) {
  const blob = new Blob(gerarXlsx(nomePlanilha, colunas, linhas) as BlobPart[], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = arquivo.endsWith(".xlsx") ? arquivo : `${arquivo}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
