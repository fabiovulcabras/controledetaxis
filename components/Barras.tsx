import { brl } from "@/lib/datas";

/** Barras horizontais de valor (R$), proporcionais ao maior item. */
export default function Barras({ dados, vazio }: { dados: { nome: string; valor: number }[]; vazio: string }) {
  if (!dados.length) return <p className="empty">{vazio}</p>;
  const max = Math.max(...dados.map((d) => d.valor), 1);
  return (
    <div className="barras">
      {dados.map((d) => (
        <div key={d.nome} className="barra-linha">
          <span title={d.nome}>{d.nome}</span>
          <div className="cobertura-trilho"><div className="cobertura-barra" style={{ width: `${(d.valor / max) * 100}%`, background: "var(--gold)" }} /></div>
          <b>{brl(d.valor)}</b>
        </div>
      ))}
    </div>
  );
}
